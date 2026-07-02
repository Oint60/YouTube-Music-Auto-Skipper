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

object GistSyncManager {

    private const val TAG = "GistSyncManager"
    private const val GIST_FILENAME = "youtube-music-skipper-config.json"

    suspend fun pullConfig(context: Context, token: String, gistId: String): Boolean = withContext(Dispatchers.IO) {
        if (token.isEmpty() || gistId.isEmpty()) return@withContext false

        try {
            val url = URL("https://api.github.com/gists/$gistId")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.setRequestProperty("Authorization", "token $token")
            connection.setRequestProperty("Accept", "application/vnd.github.v3+json")

            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                val reader = BufferedReader(InputStreamReader(connection.inputStream))
                val response = reader.readText()
                reader.close()

                val jsonResponse = JSONObject(response)
                val files = jsonResponse.optJSONObject("files")
                val targetFile = files?.optJSONObject(GIST_FILENAME)
                val content = targetFile?.optString("content")

                if (!content.isNullOrEmpty()) {
                    val gson = Gson()
                    val pulledConfig = gson.fromJson(content, AppConfig::class.java)
                    
                    // 現在のローカル設定を読み込み
                    val sharedPrefs = context.getSharedPreferences("youtube_music_skipper_prefs", Context.MODE_PRIVATE)
                    val currentJson = sharedPrefs.getString("config_json", "{}")
                    val currentConfig = gson.fromJson(currentJson, AppConfig::class.java) ?: AppConfig()
                    
                    // リモートのルールで上書き
                    currentConfig.rules = pulledConfig.rules
                    currentConfig.allowedSongs = pulledConfig.allowedSongs
                    
                    // 保存
                    sharedPrefs.edit().putString("config_json", gson.toJson(currentConfig)).apply()
                    Log.d(TAG, "Pull successful")
                    return@withContext true
                }
            } else {
                Log.e(TAG, "Pull failed with response code: ${connection.responseCode}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Pull error: ${e.message}", e)
        }
        return@withContext false
    }

    suspend fun pushConfig(context: Context, token: String, gistId: String): Boolean = withContext(Dispatchers.IO) {
        if (token.isEmpty() || gistId.isEmpty()) return@withContext false

        try {
            val sharedPrefs = context.getSharedPreferences("youtube_music_skipper_prefs", Context.MODE_PRIVATE)
            val currentJson = sharedPrefs.getString("config_json", "{}")
            val gson = Gson()
            val currentConfig = gson.fromJson(currentJson, AppConfig::class.java) ?: return@withContext false

            // Export用にrulesとallowedSongsだけ抽出
            val exportConfig = AppConfig(
                allowedSongs = currentConfig.allowedSongs,
                rules = currentConfig.rules,
                gistSync = null // トークンはアップロードしない
            )
            val exportJson = gson.toJson(exportConfig)

            val payload = JSONObject().apply {
                put("files", JSONObject().apply {
                    put(GIST_FILENAME, JSONObject().apply {
                        put("content", exportJson)
                    })
                })
            }

            val url = URL("https://api.github.com/gists/$gistId")
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "PATCH"
            connection.setRequestProperty("Authorization", "token $token")
            connection.setRequestProperty("Accept", "application/vnd.github.v3+json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true

            val writer = OutputStreamWriter(connection.outputStream)
            writer.write(payload.toString())
            writer.flush()
            writer.close()

            if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                Log.d(TAG, "Push successful")
                return@withContext true
            } else {
                Log.e(TAG, "Push failed with response code: ${connection.responseCode}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Push error: ${e.message}", e)
        }
        return@withContext false
    }
}
