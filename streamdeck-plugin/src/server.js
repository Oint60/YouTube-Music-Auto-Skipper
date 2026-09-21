/**
 * NosTune Embedded Local Bridge Server
 * Embedded directly inside the Stream Deck Plugin.
 * Listens on port 28945 for Chrome Extension communication.
 * Seamlessly tracks and follows the most recently selected browser window/tab.
 */

const http = require('node:http');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 28945;
const DEBUG_LOG_PATH = path.join(os.tmpdir(), 'nostune_bridge_debug.log');

function logToFile(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, line, 'utf8');
  } catch (e) {}
}

let currentTrack = {
  title: '未再生',
  artist: 'NosTune',
  album: '',
  year: null,
  artworkUrl: '',
  isPlaying: false,
  isMonitoring: true,
  prevTrack: null,
  nextTrack: null
};

let activeClientId = null;
let activeClientIsPlaying = false;
let lastActiveTime = 0;

// 各クライアント（ブラウザ/タブ）の最終選択時刻と最新トラック情報を保存
const clientSelectionTimes = new Map(); // clientId -> lastSelectedTime
const clientTracks = new Map();         // clientId -> trackObject

const sseClients = new Set();
const pendingActions = [];

let onTrackUpdateCallback = null;

function setTrackUpdateCallback(cb) {
  onTrackUpdateCallback = cb;
}

function getCurrentTrack() {
  return currentTrack;
}

function getActiveClientId() {
  return activeClientId;
}

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

function queueAction(actionName) {
  const actionId = 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const item = {
    id: actionId,
    action: actionName,
    timestamp: Date.now(),
    targetClientId: activeClientId // 現在最後に選択されたブラウザのみに実行
  };
  pendingActions.push(item);
  if (pendingActions.length > 50) pendingActions.shift();

  logToFile(`[QueueAction] ${actionName} -> targetClientId: ${activeClientId || 'NONE'}`);

  broadcastSSE({
    type: 'ACTION',
    action: actionName,
    id: actionId,
    timestamp: item.timestamp,
    targetClientId: item.targetClientId
  });

  return actionId;
}

