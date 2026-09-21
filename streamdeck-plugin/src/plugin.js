/**
 * NosTune Official Stream Deck Plugin Entry Point
 * Runs inside Stream Deck's Node.js engine.
 * Automatically hosts the local bridge server on port 28945.
 */

const { streamDeck } = require('@elgato/streamdeck');
const { startBridgeServer, queueAction, getCurrentTrack, setTrackUpdateCallback, logToFile } = require('./server');
const { renderNowPlaying, renderNextTrack, renderPreviousTrack, renderActionBadge } = require('./renderer');

// アクティブなキーインスタンスの追跡
const activeActions = {
  nowPlaying: new Set(),
  next: new Set(),
  previous: new Set(),
  skipArtist: new Set(),
  undo: new Set(),
  allowOnce: new Set(),
  allowPermanent: new Set(),
  syncDrive: new Set(),
  toggle: new Set()
};

function getCategoryFromUUID(uuid) {
  if (!uuid) return null;
  if (uuid.endsWith('now-playing')) return 'nowPlaying';
  if (uuid.endsWith('next')) return 'next';
  if (uuid.endsWith('previous')) return 'previous';
  if (uuid.endsWith('skip-artist')) return 'skipArtist';
  if (uuid.endsWith('undo')) return 'undo';
  if (uuid.endsWith('allow-once')) return 'allowOnce';
  if (uuid.endsWith('allow-permanent')) return 'allowPermanent';
  if (uuid.endsWith('sync-drive')) return 'syncDrive';
  if (uuid.endsWith('toggle')) return 'toggle';
  return null;
}

// アートワーク画像のBase64インラインキャッシュ（1.5秒タイムアウト付き）
const artworkCache = new Map();

async function getArtworkDataUri(url) {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  if (artworkCache.has(url)) return artworkCache.get(url);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    if (artworkCache.size > 30) {
      const firstKey = artworkCache.keys().next().value;
      artworkCache.delete(firstKey);
    }
    artworkCache.set(url, dataUri);
    return dataUri;
  } catch (err) {
    logToFile(`[Artwork Error] url: ${url.substring(0, 50)}... ${err.message}`);
    return '';
  }
}

// スクロール設定（個別プロファイル/インスタンスおよびカテゴリ別）
const scrollConfigs = {
  nowPlaying: { disableScroll: false, pauseSeconds: 5, scrollSpeed: 80 },
  next: { disableScroll: false, pauseSeconds: 5, scrollSpeed: 80 },
  previous: { disableScroll: false, pauseSeconds: 5, scrollSpeed: 80 }
};

let trackStartTime = Date.now();
let lastTrackTitle = '';

// 各アクションインスタンスごとの直前描画SVG文字列（差分描画用）
const lastRenderedKeySvg = new Map();

// キー画像の描画更新
async function updateActionImage(action, category, track, elapsed = 0) {
  if (!action) return;
  const t = track || getCurrentTrack();
  const cfg = scrollConfigs[category] || null;

  try {
    let svg = null;
    switch (category) {
      case 'nowPlaying': {
        let artworkDataUri = '';
        if (t && t.artworkUrl) {
          artworkDataUri = await getArtworkDataUri(t.artworkUrl);
        }
        svg = renderNowPlaying({ ...t, artworkUrl: artworkDataUri }, elapsed, cfg);
        break;
      }
      case 'next':
        svg = renderNextTrack(t.nextTrack, elapsed, cfg);
        break;
      case 'previous':
        svg = renderPreviousTrack(t.prevTrack, elapsed, cfg);
        break;
      case 'skipArtist':
        svg = renderActionBadge('🚫', '歌手除外', '', '#b91c1c', '#7f1d1d', '#ffffff');
        break;
      case 'undo':
        svg = renderActionBadge('↩️', '元に戻す', '', '#475569', '#1e293b', '#ffffff');
        break;
      case 'allowOnce':
        svg = renderActionBadge('1️⃣', '今回だけ聴く', '', '#0d9488', '#115e59', '#ffffff');
        break;
      case 'allowPermanent':
        svg = renderActionBadge('⭐', '永久許可', '', '#d97706', '#92400e', '#ffffff');
        break;
      case 'syncDrive':
        svg = renderActionBadge('☁️', '今すぐ同期', '', '#2563eb', '#1e40af', '#ffffff');
        break;
      case 'toggle':
        svg = renderActionBadge(t.isMonitoring ? '🟢' : '🔴', '監視切替', t.isMonitoring ? '有効中' : '停止中', '#334155', '#0f172a', '#ffffff');
        break;
    }

    if (svg) {
      // 直前の SVG と同一なら Stream Deck への通信をスキップ（静止ポーズ中やスクロール不要時はゼロ負荷）
      const actionId = action.id || action;
      if (lastRenderedKeySvg.get(actionId) === svg) {
        return;
      }
      lastRenderedKeySvg.set(actionId, svg);

      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      await action.setImage(dataUri);
      await action.setTitle('');
    }
  } catch (err) {
    logToFile(`[Render Error] ${category}: ${err.message}`);
    console.error(`[NosTune Plugin] Error updating key image for ${category}:`, err);
  }
}

