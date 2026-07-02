package com.mudai.ytm_listener

import android.content.Intent
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

class SkipTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile
        if (tile != null) {
            tile.state = Tile.STATE_INACTIVE
            tile.updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        Log.d("SkipTileService", "Quick Settings Tile clicked!")
        
        // YouTubeMusicListenerService に手動スキップのブロードキャストを送信
        val intent = Intent("com.mudai.ytm_listener.ACTION_MANUAL_SKIP")
        intent.setPackage(packageName)
        sendBroadcast(intent)
        
        // ボタン式にするため、常にINACTIVE状態を維持する
        val tile = qsTile
        if (tile != null) {
            tile.state = Tile.STATE_INACTIVE
            tile.updateTile()
        }
        
        // 注意: Android 12以降では ACTION_CLOSE_SYSTEM_DIALOGS によるパネル閉鎖は
        // SecurityExceptionを引き起こしてアプリをフリーズさせるため削除しました
    }
}
