package com.mudai.ytm_listener

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

object GistSyncManager {

    private const val TAG = "GistSyncManager"
    private const val GIST_FILENAME = "youtube-music-skipper-config.json"
    
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    suspend fun pullConfig(context: Context, token: String, gistId: String): Boolean = withContext(Dispatchers.IO) {
        if (token.isEmpty() || gistId.isEmpty()) return@withContext false

        try {
            val request = Request.Builder()
                .url("https://api.github.com/gists/$gistId?t=${System.currentTimeMillis()}")
                .get()
                .addHeader("Authorization", "Bearer $token")
                .addHeader("Accept", "application/vnd.github.v3+json")
                .addHeader("Cache-Control", "no-cache")
                .build()

            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                val responseBody = response.body?.string() ?: ""
                val jsonResponse = JSONObject(responseBody)
                val files = jsonResponse.optJSONObject("files")
                val targetFile = files?.optJSONObject(GIST_FILENAME)
                val content = targetFile?.optString("content")

                if (!content.isNullOrEmpty()) {
                    val gson = Gson()
                    val pulledConfig = gson.fromJson(content, AppConfig::class.java)
                    
                    val sharedPrefs = context.getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
                    val currentJson = sharedPrefs.getString("config_json", "{}")
                    val currentConfig = gson.fromJson(currentJson, AppConfig::class.java) ?: AppConfig()
                    
                    currentConfig.rules = pulledConfig.rules
                    currentConfig.allowedSongs = pulledConfig.allowedSongs
                    
                    sharedPrefs.edit().putString("config_json", gson.toJson(currentConfig)).apply()
                    Log.d(TAG, "Pull successful")
                    return@withContext true
                }
            } else {
                Log.e(TAG, "Pull failed with response code: ${response.code}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Pull error: ${e.message}", e)
        }
        return@withContext false
    }

    suspend fun pushConfig(context: Context, token: String, gistId: String): String = withContext(Dispatchers.IO) {
        if (token.isEmpty() || gistId.isEmpty()) return@withContext "Token or Gist ID is empty"

        try {
            val sharedPrefs = context.getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
            val currentJson = sharedPrefs.getString("config_json", "{}")
            val gson = Gson()
            val currentConfig = gson.fromJson(currentJson, AppConfig::class.java) ?: return@withContext "Failed to parse current config"

            val exportConfig = AppConfig(
                allowedSongs = currentConfig.allowedSongs,
                rules = currentConfig.rules,
                gistSync = null
            )
            val exportJson = gson.toJson(exportConfig)

            val payload = JSONObject().apply {
                put("files", JSONObject().apply {
                    put(GIST_FILENAME, JSONObject().apply {
                        put("content", exportJson)
                    })
                })
            }

            val requestBody = payload.toString().toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url("https://api.github.com/gists/$gistId")
                .patch(requestBody)
                .addHeader("Authorization", "Bearer $token")
                .addHeader("Accept", "application/vnd.github.v3+json")
                .build()

            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                Log.d(TAG, "Push successful")
                return@withContext "success"
            } else {
                val errorBody = response.body?.string() ?: "No body"
                Log.e(TAG, "Push failed: ${response.code} $errorBody")
                return@withContext "HTTP ${response.code}: $errorBody"
            }
        } catch (e: Exception) {
            Log.e(TAG, "Push error: ${e.message}", e)
            return@withContext "Exception: ${e.message}"
        }
    }
}
