const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const skipper = require('./skipper');
const child_process = require('child_process');
const gistSync = require('./gist_sync');

let mainWindow;
let tray = null;
let apiServer = null;
let lastAddedArtistViaStreamDeck = null;
const CONFIG_PATH = path.resolve(__dirname, 'config.json');

// シンプルなアイコンをBase64で作成
const iconBase64 = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAGVJREFUOE9jZKAQMFKon2HUAAaM0dHR/2H4P5rm////+PThGgHThGsAA8RpwjWAAeI04RrAAHGa+AxgGEYNoIAmPABQ/QYtAA2n/6M1/h+tAf+P1oB/wBpgwE2f6AYwEKeJ4RoAgJshcW4i2BIAAAAASUVORK5CYII=";

function createTray() {
  const customIconPath = path.join(__dirname, 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(customIconPath);
  } catch(e) {
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '設定を開く', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: '終了', click: () => {
      app.isQuiting = true;
      app.quit();
    }}
  ]);
  
  tray.setToolTip('YouTube Music Skipper');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 750,
    height: 850,
    title: 'YT Music Skipper',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide(); // トレイに格納
    }
    return false;
  });
}

app.whenReady().then(async () => {
  createTray();
  createWindow();

  // 起動時の初期 Pull
  if (fs.existsSync(CONFIG_PATH)) {
    const currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (currentConfig.gistSync && currentConfig.gistSync.enabled && currentConfig.gistSync.token && currentConfig.gistSync.gistId) {
      console.log('Fetching config from Gist on startup...');
      const pulled = await gistSync.pullFromGist(currentConfig.gistSync.token, currentConfig.gistSync.gistId);
      if (pulled) {
        currentConfig.rules = pulled.rules || [];
        currentConfig.allowedSongs = pulled.allowedSongs || [];
        let migrated = false;
        currentConfig.rules.forEach(r => {
          if (r.year === 1900 && r.yearOperator === 'older_than') {
            r.year = 0; r.yearOperator = 'newer_than'; migrated = true;
          }
        });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
        console.log('Config updated from Gist successfully.' + (migrated ? ' (Migrated rules)' : ''));
        // Gist側も書き換えるためにPush
        if (migrated) {
          gistSync.pushToGist(currentConfig.gistSync.token, currentConfig.gistSync.gistId, currentConfig).catch(e=>console.error(e));
        }
      }
    }
  }

  startApiServer();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// IPC 通信のハンドリング
ipcMain.handle('get-config', () => {
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    let migrated = false;
    config.rules.forEach(r => {
      if (r.year === 1900 && r.yearOperator === 'older_than') {
        r.year = 0; r.yearOperator = 'newer_than'; migrated = true;
      }
    });
    if (migrated) fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return config;
  }
  return { rules: [] };
});

ipcMain.handle('save-config', (event, newConfig) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
  skipper.setConfig(newConfig);
  if (newConfig.gistSync && newConfig.gistSync.enabled && newConfig.gistSync.token && newConfig.gistSync.gistId) {
    gistSync.pushToGist(newConfig.gistSync.token, newConfig.gistSync.gistId, newConfig);
  }
  return true;
});

ipcMain.handle('manual-gist-sync', async () => {
  if (!fs.existsSync(CONFIG_PATH)) return { success: false, error: 'ローカル設定がありません' };
  const currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  if (!currentConfig.gistSync || !currentConfig.gistSync.enabled || !currentConfig.gistSync.token || !currentConfig.gistSync.gistId) {
    return { success: false, error: 'Gist設定が不完全です' };
  }
  
  const pulled = await gistSync.pullFromGist(currentConfig.gistSync.token, currentConfig.gistSync.gistId);
  if (pulled) {
    currentConfig.rules = pulled.rules || [];
    currentConfig.allowedSongs = pulled.allowedSongs || [];
    let migrated = false;
    currentConfig.rules.forEach(r => {
      if (r.year === 1900 && r.yearOperator === 'older_than') {
        r.year = 0; r.yearOperator = 'newer_than'; migrated = true;
      }
    });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
    if (migrated) {
      gistSync.pushToGist(currentConfig.gistSync.token, currentConfig.gistSync.gistId, currentConfig).catch(e=>console.error(e));
    }
    skipper.setConfig(currentConfig);
    if (mainWindow) mainWindow.webContents.send('config-updated', currentConfig);
    return { success: true };
  } else {
    return { success: false, error: 'Gistからの取得に失敗しました。TokenやIDを確認してください。' };
  }
});