function updateAllKeys(track) {
  const t = track || getCurrentTrack();
  if (t.title !== lastTrackTitle) {
    lastTrackTitle = t.title;
    trackStartTime = Date.now();
    lastRenderedKeySvg.clear();
  }
  logToFile(`[UpdateAllKeys] Track: "${t.title}" by "${t.artist}" (Owner: ${t.activeClientId})`);

  for (const [cat, actionSet] of Object.entries(activeActions)) {
    for (const act of actionSet) {
      updateActionImage(act, cat, t, 0).catch(err => {
        logToFile(`[UpdateAllKeys Fail] ${cat}: ${err.message}`);
      });
    }
  }
}

function applySettings(category, payload) {
  if (!category || !scrollConfigs[category] || !payload) return;
  const data = (payload && payload.settings) ? payload.settings : payload;
  if (data.disableScroll !== undefined) scrollConfigs[category].disableScroll = !!data.disableScroll;
  if (data.pauseSeconds !== undefined) scrollConfigs[category].pauseSeconds = Number(data.pauseSeconds);
  if (data.scrollSpeed !== undefined) scrollConfigs[category].scrollSpeed = Number(data.scrollSpeed);
  logToFile(`[Settings Applied] ${category}: ${JSON.stringify(scrollConfigs[category])}`);
  lastRenderedKeySvg.clear();
}

// 1. キーが表示されたとき（ページ切り替え・プロファイル表示時）
streamDeck.actions.onWillAppear(async (ev) => {
  const category = getCategoryFromUUID(ev.action.manifestId);
  if (category && activeActions[category]) {
    activeActions[category].add(ev.action);
    try {
      const s = await ev.action.getSettings();
      if (s) applySettings(category, s);
    } catch (e) {}
    updateActionImage(ev.action, category).catch(err => {
      logToFile(`[onWillAppear Error] ${category}: ${err.message}`);
    });
  }
});

// 2. キーが非表示になったとき
streamDeck.actions.onWillDisappear((ev) => {
  const category = getCategoryFromUUID(ev.action.manifestId);
  if (category && activeActions[category]) {
    activeActions[category].delete(ev.action);
    const actionId = ev.action.id || ev.action;
    lastRenderedKeySvg.delete(actionId);
  }
});

// 3. 設定変更（Property Inspector からのリアルタイム変更）
streamDeck.ui.onSendToPlugin((ev) => {
  const manifestId = ev.action ? ev.action.manifestId : '';
  const category = getCategoryFromUUID(manifestId);
  logToFile(`[ui.onSendToPlugin] manifestId: ${manifestId}, category: ${category}, payload: ${JSON.stringify(ev.payload)}`);
  applySettings(category, ev.payload);
});

streamDeck.settings.onDidReceiveSettings((ev) => {
  const manifestId = ev.action ? ev.action.manifestId : '';
  const category = getCategoryFromUUID(manifestId);
  logToFile(`[settings.onDidReceiveSettings] manifestId: ${manifestId}, category: ${category}, payload: ${JSON.stringify(ev.payload)}`);
  applySettings(category, ev.payload);
});

// 4. スクロールアニメーション用ループ（100ms周期、差分検出で省負荷）
setInterval(() => {
  const t = getCurrentTrack();
  const animCategories = ['nowPlaying', 'next', 'previous'];
  const elapsed = Date.now() - trackStartTime;

  for (const cat of animCategories) {
    const actionSet = activeActions[cat];
    if (actionSet && actionSet.size > 0) {
      for (const act of actionSet) {
        updateActionImage(act, cat, t, elapsed).catch(() => {});
      }
    }
  }
}, 100);

// 3. キーが押されたとき（アクション実行）
streamDeck.actions.onKeyDown((ev) => {
  const category = getCategoryFromUUID(ev.action.manifestId);
  logToFile(`[KeyDown] Category: ${category}`);

  switch (category) {
    case 'nowPlaying':
      queueAction('play-pause');
      break;
    case 'next':
      queueAction('next');
      break;
    case 'previous':
      queueAction('previous');
      break;
    case 'skipArtist':
      queueAction('skip-artist');
      break;
    case 'undo':
      queueAction('undo');
      break;
    case 'allowOnce':
      queueAction('allow-once');
      break;
    case 'allowPermanent':
      queueAction('allow-permanent');
      break;
    case 'syncDrive':
      queueAction('sync-drive');
      break;
    case 'toggle':
      queueAction('toggle');
      break;
  }
});

// ブラウザからの曲更新コールバック
setTrackUpdateCallback((newTrack) => {
  updateAllKeys(newTrack);
});

// 起動処理
logToFile('[Plugin Startup] Starting embedded bridge server on port 28945...');
startBridgeServer();

logToFile('[Plugin Startup] Connecting to Stream Deck...');
streamDeck.connect();
