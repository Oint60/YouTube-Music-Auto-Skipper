# Privacy Policy for NosTune for YouTube Music

*Last Updated: September 6, 2026*

NosTune ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how our Chrome extension handles your data.

---

## 1. Data Collection and Storage
NosTune does **NOT** collect, transmit, sell, or share any personal identifiable information, web browsing history, or user activity logs.
- All configuration settings (such as your skip rules, artist exclusion lists, release year filters, track allow/block lists, UI positions, and language preferences) are stored strictly and locally on your device using Chrome's `chrome.storage.local` API.
- Your data never leaves your browser and is never uploaded to any remote server owned by us or third parties.

## 2. Host Permissions and Web Interaction
- **`https://music.youtube.com/*`**:
  The extension injects a lightweight content script into YouTube Music solely to detect the currently playing track's metadata (track title, artist name, and release year) and perform playback controls (such as skipping to the next song) based strictly on the rules you defined.
- **`http://127.0.0.1:28945/*` (Stream Deck Local Bridge)**:
  Used exclusively to communicate locally with the NosTune Stream Deck plugin on your device to display track metadata and receive button actions. No data ever leaves your computer.
- **YouTube Music Internal Search**:
  The "Suggest Similar Artists" feature utilizes YouTube Music's internal search mechanisms to retrieve related artists. No third-party API (such as Last.fm) is used, and no personal data is transmitted.

## 3. Remote Code
The extension does **NOT** execute any remote code. All JavaScript files, styles, and assets are fully self-contained within the official extension package distributed through the Chrome Web Store.

## 4. Changes to This Policy
We may update this Privacy Policy from time to time. Any changes will be posted directly to this repository.

## 5. Contact
If you have any questions or feedback regarding this Privacy Policy, please feel free to open an issue in our GitHub repository:  
https://github.com/Oint60/YouTube-Music-Auto-Skipper/issues

---

# プライバシーポリシー（日本語要約）

*最終更新日: 2026年9月21日*

NosTune（以下「本拡張機能」）は、ユーザーのプライバシー保護を最優先事項として設計されています。

### 1. データの収集および保管について
本拡張機能は、ユーザーの個人を特定できる情報、閲覧履歴、操作ログ等を収集・外部送信・第三者へ提供することは**一切ありません**。
ユーザーが登録した除外ルール（アーティスト名、年代指定、楽曲制御設定等）やUI設定は、ブラウザ内のローカルストレージ（`chrome.storage.local`）にのみ安全に保管されます。

### 2. アクセス権限および通信について
- **YouTube Music (`https://music.youtube.com/*`)**: 再生中の楽曲情報取得およびスキップ制御、画面上への操作UI表示のためにのみ使用されます。
- **Stream Deck ローカル通信 (`http://127.0.0.1:28945/*`)**: PC内で動作する専用 Stream Deck プラグインとの間で曲名情報表示・ボタン操作の送受信を行うためにのみ使用されます（完全にローカルPC内で完結し、外部へ送信されることはありません）。
- **関連歌手の提案機能**: YouTube Music の公式検索機構を利用して類似アーティストを取得します。サードパーティAPI（Last.fm等）への外部送信は行いません。

### 3. お問い合わせ
ご質問やご不明点がある場合は、GitHubリポジトリの Issue にてお問い合わせください。  
https://github.com/Oint60/YouTube-Music-Auto-Skipper/issues
