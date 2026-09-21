# NosTune for Stream Deck 🎛️🎵

> **YouTube Music の楽曲情報・アートワークを Stream Deck の液晶キーにリアルタイム表示＆手元で直感操作できる専用プラグイン**  
> ※ Chrome 拡張機能版「NosTune for YouTube Music」とシームレスに連動します。

---

## 🌟 主な機能 (Features)

- **🖼️ リアルタイム・アートワーク ＆ 楽曲表示（Now Playing）**
  - 再生中のジャケット写真・曲名・アーティスト名を液晶キー全体に美しく描画。
  - 長いタイトルはスムーズにティッカースクロール表示。キーを押すと再生 / 一時停止を即座にトグル。
- **⏭️ 再生コントロール（Next / Previous）**
  - YouTube Music のタブを探すことなく、手元のキーからワンタップで次の曲・前の曲へスキップ。
- **🚫 手元から除外ルールの登録（Skip Artist / Undo）**
  - 気に入らない曲が流れたら、手元のボタンを押すだけでそのアーティストを「NosTune」の除外リストに即時追加＆スキップ。
  - 間違えて登録しても「Undo」ボタンで直前の追加を取り消し可能。
- **🤍 今回だけ聴く / 恒久許可（Allow Once / Allow Permanent）**
  - スキップされた曲でも「やっぱり今聴きたい」時はワンボタンで巻き戻して再生。
- **⚙️ 外部サーバー・常駐アプリ不要**
  - Stream Deck アプリ内部の Node.js エンジンで軽量に動作するため、別途ソフトを起動しておく必要はありません。

---

## 📋 必要な環境 (Requirements)

1. **Stream Deck ソフトウェア**: v6.6 以降（Stream Deck / MK.2 / Plus / Neo / Mobile 等に対応）
2. **Google Chrome** または **Microsoft Edge**
3. **Chrome 拡張機能**: [NosTune for YouTube Music](https://chromewebstore.google.com/) がブラウザにインストールされていること

---

## 🚀 インストール方法 (Installation)

1. [Releases ページ](https://github.com/Oint60/YouTube-Music-Auto-Skipper/releases/latest) にアクセスします。
2. Assets にある **`com.nostune.streamdeck.streamDeckPlugin`** をダウンロードします。
3. ダウンロードしたファイルを **ダブルクリック** します。
4. Stream Deck 公式アプリが自動で立ち上がり、「プラグインが正常にインストールされました」と表示されれば完了です！

---

## 🎮 使い方 (How to Use)

1. Stream Deck 設定画面の右側パネルから **「NosTune (YouTube Music)」** カテゴリを開きます。
2. お好みのキーにアクション（例: `YTM Now Playing` など）をドラッグ＆ドロップして配置します。
3. ブラウザで [YouTube Music](https://music.youtube.com) を開き、曲を再生すると自動的にキー液晶と連動します。

### 配置可能なアクション一覧

| アクション名 | 機能説明 |
| :--- | :--- |
| **YTM Now Playing** | アートワーク＆曲名・アーティスト名を液晶全面に表示。押すと再生/一時停止。 |
| **YTM Next Track** | 次の曲へスキップ。 |
| **YTM Previous Track** | 前の曲へ戻る。 |
| **YTM Skip Artist** | 現在再生中のアーティストを除外ルールに追加してスキップ。 |
| **YTM Undo** | 直前に追加した除外ルールを取り消し。 |
| **YTM Allow Once** | スキップされた曲を「今回だけ聴く」として巻き戻し再生。 |
| **YTM Allow Permanent** | 現在の曲を「恒久ホワイトリスト」に追加。 |
| **YTM Toggle** | NosTune の自動スキップ監視の有効 / 無効を手元で切り替え。 |

---

## ☕ 開発者を応援する (Support)

NosTune が気に入っていただけましたら、[Buy Me a Coffee](https://buymeacoffee.com/leben) にてサポートいただけると今後の励みになります！

---

## 📄 ライセンス (License)

MIT License