function startBridgeServer() {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 1. SSE Connection: GET /api/events or /events
    if (req.method === 'GET' && (pathname === '/api/events' || pathname === '/events')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(': keep-alive\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // 2. Status check: GET /api/status or /status
    if (req.method === 'GET' && (pathname === '/api/status' || pathname === '/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        currentTrack,
        activeClientId,
        activeClientIsPlaying,
        knownClients: Array.from(clientSelectionTimes.keys()),
        activeClients: sseClients.size,
        pendingCount: pendingActions.length
      }));
      return;
    }

    // 3. Current track: GET /api/track
    if (req.method === 'GET' && pathname === '/api/track') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentTrack));
      return;
    }

    // 4. Update track info from Extension: POST /api/track
    if (req.method === 'POST' && pathname === '/api/track') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const clientId = data.clientId || 'unknown';
          const isPlaying = !!data.isPlaying;
          const isFocused = !!data.isFocused;
          const now = Date.now();

          // 1. 各クライアント自身の最新トラック情報を必ずキャッシュに保存
          const incomingTrack = {
            title: data.title || '未再生',
            artist: data.artist || 'NosTune',
            album: data.album || '',
            year: data.year || null,
            artworkUrl: data.artworkUrl || '',
            isPlaying: isPlaying,
            isMonitoring: data.isMonitoring !== false,
            prevTrack: data.prevTrack || null,
            nextTrack: data.nextTrack || null,
            activeClientId: clientId
          };
          clientTracks.set(clientId, incomingTrack);

          // 2. 選択タイムスタンプを更新
          const reportedSelectTime = Number(data.lastSelectedTime) || (isFocused ? now : 0);
          if (reportedSelectTime > 0) {
            const currentSaved = clientSelectionTimes.get(clientId) || 0;
            if (reportedSelectTime > currentSaved) {
              clientSelectionTimes.set(clientId, reportedSelectTime);
            }
          }

          // 3. 全クライアントの中で「最も直近に選択されたクライアント」を判定
          let mostRecentClientId = activeClientId;
          let maxSelectTime = clientSelectionTimes.get(activeClientId) || 0;

          for (const [cId, sTime] of clientSelectionTimes.entries()) {
            if (sTime > maxSelectTime) {
              maxSelectTime = sTime;
              mostRecentClientId = cId;
            }
          }

          if (!mostRecentClientId || (now - lastActiveTime > 10000)) {
            mostRecentClientId = clientId;
          }

          const previousActiveId = activeClientId;
          const isNowActive = (mostRecentClientId === clientId);

          if (isNowActive) {
            activeClientId = clientId;
            activeClientIsPlaying = isPlaying;
            lastActiveTime = now;

            // アクティブクライアントの最新トラック情報を反映
            currentTrack = incomingTrack;

            if (previousActiveId !== activeClientId) {
              logToFile(`[Owner Switch] Switched to ${activeClientId} (${currentTrack.title} / ${currentTrack.artist})`);
            }

            broadcastSSE({
              type: 'TRACK_UPDATE',
              track: currentTrack
            });

            if (onTrackUpdateCallback) {
              try { onTrackUpdateCallback(currentTrack); } catch (e) {
                logToFile(`[Callback Error] ${e.message}`);
              }
            }
          } else if (previousActiveId !== mostRecentClientId && clientTracks.has(mostRecentClientId)) {
            // もし別クライアントが新オーナーになったのに今回の送信者がそれではない場合でも、新オーナーのトラックを即座に復元
            activeClientId = mostRecentClientId;
            currentTrack = clientTracks.get(activeClientId);
            logToFile(`[Owner Catchup] Restored ${activeClientId} (${currentTrack.title} / ${currentTrack.artist})`);

            broadcastSSE({
              type: 'TRACK_UPDATE',
              track: currentTrack
            });

            if (onTrackUpdateCallback) {
              try { onTrackUpdateCallback(currentTrack); } catch (e) {
                logToFile(`[Callback Error] ${e.message}`);
              }
            }
          }

          // 返却する未処理アクション（自タブ宛てまたは全体宛てのみ）
          const clientLastTimestamp = Number(data.lastActionTimestamp) || 0;
          const actionsToSend = pendingActions.filter(a => {
            if (a.timestamp <= clientLastTimestamp) return false;
            if (a.targetClientId && a.targetClientId !== clientId) return false;
            return true;
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, activeClientId, actions: actionsToSend }));
        } catch (err) {
          logToFile(`[POST /api/track Error] ${err.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // 5. Polling actions: GET /api/actions
    if (req.method === 'GET' && pathname === '/api/actions') {
      const since = Number(parsedUrl.query.since) || 0;
      const clientId = parsedUrl.query.clientId || '';
      const actions = pendingActions.filter(a => {
        if (a.timestamp <= since) return false;
        if (clientId && a.targetClientId && a.targetClientId !== clientId) return false;
        return true;
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, actions }));
      return;
    }

    // 6. Execute action: POST /api/action or GET /api/action
    if ((req.method === 'POST' || req.method === 'GET') && (pathname === '/api/action' || pathname === '/action')) {
      const actionName = (parsedUrl.query && parsedUrl.query.type) || (parsedUrl.query && parsedUrl.query.action) || 'next';
      const actionId = queueAction(actionName);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, queued: actionName, id: actionId, targetClientId: activeClientId }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logToFile(`[Server Warning] Port ${PORT} in use, retrying or piggybacking...`);
    } else {
      logToFile(`[Server Error] ${err.message}`);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    logToFile(`[Server Started] Listening on port ${PORT}`);
  });

  return server;
}

module.exports = {
  PORT,
  startBridgeServer,
  queueAction,
  getCurrentTrack,
  getActiveClientId,
  setTrackUpdateCallback,
  logToFile
};
