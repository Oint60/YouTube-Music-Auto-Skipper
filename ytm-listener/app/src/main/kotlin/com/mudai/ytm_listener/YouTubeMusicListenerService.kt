package com.mudai.ytm_listener

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.Rating
import android.media.session.MediaSessionManager
import android.net.Uri
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Call
import okhttp3.Callback
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Job
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class YouTubeMusicListenerService : NotificationListenerService() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(2, TimeUnit.SECONDS)
        .build()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var currentJob: Job? = null
    
    @Volatile
    private var lastSearchLimitTime: Long = 0
    
    private var excludeArtists = setOf<String>()
    
    // PCと同等の詳細ルール設定
    private var appConfig: AppConfig? = null
    
    // リリース年キャッシュ（同同一起動内で重複して検索しないため）
    private val yearCache = ConcurrentHashMap<String, Int>()

    // 最後に処理した曲の情報と重複処理防止フラグ
    @Volatile
    private var lastProcessedTrack: String? = null
    @Volatile
    private var lastProcessedArtist: String? = null
    @Volatile
    private var currentTrackSkipped: Boolean = false
    @Volatile
    private var isManualSkipping: Boolean = false

    companion object {
        private const val CHANNEL_ID = "YTM_Listener_Channel"
        private const val NOTIFICATION_ID = 9922
        const val ACTION_SETTINGS_CHANGED = "com.mudai.ytm_listener.SETTINGS_CHANGED"
        const val ACTION_MANUAL_SKIP = "com.mudai.ytm_listener.ACTION_MANUAL_SKIP"
    }

    private val manualSkipReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_MANUAL_SKIP) {
                scope.launch {
                    handleManualSkipAndDislike()
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        loadSettings()
        createNotificationChannel()
        startForegroundService()

        val filter = android.content.IntentFilter(ACTION_MANUAL_SKIP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(manualSkipReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(manualSkipReceiver, filter)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(manualSkipReceiver)
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Error unregistering receiver: ${e.message}")
        }
        currentJob?.cancel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SETTINGS_CHANGED) {
            loadSettings()
        }
        return START_STICKY
    }

    private fun loadSettings() {
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        
        // 簡易除外アーティスト
        val excludeArtistsJson = prefs.getString("exclude_artists", "[]") ?: "[]"
        try {
            val listType = object : TypeToken<List<String>>() {}.type
            val list: List<String> = Gson().fromJson(excludeArtistsJson, listType)
            excludeArtists = list.toSet()
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Failed to parse exclude artists: ${e.message}")
        }

        // 共通設定JSON (rules, allowedSongs) のパース
        val configJson = prefs.getString("config_json", "{}") ?: "{}"
        try {
            appConfig = Gson().fromJson(configJson, AppConfig::class.java)
            Log.d("YTM_Listener", "Configuration loaded. Rules count: ${appConfig?.rules?.size ?: 0}")
            
            // 起動時にGist同期が有効ならPullする
            val gistToken = appConfig?.gistSync?.token
            val gistId = appConfig?.gistSync?.gistId
            if (appConfig?.gistSync?.enabled == true && !gistToken.isNullOrEmpty() && !gistId.isNullOrEmpty()) {
                scope.launch {
                    val success = GistSyncManager.pullConfig(this@YouTubeMusicListenerService, gistToken, gistId)
                    if (success) {
                        // 成功したら再ロード
                        val newConfigJson = prefs.getString("config_json", "{}") ?: "{}"
                        appConfig = Gson().fromJson(newConfigJson, AppConfig::class.java)
                        Log.d("YTM_Listener", "Gist config pulled successfully on startup.")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Failed to parse app config json: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notification_text)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundService() {
        val pendingIntent: PendingIntent = Intent(this, MainActivity::class.java).let { notificationIntent ->
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            PendingIntent.getActivity(this, 0, notificationIntent, flags)
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun saveAndNotifyNowPlaying(trackName: String, artistName: String) {
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("now_playing_title", trackName)
            .putString("now_playing_artist", artistName)
            .apply()

        val intent = Intent("com.mudai.ytm_listener.TRACK_CHANGED").apply {
            putExtra("title", trackName)
            putExtra("artist", artistName)
        }
        sendBroadcast(intent)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName != "com.google.android.apps.youtube.music") return

        val extras = sbn.notification.extras
        val trackName = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val artistName = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        if (trackName.isNotEmpty() && artistName.isNotEmpty()) {
            val isNewTrack = trackName != lastProcessedTrack || artistName != lastProcessedArtist
            if (isNewTrack) {
                lastProcessedTrack = trackName
                lastProcessedArtist = artistName
                currentTrackSkipped = false // 新しい曲なのでリセット

                // 現在の曲情報を保存＆通知
                saveAndNotifyNowPlaying(trackName, artistName)

                // 実行中の古い処理があればキャンセルする
                currentJob?.cancel()

                // 新しい処理を起動し、Jobを保持
                currentJob = scope.launch {
                    handleNewTrackAsync(trackName, artistName)
                }
            }
        }
    }

    private suspend fun handleNewTrackAsync(trackName: String, artistName: String) {
        try {
            Log.d("YTM_Listener", "=== Processing new track: $artistName - $trackName ===")

            // 曲情報・PlaybackState の同期完了を待つため、固定で 2000ms (2秒) 待機する
            // (速度より確実性を優先)
            kotlinx.coroutines.delay(2000)

            // 処理中に曲が変わっていないか確認
            if (trackName != lastProcessedTrack || artistName != lastProcessedArtist) {
                Log.d("YTM_Listener", "Track changed during wait. Aborting processing for: $trackName")
                return
            }

            // 1. 簡易除外アーティストに合致した場合はスキップ
            if (excludeArtists.any { artistName.contains(it, ignoreCase = true) }) {
                Log.d("YTM_Listener", "Skipped posting (Excluded Artist): $artistName - $trackName")
                currentTrackSkipped = true
                skipCurrentTrack(trackName, artistName)
                return
            }

            // 2. 自律（スマホ単体）での年取得とスキップ判定
            handleStandaloneSkipCheck(trackName, artistName)
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Error in handleNewTrackAsync: ${e.message}", e)
        }
    }

    // checkAlreadyDislikedAndSkip は削除済み
    // 理由: 前の曲の低評価状態(undo_dislike)が残ったまま次の曲を誤判定し、
    // 非スキップ対象をスキップしてしまうバグの根本原因だったため

    // スマホ単体での判定処理
    private suspend fun handleStandaloneSkipCheck(trackName: String, artistName: String) {
        try {
            Log.d("YTM_Listener", "Standalone check starting for: $artistName - $trackName")
            
            // リリース年を取得
            val year = getOrFetchReleaseYear(trackName, artistName)
            Log.d("YTM_Listener", "Resolved Release Year: ${year ?: "Unknown"} for $trackName")

            // 処理中に曲が変わっていないか確認（非同期処理なので、完了した時にはすでに次の曲にいっている可能性がある）
            if (trackName != lastProcessedTrack || artistName != lastProcessedArtist) {
                Log.d("YTM_Listener", "Track changed during year fetch. Skip check aborted.")
                return
            }

            // すでにこの曲でスキップ処理済みの場合は何もしない
            if (currentTrackSkipped) {
                return
            }

            // スキップ判定
            if (shouldSkip(artistName, year, trackName)) {
                Log.d("YTM_Listener", "Match Skip Rules! Triggering skip command on Android...")
                currentTrackSkipped = true
                skipCurrentTrack(trackName, artistName)
            } else {
                Log.d("YTM_Listener", "Track kept (not matching skip rules)")
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Error in handleStandaloneSkipCheck: ${e.message}", e)
        }
    }

    // 手動スキップと低評価の処理
    private suspend fun handleManualSkipAndDislike() {
        if (isManualSkipping) {
            Log.d("YTM_Listener", "Already executing manual skip. Ignoring.")
            return
        }
        isManualSkipping = true

        try {
            var targetArtist = lastProcessedArtist
            var targetTrack = lastProcessedTrack

            // アプリ起動直後などでメモリ上に情報がない場合はSharedPreferencesから復元
            if (targetArtist == null || targetTrack == null) {
                val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
                targetArtist = prefs.getString("now_playing_artist", null)
                targetTrack = prefs.getString("now_playing_title", null)
            }

            if (targetArtist == null || targetTrack == null) {
                Log.w("YTM_Listener", "Manual skip failed: No active track information.")
                return
            }

            Log.d("YTM_Listener", "Manual skip and dislike requested for: $targetArtist - $targetTrack")

            // 1. ルールの追加 (全年代をスキップ)
            var config = appConfig ?: AppConfig(emptyList(), emptyList())
            val rulesList = config.rules?.toMutableList() ?: mutableListOf()
            
            // 既に同じルールがないか確認
            val exists = rulesList.any { it.artist == targetArtist && it.matchType == "includes" && it.year == 0 && it.yearOperator == "newer_than" }
            if (!exists) {
                rulesList.add(SkipRule(
                    artist = targetArtist,
                    year = 0,
                    yearOperator = "newer_than",
                    matchType = "includes",
                    allowedSongs = emptyList()
                ))
                config = config.copy(rules = rulesList)
                appConfig = config
                
                // 2. SharedPreferences に保存
                val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
                prefs.edit().putString("config_json", Gson().toJson(config)).apply()
                
                // UI側に設定変更を通知する
                sendBroadcast(Intent("com.mudai.ytm_listener.RULES_UPDATED"))
                
                // 2.5. Gist同期が有効ならPushする
                val gistToken = config.gistSync?.token
                val gistId = config.gistSync?.gistId
                if (config.gistSync?.enabled == true && !gistToken.isNullOrEmpty() && !gistId.isNullOrEmpty()) {
                    scope.launch {
                        val result = GistSyncManager.pushConfig(this@YouTubeMusicListenerService, gistToken, gistId)
                        android.os.Handler(android.os.Looper.getMainLooper()).post {
                            android.widget.Toast.makeText(this@YouTubeMusicListenerService, "Gist Push: $result", android.widget.Toast.LENGTH_LONG).show()
                        }
                    }
                } else {
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        android.widget.Toast.makeText(this@YouTubeMusicListenerService, "Gist同期は無効または未設定です", android.widget.Toast.LENGTH_LONG).show()
                    }
                }
                
                Log.d("YTM_Listener", "Added new skip rule for: $targetArtist")
            } else {
                Log.d("YTM_Listener", "Rule for $targetArtist already exists.")
            }

            // 3. 低評価とスキップの実行
            currentTrackSkipped = true
            skipCurrentTrack(targetTrack, targetArtist)
        } finally {
            isManualSkipping = false
        }
    }

    // リリース年のキャッシュ＆取得処理
    private suspend fun getOrFetchReleaseYear(trackName: String, artistName: String): Int? {
        val cacheKey = "$artistName - $trackName".lowercase()
        yearCache[cacheKey]?.let { return it }

        // 1. まずiTunes APIから取得を試みる
        var year = fetchYearFromITunes(trackName, artistName)
        if (year != null) {
            Log.d("YTM_Listener", "Year fetched from iTunes: $year for $trackName")
        }

        // 2. iTunesで見つからなければYouTubeスクレイピングをフォールバックとして実行
        if (year == null) {
            if (!isSearchRateLimited()) {
                val videoId = searchVideoId(trackName, artistName)
                if (videoId != null) {
                    year = fetchYearFromVideo(videoId)
                    if (year != null) {
                        Log.d("YTM_Listener", "Year fetched from YouTube: $year for $trackName")
                    }
                }
            } else {
                Log.d("YTM_Listener", "YouTube search is currently rate limited. Skipping fallback search.")
            }
        }

        if (year != null) {
            yearCache[cacheKey] = year
        }
        return year
    }

    // iTunes APIからリリース年を抽出 (非同期・キャンセル可能)
    private suspend fun fetchYearFromITunes(trackName: String, artistName: String): Int? {
        try {
            val query = "$artistName $trackName"
            val url = "https://itunes.apple.com/search?term=" + Uri.encode(query) + "&entity=song&country=jp&limit=1"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "YTMListener/1.0")
                .build()

            val response = client.newCall(request).await()
            response.use {
                if (!response.isSuccessful) return null
                val jsonStr = response.body?.string() ?: return null
                
                val jsonObject = JSONObject(jsonStr)
                if (jsonObject.optInt("resultCount", 0) > 0) {
                    val results = jsonObject.getJSONArray("results")
                    val firstResult = results.getJSONObject(0)
                    val releaseDate = firstResult.optString("releaseDate", "")
                    if (releaseDate.length >= 4) {
                        return releaseDate.substring(0, 4).toIntOrNull()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Fetch year from iTunes failed: ${e.message}")
        }
        return null
    }

    private fun markSearchRateLimited() {
        lastSearchLimitTime = System.currentTimeMillis()
    }

    private fun isSearchRateLimited(): Boolean {
        if (lastSearchLimitTime == 0L) return false
        val elapsed = System.currentTimeMillis() - lastSearchLimitTime
        // 5分間（300,000ミリ秒）は検索をバイパス
        return elapsed < 300000
    }

    // YouTube検索を行って動画IDを抽出 (非同期・キャンセル可能)
    private suspend fun searchVideoId(trackName: String, artistName: String): String? {
        try {
            val query = "$artistName $trackName topic" // topicを入れることで公式音源を高確率でヒットさせる
            val url = "https://www.youtube.com/results?search_query=" + Uri.encode(query)
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .build()

            val response = client.newCall(request).await()
            response.use {
                if (response.code == 429) {
                    Log.w("YTM_Listener", "YouTube search rate limited (429). Bypassing search for a while.")
                    markSearchRateLimited()
                    return null
                }
                if (!response.isSuccessful) return null
                val html = response.body?.string() ?: return null
                
                if (html.contains("our systems have detected unusual traffic") || html.contains("g-recaptcha")) {
                    Log.w("YTM_Listener", "YouTube search blocked by CAPTCHA. Bypassing search for a while.")
                    markSearchRateLimited()
                    return null
                }

                // "videoId":"XXXXXXXXXXX" を抽出
                val pattern = "\"videoId\":\"([a-zA-Z0-9_-]{11})\"".toRegex()
                val match = pattern.find(html)
                return match?.groupValues?.get(1)
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Search video ID failed: ${e.message}")
            return null
        }
    }

    // 動画ページからリリース年を抽出 (非同期・キャンセル可能)
    private suspend fun fetchYearFromVideo(videoId: String): Int? {
        try {
            val url = "https://www.youtube.com/watch?v=$videoId"
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                .build()

            val response = client.newCall(request).await()
            response.use {
                if (response.code == 429) {
                    Log.w("YTM_Listener", "YouTube fetch year rate limited (429). Bypassing search for a while.")
                    markSearchRateLimited()
                    return null
                }
                if (!response.isSuccessful) return null
                val html = response.body?.string() ?: return null

                if (html.contains("our systems have detected unusual traffic") || html.contains("g-recaptcha")) {
                    Log.w("YTM_Listener", "YouTube watch page blocked by CAPTCHA. Bypassing search for a while.")
                    markSearchRateLimited()
                    return null
                }

                // publishDate または uploadDate から「年」の4桁を抽出
                val pattern = "\"publishDate\":\"(\\d{4})".toRegex()
                val match = pattern.find(html) ?: "uploadDate\":\"(\\d{4})".toRegex().find(html)
                return match?.groupValues?.get(1)?.toIntOrNull()
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Fetch year from video failed: ${e.message}")
            return null
        }
    }

    // 指定ルールによるスキップ判定
    private fun shouldSkip(artist: String, releaseYear: Int?, title: String): Boolean {
        val config = appConfig ?: return false
        val globalAllowed = config.allowedSongs ?: emptyList()
        val rules = config.rules ?: emptyList()

        // 1. グローバルなホワイトリスト
        if (globalAllowed.any { song ->
            val titleMatch = song.title?.let { title.contains(it, ignoreCase = true) } ?: false
            val artistMatch = song.artist?.let { artist.contains(it, ignoreCase = true) } ?: true
            titleMatch && artistMatch
        }) {
            Log.d("YTM_Listener", "KEEP (global whitelist): $title")
            return false
        }

        // 2. アーティスト別の指定年ルール照合
        for (rule in rules) {
            val ruleArtist = rule.artist ?: continue
            val matchType = rule.matchType ?: "includes"
            
            val isArtistMatch = if (matchType.equals("exact", ignoreCase = true)) {
                artist.equals(ruleArtist, ignoreCase = true)
            } else {
                artist.contains(ruleArtist, ignoreCase = true)
            }

            if (isArtistMatch) {
                // ルール個別のホワイトリスト
                val ruleAllowed = rule.allowedSongs ?: emptyList()
                if (ruleAllowed.any { title.contains(it, ignoreCase = true) }) {
                    Log.d("YTM_Listener", "KEEP (rule whitelist): $title")
                    return false
                }

                // 年によるスキップ判定
                val ruleYear = rule.year
                if (ruleYear != null) {
                    if (releaseYear != null) {
                        // 年が取得できた場合: 通常の年比較
                        val operator = rule.yearOperator ?: "newer_than"
                        if (operator.equals("older_than", ignoreCase = true) || operator.equals("before", ignoreCase = true)) {
                            if (releaseYear <= ruleYear) {
                                Log.d("YTM_Listener", "SKIP (year $releaseYear <= $ruleYear): $title")
                                return true
                            }
                        } else { // newer_than or after
                            if (releaseYear >= ruleYear) {
                                Log.d("YTM_Listener", "SKIP (year $releaseYear >= $ruleYear): $title")
                                return true
                            }
                        }
                    } else {
                        // 年が取得できなかった場合: スキップ判定ができないため誤爆を防ぐためにキープ
                        Log.d("YTM_Listener", "KEEP (year unknown, artist '$ruleArtist' matched rule but year is required): $title")
                        return false
                    }
                }
            }
        }
        Log.d("YTM_Listener", "KEEP (no rule matched): $title")
        return false
    }

    // AndroidのMediaSession APIを使用して、再生コントロールに直接「スキップ」コマンドを送信
    // suspend関数。呼び出し元コルーチン内で直列実行する
    //
    // 戦略: skipToNext() を先に送信し、その後に setRating で低評価を送る
    // 理由: setRating を先に送ると、YouTube Music の自動スキップにより
    //       低評価が次の曲に波及するリスクがあるため
    private suspend fun skipCurrentTrack(targetTrack: String, targetArtist: String) {
        try {
            val mediaSessionManager = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            val listenerComponent = ComponentName(this@YouTubeMusicListenerService, YouTubeMusicListenerService::class.java)
            val controllers = mediaSessionManager.getActiveSessions(listenerComponent)
            
            for (controller in controllers) {
                if (controller.packageName == "com.google.android.apps.youtube.music") {
                    
                    // ステップ1: まず低評価を送信
                    try {
                        val rating = Rating.newThumbRating(false)
                        controller.transportControls.setRating(rating)
                        Log.d("YTM_Listener", "[STEP1] Dislike sent for: $targetTrack")
                    } catch (e: Exception) {
                        Log.e("YTM_Listener", "setRating failed: ${e.message}")
                    }

                    // ステップ2: 1500ms 待ち（自動スキップの時間を確保）
                    kotlinx.coroutines.delay(1500)

                    // ステップ3: まだ曲が変わっていなければ、skipToNext() を送信
                    if (targetTrack == lastProcessedTrack && targetArtist == lastProcessedArtist) {
                        controller.transportControls.skipToNext()
                        Log.d("YTM_Listener", "[STEP2] skipToNext sent (auto-skip did not happen) for: $targetTrack")
                    } else {
                        Log.d("YTM_Listener", "[STEP2] Track already changed (auto-skip worked). skipToNext skipped.")
                    }

                    // ステップ4: 次の曲の通知が安定するまでクールダウン（2秒）
                    Log.d("YTM_Listener", "[STEP3] Post-skip cooldown: 2s...")
                    kotlinx.coroutines.delay(2000)

                    break
                }
            }
        } catch (e: Exception) {
            Log.e("YTM_Listener", "Failed to skip current track: ${e.message}", e)
        }
    }
}

// OkHttpのコールバックをコルーチンで待機する拡張関数
suspend fun Call.await(): Response {
    return suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation {
            cancel() // コルーチンがキャンセルされたらOkHttpのリクエストもキャンセル
        }
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response)
            }

            override fun onFailure(call: Call, e: java.io.IOException) {
                continuation.resumeWithException(e)
            }
        })
    }
}