// 自動同期（ポーリング）の設定：1分ごとに実行
setInterval(async () => {
  if (fs.existsSync(CONFIG_PATH)) {
    const currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (currentConfig.gistSync && currentConfig.gistSync.enabled && currentConfig.gistSync.token && currentConfig.gistSync.gistId) {
      try {
        const pulled = await gistSync.pullFromGist(currentConfig.gistSync.token, currentConfig.gistSync.gistId);
        if (pulled) {
          // 変更があるか確認（簡易的な文字列表比較）
          const oldStr = JSON.stringify(currentConfig.rules) + JSON.stringify(currentConfig.allowedSongs);
          const newStr = JSON.stringify(pulled.rules) + JSON.stringify(pulled.allowedSongs);
          if (oldStr !== newStr) {
            currentConfig.rules = pulled.rules || [];
            currentConfig.allowedSongs = pulled.allowedSongs || [];
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
            skipper.setConfig(currentConfig);
            if (mainWindow) mainWindow.webContents.send('config-updated', currentConfig);
            if (mainWindow) mainWindow.webContents.send('skipper-log', '[同期] Gistから新しいルールを自動取得しました');
          }
        }
      } catch (e) {
        console.error('Auto sync error:', e);
      }
    }
  }
}, 60000); // 60秒

ipcMain.handle('get-now-playing', () => {
  return skipper.getNowPlaying();
});

ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('set-autostart', (event, enabled) => {
  const isPackaged = app.isPackaged;
  const options = {
    openAtLogin: enabled,
    path: app.getPath('exe')
  };
  
  if (!isPackaged) {
    options.args = [path.resolve(__dirname)];
  }
  
  app.setLoginItemSettings(options);
  return true;
});

async function startSkipperSequence() {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version');
    if (response.ok) {
      console.log('Already running with debugger port');
      runSkipperStart();
      return true;
    }
  } catch (err) {
  }

  try {
    const baseDir = 'C:\\Users\\Mudai\\AppData\\Local\\youtube_music_desktop_app';
    if (fs.existsSync(baseDir)) {
      const dirs = fs.readdirSync(baseDir).filter(f => f.startsWith('app-'));
      
      const getVersion = (dirName) => {
        const parts = dirName.replace('app-', '').split('.').map(n => parseInt(n, 10));
        return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
      };
      
      dirs.sort((a, b) => getVersion(a) - getVersion(b));

      let exePath = null;
      for (let i = dirs.length - 1; i >= 0; i--) {
        const testPath = path.join(baseDir, dirs[i], 'youtube-music-desktop-app.exe');
        if (fs.existsSync(testPath)) {
          exePath = testPath;
          break;
        }
      }
      
      const launchPath = exePath || path.join(baseDir, 'youtube-music-desktop-app.exe');
      
      child_process.exec(`taskkill /F /IM youtube-music-desktop-app.exe`, () => {
        setTimeout(() => {
          const child = child_process.spawn(launchPath, ['--remote-debugging-port=9222'], {
            detached: true,
            stdio: 'ignore'
          });
          child.unref();
          
          setTimeout(() => {
            runSkipperStart();
          }, 3000);
        }, 1000);
      });
      return true;
    }
  } catch (e) {
    console.error('アプリ起動エラー', e);
  }

  runSkipperStart();
  return true;
}

ipcMain.handle('start-skipper', async () => {
  return await startSkipperSequence();
});

let isSkipperRunning = false;

async function runSkipperStart() {
  if (isSkipperRunning) return;
  const currentConfig = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : { rules: [] };
  skipper.start(currentConfig, (logMsg) => {
    if (mainWindow) {
      mainWindow.webContents.send('skipper-log', logMsg);
    }
  });
  isSkipperRunning = true;
  if (mainWindow) {
    mainWindow.webContents.send('skipper-status', true);
  }
}

function runSkipperStop() {
  if (!isSkipperRunning) return;
  skipper.stop();
  isSkipperRunning = false;
  if (mainWindow) {
    mainWindow.webContents.send('skipper-status', false);
  }
}

