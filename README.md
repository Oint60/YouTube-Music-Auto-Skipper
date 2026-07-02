# YouTube Music Auto Skipper

YouTube Music（Web版 / Android版）で再生中の楽曲を監視し、事前に設定したルール（リリース年や特定のアーティスト）に合致した場合に、**自動的に低評価をつけて次の曲へスキップ**するツール群です。
また、外部ツール（Stream Deck や MacroDroid など）と連携して「手動で任意の曲を低評価＆除外リストに追加」することも可能です。

## プロジェクト構成

このリポジトリは、以下の2つのコンポーネントで構成されています。

### 1. PC版 (`youtube-music-skipper`)
- **技術スタック**: Electron, Node.js, Puppeteer
- **役割**: PCのバックグラウンドで常駐し、Puppeteerを通じてYouTube Music（Chrome等）のDOMを監視・操作します。
- **機能**:
  - `config.json` に設定された「指定年以前」や「除外アーティスト」に合致する曲を自動スキップ
  - `localhost` 向けにAPIサーバーを公開し、Stream Deckなどから「現在の曲を除外」「再生中の曲名取得」といった操作が可能

### 2. Android版 (`ytm-listener`)
- **技術スタック**: Kotlin, Android NotificationListenerService, MediaSession API
- **役割**: Android端末上でバックグラウンドサービスとして動作し、YouTube Musicアプリの通知とMediaSessionを監視します。
- **機能**:
  - WebスクレイピングとiTunes APIを用いて、端末単体で再生中の曲のリリース年を特定し、ルール合致時にスキップ
  - Androidの「クイック設定パネル」に専用のタイルを追加し、1タップで「現在再生中のアーティストを除外リストに追加＆低評価＆スキップ」が可能
  - `BroadcastReceiver` を公開しているため、**MacroDroid** などの自動化アプリを使って、イヤホンのボタン操作やスマホのジェスチャーからスキップを発動できます

---

## ☁️ クラウド同期機能 (GitHub Gist)

PC版とAndroid版は、互いに独立して動作しますが、**GitHub Gist** を用いて除外ルール（`config.json` の内容）をシームレスに同期することができます。

### Gist同期のセットアップ方法
1. GitHubの [Personal Access Tokens (classic)](https://github.com/settings/tokens/new) ページへアクセスします。
2. 権限（Scope）で **`gist`** のみにチェックを入れて Token を発行し、必ずコピーして控えておきます。
3. [GitHub Gist](https://gist.github.com/) にアクセスし、空のGistを新しく作成します（ファイル名や内容は適当でOK）。作成後、URLの末尾にある英数字の文字列（Gist ID）を控えます。
4. **PC版**: アプリのタスクトレイアイコンから「設定画面」を開き、「Gist同期設定」に Token と Gist ID を入力して有効化します。
5. **Android版**: アプリのメイン画面下部にある設定パネルに、同じ Token と Gist ID を入力して有効化します。

以降は、PCまたはAndroidで除外アーティストを追加した際に、自動的にGist経由でもう一方のデバイスへルールが共有されます。

---

## 🚀 インストールと起動方法

### PC版 (`youtube-music-skipper`)
1. Node.js がインストールされていることを確認します。
2. ターミナルで `youtube-music-skipper` フォルダを開きます。
3. `npm install` を実行して依存パッケージをインストールします。
4. `npm start` または `node server.js` でアプリを起動します。（タスクトレイに常駐します）

### Android版 (`ytm-listener`)
1. Android Studio を使用してプロジェクトを開き、ビルド（`assembleDebug` 等）を行います。
2. 生成された APK を Android端末にインストールします。
3. インストール後、アプリを起動して「通知へのアクセス」権限を許可してください。

---

## ⚠️ 注意事項
- **APIキーやTokenの取り扱い**: 
  PC版の `config.json` には、GistのToken情報が保存されます。このファイルは `.gitignore` で除外されていますが、ご自身でGistへアップロードしたり共有したりする際は、Token情報が漏洩しないようにご注意ください。
- **YouTubeの仕様変更**: 
  YouTube MusicのDOM構造やAPIの仕様変更により、スキップや年数取得が機能しなくなる可能性があります。
