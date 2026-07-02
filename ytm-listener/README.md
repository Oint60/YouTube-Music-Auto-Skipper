# YTM Listener (YouTube Music Notification Listener Android App)

YouTube Music の再生通知から曲名とアーティスト名を抽出し、PC 上で稼働する YouTube Music Skipper（antigravity 既存ツール）にリアルタイムで転送する Android アプリです。

## 主な機能

1. **バックグラウンド常駐・通知監視**: 
   `NotificationListenerService` を使用し、バックグラウンドおよびスリープ状態でも常時 YouTube Music (`com.google.android.apps.youtube.music`) の再生情報を検知。
2. **フォアグラウンドサービス**:
   省電力機能（タスクキラー等）による強制終了を防ぐため、フォアグラウンドサービス（ステータスバー常駐）として安全に動作します。
3. **設定JSONインポート**:
   PC 版の既存ツールで使用している設定ファイル（JSON）をそのまま読み込み、API エンドポイント（送信先）や、送信除外（`exclude_artists`）をアプリに反映できます。

---

## 使い方・連携手順

### 1. PC 側の準備（既存ツール）
PC 上で `youtube-music-skipper` (Electronアプリ) が起動しており、かつ監視が開始されていることを確認してください。
* PC 側は、自動的にポート **`8080`** で Android からの通知を待つ HTTP サーバー（`/api/track`）として待機状態になります。

### 2. アプリのビルド・端末へのインストール
1. Android Studio を開き、`ytm-listener` ディレクトリをプロジェクトとして読み込みます。
2. Android 端末（実機推奨）をPCに接続し、USBデバッグを有効化して、アプリをビルド＆インストールします。

### 3. アプリ起動後の初期設定
1. **通知アクセス権限の付与**:
   * アプリ起動後、画面に「通知権限: 未許可」と表示される場合、**「通知アクセス権限を許可」**ボタンをタップします。
   * Android システムの「デバイスとアプリの通知」設定が開くので、**「YTM Listener」**を探してオン（有効）にします。
2. **設定JSONのインポート**:
   * **「設定JSONをインポート」**ボタンをタップします。
   * ファイルピッカーが開くので、あらかじめ端末に送信・保存しておいた `config.json` を選択します。
   * インポートすると、画面に「APIエンドポイント」と「除外アーティストの登録数」が表示されます。

#### インポートする設定JSONのサンプル (`config.json`)
```json
{
  "api_endpoint": "http://[あなたのPCのローカルIP]:8080/api/track",
  "exclude_artists": [
    "除外したいアーティストA",
    "除外したいアーティストB"
  ]
}
```
※ `[あなたのPCのローカルIP]` 部分は、PCが所属しているローカルネットワークのIPアドレス（例: `192.168.1.15`）に変更してください。

---

## 技術スタック・要件
* **最小SDK**: Android 8.0 (API 26) 以上
* **ターゲットSDK**: Android 14 (API 34)
* **開発言語**: Kotlin
* **主要ライブラリ**: 
  * OkHttp3 (HTTP 非同期通信)
  * Gson (JSONのシリアライズ・デシリアライズ)
  * Kotlin Coroutines (非同期ワーカースレッド)
