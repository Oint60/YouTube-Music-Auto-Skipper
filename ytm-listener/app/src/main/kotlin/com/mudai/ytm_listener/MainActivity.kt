package com.mudai.ytm_listener

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import android.widget.CheckBox
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

class MainActivity : AppCompatActivity() {

    private lateinit var tvExcludes: TextView
    private lateinit var tvPermissionStatus: TextView
    private lateinit var tvNowPlaying: TextView
    private lateinit var btnImport: Button
    private lateinit var btnPermission: Button
    private lateinit var btnAddExcludeRule: Button
    private lateinit var btnManualAddExclude: Button
    private lateinit var etSearch: EditText
    private lateinit var layoutRulesList: LinearLayout

    private lateinit var cbGistEnabled: CheckBox
    private lateinit var etGistToken: EditText
    private lateinit var etGistId: EditText
    private lateinit var btnGistSync: Button
    private var isGistUiUpdating = false

    private var currentTitle: String = ""
    private var currentArtist: String = ""

    companion object {
        private const val REQUEST_CODE_PICK_JSON = 1001
    }

    private val trackReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.mudai.ytm_listener.TRACK_CHANGED") {
                val title = intent.getStringExtra("title") ?: ""
                val artist = intent.getStringExtra("artist") ?: ""
                updateNowPlayingUI(title, artist)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvExcludes = findViewById(R.id.tv_excludes)
        tvPermissionStatus = findViewById(R.id.tv_permission_status)
        tvNowPlaying = findViewById(R.id.tv_now_playing)
        btnImport = findViewById(R.id.btn_import)
        btnPermission = findViewById(R.id.btn_permission)
        btnAddExcludeRule = findViewById(R.id.btn_add_exclude_rule)
        btnManualAddExclude = findViewById(R.id.btn_manual_add_exclude)
        etSearch = findViewById(R.id.et_search)
        layoutRulesList = findViewById(R.id.layout_rules_list)

        btnImport.setOnClickListener {
            openJsonFilePicker()
        }

        btnPermission.setOnClickListener {
            requestNotificationPermission()
        }

        btnAddExcludeRule.setOnClickListener {
            if (currentArtist.isEmpty()) {
                Toast.makeText(this, "現在再生中の曲情報がありません", Toast.LENGTH_SHORT).show()
            } else {
                showAddExcludeRuleDialog(currentArtist)
            }
        }

        btnManualAddExclude.setOnClickListener {
            showAddExcludeRuleDialog("")
        }

        etSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                updateUI(s?.toString() ?: "")
            }
        })

        cbGistEnabled = findViewById(R.id.cb_gist_enabled)
        etGistToken = findViewById(R.id.et_gist_token)
        etGistId = findViewById(R.id.et_gist_id)
        btnGistSync = findViewById(R.id.btn_gist_sync)

        val gistWatcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                saveGistConfig()
            }
        }
        etGistToken.addTextChangedListener(gistWatcher)
        etGistId.addTextChangedListener(gistWatcher)
        cbGistEnabled.setOnCheckedChangeListener { _, _ -> saveGistConfig() }

        btnGistSync.setOnClickListener {
            saveGistConfig()
            val token = etGistToken.text.toString().trim()
            val gistId = etGistId.text.toString().trim()
            if (!cbGistEnabled.isChecked || token.isEmpty() || gistId.isEmpty()) {
                Toast.makeText(this, "同期を有効にし、TokenとIDを入力してください", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            btnGistSync.isEnabled = false
            btnGistSync.text = "同期中..."
            CoroutineScope(Dispatchers.Main).launch {
                val success = GistSyncManager.pullConfig(this@MainActivity, token, gistId)
                if (success) {
                    Toast.makeText(this@MainActivity, "Gistから同期しました", Toast.LENGTH_SHORT).show()
                    updateUI()
                } else {
                    Toast.makeText(this@MainActivity, "Gist同期に失敗しました", Toast.LENGTH_SHORT).show()
                }
                btnGistSync.isEnabled = true
                btnGistSync.text = "今すぐ同期 (Pull)"
            }
        }

        loadGistConfigToUi()
        updateUI()
        startListenerService()
    }

    private fun loadGistConfigToUi() {
        isGistUiUpdating = true
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        val configJson = prefs.getString("config_json", "{}") ?: "{}"
        try {
            val configObj = Gson().fromJson(configJson, AppConfig::class.java)
            val gist = configObj?.gistSync
            if (gist != null) {
                cbGistEnabled.isChecked = gist.enabled
                etGistToken.setText(gist.token)
                etGistId.setText(gist.gistId)
            }
        } catch (e: Exception) {}
        isGistUiUpdating = false
    }

    private fun saveGistConfig() {
        if (isGistUiUpdating) return
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        val configJson = prefs.getString("config_json", "{}") ?: "{}"
        val gson = Gson()
        val configObj = try {
            gson.fromJson(configJson, AppConfig::class.java) ?: AppConfig()
        } catch (e: Exception) { AppConfig() }
        
        configObj.gistSync = GistSyncConfig(
            enabled = cbGistEnabled.isChecked,
            token = etGistToken.text.toString().trim(),
            gistId = etGistId.text.toString().trim()
        )
        prefs.edit().putString("config_json", gson.toJson(configObj)).apply()
        
        // Serviceに変更を通知して再読み込みさせる
        notifySettingsChanged()
    }

    override fun onResume() {
        super.onResume()
        checkNotificationPermission()
        
        // 保存されている再生中の曲を復元表示
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        val title = prefs.getString("now_playing_title", "") ?: ""
        val artist = prefs.getString("now_playing_artist", "") ?: ""
        updateNowPlayingUI(title, artist)

        // ブロードキャストの登録 (再生中トラック)
        val filter = IntentFilter("com.mudai.ytm_listener.TRACK_CHANGED")
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(trackReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(trackReceiver, filter)
        }

        // ブロードキャストの登録 (ルール追加時のUI更新)
        val rulesFilter = IntentFilter("com.mudai.ytm_listener.RULES_UPDATED")
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(rulesReceiver, rulesFilter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(rulesReceiver, rulesFilter)
        }
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(trackReceiver)
        unregisterReceiver(rulesReceiver)
    }

    private val rulesReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.mudai.ytm_listener.RULES_UPDATED") {
                updateUI(etSearch.text.toString())
            }
        }
    }

    private fun updateNowPlayingUI(title: String, artist: String) {
        currentTitle = title
        currentArtist = artist
        if (title.isNotEmpty() && artist.isNotEmpty()) {
            tvNowPlaying.text = "$artist - $title"
            tvNowPlaying.setTextColor(resources.getColor(android.R.color.black))
        } else {
            tvNowPlaying.text = "再生中の曲はありません"
            tvNowPlaying.setTextColor(resources.getColor(android.R.color.darker_gray))
        }
    }

    private fun startListenerService() {
        if (isNotificationServiceEnabled()) {
            val serviceIntent = Intent(this, YouTubeMusicListenerService::class.java)
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun isNotificationServiceEnabled(): Boolean {
        val enabledListeners = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return enabledListeners != null && enabledListeners.contains(packageName)
    }

    private fun checkNotificationPermission() {
        val isEnabled = isNotificationServiceEnabled()
        if (isEnabled) {
            tvPermissionStatus.text = "通知権限: 許可済み"
            tvPermissionStatus.setTextColor(resources.getColor(android.R.color.holo_green_dark))
            btnPermission.isEnabled = false
            btnPermission.text = "権限許可済み"
        } else {
            tvPermissionStatus.text = "通知権限: 未許可"
            tvPermissionStatus.setTextColor(resources.getColor(android.R.color.holo_red_dark))
            btnPermission.isEnabled = true
            btnPermission.text = "通知アクセス権限を許可"
        }
    }

    private fun requestNotificationPermission() {
        val context = this
        val adbCommand = "adb shell settings put secure enabled_notification_listeners com.mudai.ytm_listener/com.mudai.ytm_listener.YouTubeMusicListenerService"
        
        val message = "Android 13以降では、ストア外から直接インストールしたアプリの通知アクセス設定がグレーアウト（制限付き設定）されて許可できない場合があります。\n\n" +
                "【解決方法】\n" +
                "1. 「設定画面を開く」をタップし、一覧から「YTM Listener」を探します。\n" +
                "2. 権限がグレーアウトしている場合、端末の設定に戻り、[アプリ] -> [すべてのアプリ] -> [YTM Listener] を開き、右上の「︙」（三点リーダー）から「制限付き設定を許可」を実行してください。\n" +
                "3. 三点リーダーが表示されない場合は、過去の同名アプリのゴミが残っている可能性があります。アプリを一度完全にアンインストールしてから再インストールし直してください。\n" +
                "4. PCとUSB接続が可能な場合、下記のコマンドを実行することで、制限をバイパスして直接通知アクセス権限をONにできます。"
        
        val tvMessage = TextView(context).apply {
            text = message
            textSize = 13f
            setTextColor(0xFF333333.toInt())
            setPadding(32, 24, 32, 8)
        }
        
        val tvCommand = TextView(context).apply {
            text = adbCommand
            textSize = 12f
            setPadding(32, 8, 32, 24)
            setTextColor(0xFF1E88E5.toInt())
            setTextIsSelectable(true)
        }
        
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(tvMessage)
            addView(tvCommand)
        }

        AlertDialog.Builder(this)
            .setTitle("通知アクセス権限の許可について")
            .setView(container)
            .setPositiveButton("設定画面を開く") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(context, "設定画面を開けませんでした。手動で許可してください。", Toast.LENGTH_LONG).show()
                }
            }
            .setNeutralButton("ADBコマンドをコピー") { _, _ ->
                try {
                    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val clip = ClipData.newPlainText("YTM Listener ADB Command", adbCommand)
                    clipboard.setPrimaryClip(clip)
                    Toast.makeText(context, "ADBコマンドをクリップボードにコピーしました", Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Toast.makeText(context, "コピーに失敗しました: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("キャンセル", null)
            .show()
    }

    private fun openJsonFilePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
        }
        startActivityForResult(intent, REQUEST_CODE_PICK_JSON)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_PICK_JSON && resultCode == Activity.RESULT_OK) {
            data?.data?.let { uri ->
                importSettingsFromJson(uri)
            }
        }
    }

    private fun importSettingsFromJson(uri: Uri) {
        try {
            contentResolver.openInputStream(uri)?.use { inputStream ->
                val reader = BufferedReader(InputStreamReader(inputStream))
                val jsonStr = reader.readText()
                val jsonObject = JSONObject(jsonStr)

                // 簡易除外アーティスト
                val excludeList = mutableListOf<String>()
                val excludesArray = jsonObject.optJSONArray("exclude_artists")
                if (excludesArray != null) {
                    for (i in 0 until excludesArray.length()) {
                        excludeList.add(excludesArray.getString(i))
                    }
                }

                // 保存
                val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
                prefs.edit().apply {
                    putString("exclude_artists", Gson().toJson(excludeList))
                    putString("config_json", jsonStr) // JSON全体を保存
                    apply()
                }

                Toast.makeText(this, "設定をインポートしました", Toast.LENGTH_SHORT).show()
                
                // インポート後は検索欄をクリアして再描画
                etSearch.setText("")
                updateUI()

                // 設定更新通知
                notifySettingsChanged()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "インポート失敗: ${e.message}", Toast.LENGTH_LONG).show()
            e.printStackTrace()
        }
    }

    private fun notifySettingsChanged() {
        val serviceIntent = Intent(this, YouTubeMusicListenerService::class.java).apply {
            action = YouTubeMusicListenerService.ACTION_SETTINGS_CHANGED
        }
        startService(serviceIntent)
    }

    private fun updateUI(filterText: String = "") {
        val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
        val excludeArtistsJson = prefs.getString("exclude_artists", "[]") ?: "[]"
        val configJson = prefs.getString("config_json", "{}") ?: "{}"
        
        var excludesCount = 0
        try {
            val listType = object : TypeToken<List<String>>() {}.type
            val list: List<String> = Gson().fromJson(excludeArtistsJson, listType)
            excludesCount = list.size
        } catch (e: Exception) {
            e.printStackTrace()
        }

        var configObj: AppConfig? = null
        try {
            configObj = Gson().fromJson(configJson, AppConfig::class.java)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        val rulesCount = configObj?.rules?.size ?: 0
        
        // 許可曲の総数をカウント
        var allowedCount = 0
        configObj?.rules?.forEach { rule ->
            allowedCount += rule.allowedSongs?.size ?: 0
        }

        tvExcludes.text = "簡易除外: ${excludesCount}件 / 指定年ルール: ${rulesCount}件 / 許可曲: ${allowedCount}件"

        // ルール一覧の動的描画
        layoutRulesList.removeAllViews()

        val context = this
        val dpToPx = { dp: Int -> (dp * resources.displayMetrics.density).toInt() }

        val lpCard = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            setMargins(0, 0, 0, dpToPx(8))
        }

        val lpRow = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        // 1. 簡易除外アーティストの一覧表示
        val excludeArtistsList = try {
            val listType = object : TypeToken<List<String>>() {}.type
            Gson().fromJson<List<String>>(excludeArtistsJson, listType) ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }

        for (artistName in excludeArtistsList) {
            // 検索フィルタチェック
            if (filterText.isNotEmpty() && !artistName.contains(filterText, ignoreCase = true)) {
                continue
            }

            val itemView = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = lpCard
                setBackgroundColor(0xFFEEEEEE.toInt())
                setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
            }

            val tvInfo = TextView(context).apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                text = "$artistName（簡易除外）"
                setTextColor(0xFF333333.toInt())
                textSize = 14f
            }
            itemView.addView(tvInfo)

            val btnDelete = Button(context).apply {
                text = "削除"
                textSize = 10f
                backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFD32F2F.toInt())
                layoutParams = LinearLayout.LayoutParams(dpToPx(60), dpToPx(36))
                setOnClickListener {
                    deleteSimpleExclude(artistName)
                }
            }
            itemView.addView(btnDelete)

            layoutRulesList.addView(itemView)
        }

        // 2. 詳細指定年ルールの表示
        val rulesList = configObj?.rules ?: emptyList()
        for (i in rulesList.indices) {
            val rule = rulesList[i]
            val artistName = rule.artist ?: "Unknown"

            // 検索フィルタチェック
            if (filterText.isNotEmpty() && !artistName.contains(filterText, ignoreCase = true)) {
                continue
            }

            val matchTypeStr = if (rule.matchType == "exact") "一致" else "含む"
            val yearStr = if (rule.year != null) "${rule.year}年" else "全年代"
            val operatorStr = if (rule.year != null) {
                if (rule.yearOperator == "older_than") "以前" else "以降"
            } else ""

            val itemView = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = lpCard
                setBackgroundColor(0xFFE3F2FD.toInt())
                setPadding(dpToPx(10), dpToPx(8), dpToPx(10), dpToPx(8))
            }

            val mainRow = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = lpRow
            }

            // 見切れないよう、2行表記に統一
            val tvInfo = TextView(context).apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                text = "$artistName（$matchTypeStr）\n$yearStr（$operatorStr）"
                setTextColor(0xFF0D47A1.toInt())
                textSize = 14f
            }
            mainRow.addView(tvInfo)

            // アクションボタンを並べるレイアウト
            val buttonContainer = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            }

            // 許可曲追加ボタン
            val btnAddSong = Button(context).apply {
                text = "許可曲+"
                textSize = 9f
                backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF4CAF50.toInt())
                layoutParams = LinearLayout.LayoutParams(dpToPx(65), dpToPx(36)).apply {
                    rightMargin = dpToPx(4)
                }
                setOnClickListener {
                    showAddSongToRuleDialog(i, artistName)
                }
            }
            buttonContainer.addView(btnAddSong)

            val btnDelete = Button(context).apply {
                text = "削除"
                textSize = 10f
                backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFD32F2F.toInt())
                layoutParams = LinearLayout.LayoutParams(dpToPx(60), dpToPx(36))
                setOnClickListener {
                    deleteDetailRule(i)
                }
            }
            buttonContainer.addView(btnDelete)
            mainRow.addView(buttonContainer)
            itemView.addView(mainRow)

            // 個別許可曲の表示
            val allowedSongs = rule.allowedSongs ?: emptyList()
            if (allowedSongs.isNotEmpty()) {
                val tvAllowedLabel = TextView(context).apply {
                    text = "  └ 許可曲: " + allowedSongs.joinToString(", ")
                    textSize = 12f
                    setTextColor(0xFF555555.toInt())
                    setPadding(0, dpToPx(4), 0, 0)
                }
                itemView.addView(tvAllowedLabel)
            }

            layoutRulesList.addView(itemView)
        }
    }

    private fun deleteSimpleExclude(artist: String) {
        try {
            val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
            val excludeArtistsJson = prefs.getString("exclude_artists", "[]") ?: "[]"
            val listType = object : TypeToken<List<String>>() {}.type
            val list: MutableList<String> = Gson().fromJson(excludeArtistsJson, listType)
            
            list.remove(artist)

            prefs.edit().putString("exclude_artists", Gson().toJson(list)).apply()
            Toast.makeText(this, "削除しました", Toast.LENGTH_SHORT).show()
            updateUI(etSearch.text.toString())
            notifySettingsChanged()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun deleteDetailRule(index: Int) {
        try {
            val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
            val configJsonStr = prefs.getString("config_json", "{}") ?: "{}"
            val configObj = Gson().fromJson(configJsonStr, AppConfig::class.java) ?: return
            val rulesList = (configObj.rules ?: emptyList()).toMutableList()

            if (index in rulesList.indices) {
                rulesList.removeAt(index)
                val updatedConfig = AppConfig(
                    allowedSongs = configObj.allowedSongs ?: emptyList(),
                    rules = rulesList
                )
                prefs.edit().putString("config_json", Gson().toJson(updatedConfig)).apply()
                Toast.makeText(this, "削除しました", Toast.LENGTH_SHORT).show()
                updateUI(etSearch.text.toString())
                notifySettingsChanged()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun showAddExcludeRuleDialog(initialArtist: String) {
        val context = this
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val paddingPx = (16 * resources.displayMetrics.density).toInt()
            setPadding(paddingPx, paddingPx, paddingPx, paddingPx)
        }

        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = (6 * resources.displayMetrics.density).toInt()
            bottomMargin = (6 * resources.displayMetrics.density).toInt()
        }

        val tvArtistLabel = TextView(context).apply { text = "アーティスト名" }
        layout.addView(tvArtistLabel)

        val etArtist = EditText(context).apply {
            setText(initialArtist)
            layoutParams = lp
        }
        layout.addView(etArtist)

        val tvMatchLabel = TextView(context).apply { text = "一致条件" }
        layout.addView(tvMatchLabel)

        val rgMatch = RadioGroup(context).apply {
            orientation = RadioGroup.HORIZONTAL
            layoutParams = lp
        }
        val rbIncludes = RadioButton(context).apply {
            text = "含む"
            isChecked = true
        }
        val rbExact = RadioButton(context).apply {
            text = "完全一致"
        }
        rgMatch.addView(rbIncludes)
        rgMatch.addView(rbExact)
        layout.addView(rgMatch)

        val tvYearLabel = TextView(context).apply { text = "リリース年条件（空欄で全曲対象）" }
        layout.addView(tvYearLabel)

        val etYear = EditText(context).apply {
            hint = "例: 2020"
            inputType = InputType.TYPE_CLASS_NUMBER
            layoutParams = lp
        }
        layout.addView(etYear)

        val rgOperator = RadioGroup(context).apply {
            orientation = RadioGroup.HORIZONTAL
            layoutParams = lp
        }
        val rbNewer = RadioButton(context).apply {
            text = "以降をスキップ"
            isChecked = true
        }
        val rbOlder = RadioButton(context).apply {
            text = "以前をスキップ"
        }
        rgOperator.addView(rbNewer)
        rgOperator.addView(rbOlder)
        layout.addView(rgOperator)

        // スキップ除外曲の入力欄
        val tvAllowedLabel = TextView(context).apply { text = "除外しない（許可する）曲名（カンマ区切りで複数可）" }
        layout.addView(tvAllowedLabel)

        val etAllowed = EditText(context).apply {
            hint = "例: Song A, Song B"
            layoutParams = lp
        }
        layout.addView(etAllowed)

        AlertDialog.Builder(this)
            .setTitle(if (initialArtist.isEmpty()) "手動ルールの追加" else "除外ルールの追加")
            .setView(layout)
            .setPositiveButton("追加") { _, _ ->
                val artistName = etArtist.text.toString().trim()
                if (artistName.isEmpty()) {
                    Toast.makeText(context, "アーティスト名を入力してください", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val matchType = if (rbExact.isChecked) "exact" else "includes"
                val yearInput = etYear.text.toString().trim()
                val yearVal = if (yearInput.isNotEmpty()) yearInput.toIntOrNull() else null
                val yearOperator = if (rbOlder.isChecked) "older_than" else "newer_than"

                val allowedInput = etAllowed.text.toString().trim()
                val allowedSongs = if (allowedInput.isNotEmpty()) {
                    allowedInput.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                } else emptyList()

                saveNewExcludeRule(artistName, matchType, yearVal, yearOperator, allowedSongs)
            }
            .setNegativeButton("キャンセル", null)
            .show()
    }

    private fun saveNewExcludeRule(artist: String, matchType: String, year: Int?, yearOperator: String, allowedSongs: List<String>) {
        try {
            val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
            val configJsonStr = prefs.getString("config_json", "{}") ?: "{}"
            
            val configObj = try {
                Gson().fromJson(configJsonStr, AppConfig::class.java) ?: AppConfig(mutableListOf(), mutableListOf())
            } catch (e: Exception) {
                AppConfig(mutableListOf(), mutableListOf())
            }

            val rulesList = (configObj.rules ?: emptyList()).toMutableList()
            
            // 重複チェック
            val alreadyExists = rulesList.any { 
                it.artist.equals(artist, ignoreCase = true) && 
                it.matchType == matchType && 
                it.year == year && 
                it.yearOperator == yearOperator 
            }
            if (alreadyExists) {
                Toast.makeText(this, "このルールは既に登録されています", Toast.LENGTH_SHORT).show()
                return
            }

            // ルールを追加
            val newRule = SkipRule(
                artist = artist,
                year = year,
                allowedSongs = allowedSongs,
                matchType = matchType,
                yearOperator = yearOperator
            )
            rulesList.add(newRule)

            val updatedConfig = AppConfig(
                allowedSongs = configObj.allowedSongs ?: emptyList(),
                rules = rulesList
            )

            val newJsonStr = Gson().toJson(updatedConfig)
            prefs.edit().putString("config_json", newJsonStr).apply()

            Toast.makeText(this, "ルールを追加しました", Toast.LENGTH_SHORT).show()
            
            // 追加後は検索欄をクリアして再描画
            etSearch.setText("")
            updateUI()
            notifySettingsChanged()
        } catch (e: Exception) {
            Toast.makeText(this, "ルールの保存に失敗しました: ${e.message}", Toast.LENGTH_LONG).show()
            e.printStackTrace()
        }
    }

    private fun showAddSongToRuleDialog(ruleIndex: Int, artistName: String) {
        val context = this
        val etTitle = EditText(context).apply {
            hint = "例: Allowed Song Title"
        }

        AlertDialog.Builder(this)
            .setTitle("「$artistName」の許可曲追加")
            .setMessage("スキップ対象外にする曲名を入力してください：")
            .setView(etTitle)
            .setPositiveButton("追加") { _, _ ->
                val songTitle = etTitle.text.toString().trim()
                if (songTitle.isEmpty()) {
                    Toast.makeText(context, "曲名を入力してください", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                saveSongToExistingRule(ruleIndex, songTitle)
            }
            .setNegativeButton("キャンセル", null)
            .show()
    }

    private fun saveSongToExistingRule(ruleIndex: Int, title: String) {
        try {
            val prefs = getSharedPreferences("ytm_listener_prefs", Context.MODE_PRIVATE)
            val configJsonStr = prefs.getString("config_json", "{}") ?: "{}"
            val configObj = Gson().fromJson(configJsonStr, AppConfig::class.java) ?: return
            val rulesList = (configObj.rules ?: emptyList()).toMutableList()

            if (ruleIndex in rulesList.indices) {
                val rule = rulesList[ruleIndex]
                val allowedList = (rule.allowedSongs ?: emptyList()).toMutableList()
                
                if (allowedList.contains(title)) {
                    Toast.makeText(this, "この曲は既に登録されています", Toast.LENGTH_SHORT).show()
                    return
                }
                allowedList.add(title)

                rulesList[ruleIndex] = SkipRule(
                    artist = rule.artist,
                    year = rule.year,
                    allowedSongs = allowedList,
                    matchType = rule.matchType,
                    yearOperator = rule.yearOperator
                )

                val updatedConfig = AppConfig(
                    allowedSongs = configObj.allowedSongs ?: emptyList(),
                    rules = rulesList
                )

                prefs.edit().putString("config_json", Gson().toJson(updatedConfig)).apply()
                Toast.makeText(this, "許可曲を追加しました", Toast.LENGTH_SHORT).show()
                updateUI(etSearch.text.toString())
                notifySettingsChanged()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