ipcMain.handle('stop-skipper', () => {
  runSkipperStop();
  return true;
});

function startApiServer() {
  if (apiServer) return;

  apiServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/streamdeck/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, isRunning: isSkipperRunning }));
      return;
    }

    if (req.method === 'POST') {
      if (req.url === '/api/streamdeck/toggle') {
        if (isSkipperRunning) {
          runSkipperStop();
          if (mainWindow) mainWindow.webContents.send('skipper-log', '[Stream Deck] 監視を停止しました');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, isRunning: false }));
        } else {
          startSkipperSequence();
          if (mainWindow) mainWindow.webContents.send('skipper-log', '[Stream Deck] 監視を開始しました');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, isRunning: true }));
        }
        return;
      }

      if (req.url === '/api/streamdeck/skip-artist') {
        const np = skipper.getNowPlaying();
        if (np && np.artist) {
          const artist = np.artist;
          const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : { rules: [] };
          
          const exists = config.rules.some(r => r.artist === artist && r.matchType === 'includes' && r.year === 0 && r.yearOperator === 'newer_than');
          if (!exists) {
            config.rules.push({
              artist: artist,
              matchType: 'includes',
              year: 0,
              yearOperator: 'newer_than',
              allowedSongs: []
            });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            skipper.setConfig(config);
            if (config.gistSync && config.gistSync.enabled && config.gistSync.token && config.gistSync.gistId) {
              gistSync.pushToGist(config.gistSync.token, config.gistSync.gistId, config);
            }
            lastAddedArtistViaStreamDeck = artist;
            if (mainWindow) {
              mainWindow.webContents.send('skipper-log', `[Stream Deck] 「${artist}」をスキップリストに追加しました (全曲)`);
              mainWindow.webContents.send('config-updated', config);
            }
          } else {
            if (mainWindow) {
              mainWindow.webContents.send('skipper-log', `[Stream Deck] 「${artist}」は既に登録されています`);
            }
          }

          // 低評価＋スキップ実行
          skipper.skipCurrentTrackExternally().then(result => {
            if (result.success) {
              if (mainWindow) mainWindow.webContents.send('skipper-log', `[Stream Deck] 曲を低評価＆スキップしました`);
            } else {
              if (mainWindow) mainWindow.webContents.send('skipper-log', `[Stream Deck] スキップエラー: ${result.error}`);
            }
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, artist: artist }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No artist playing' }));
        }
        return;
      }

      if (req.url === '/api/streamdeck/undo') {
        if (lastAddedArtistViaStreamDeck) {
          const artist = lastAddedArtistViaStreamDeck;
          const config = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) : { rules: [] };
          
          const initialLength = config.rules.length;
          config.rules = config.rules.filter(r => !(r.artist === artist && r.matchType === 'includes' && r.year === 0 && r.yearOperator === 'newer_than'));
          
          if (config.rules.length < initialLength) {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            skipper.setConfig(config);
            if (config.gistSync && config.gistSync.enabled && config.gistSync.token && config.gistSync.gistId) {
              gistSync.pushToGist(config.gistSync.token, config.gistSync.gistId, config);
            }
            lastAddedArtistViaStreamDeck = null;
            if (mainWindow) {
              mainWindow.webContents.send('skipper-log', `[Stream Deck] 「${artist}」のスキップルールを削除（Undo）しました`);
              mainWindow.webContents.send('config-updated', config);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, removed: artist }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Rule not found' }));
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Nothing to undo' }));
        }
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  apiServer.on('error', (err) => {
    console.error('API Server error:', err);
    if (mainWindow) {
      mainWindow.webContents.send('skipper-log', `[APIサーバー] エラー: ${err.message}`);
    }
    apiServer = null;
  });

  apiServer.listen(8080, '0.0.0.0', () => {
    console.log('API Server running on port 8080');
    if (mainWindow) {
      mainWindow.webContents.send('skipper-log', '[APIサーバー] ポート8080で待機中... (Stream Deck等からのリクエストを受信できます)');
    }
  });
}

function stopApiServer() {
  if (apiServer) {
    apiServer.close(() => {
      console.log('API Server stopped');
    });
    apiServer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('skipper-log', '[APIサーバー] 停止しました');
    }
  }
}

app.on('will-quit', () => {
  stopApiServer();
});
