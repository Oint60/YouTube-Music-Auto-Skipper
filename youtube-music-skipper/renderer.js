const { ipcRenderer } = require('electron');

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const artistInput = document.getElementById('artistInput');
const yearInput = document.getElementById('yearInput');
const operatorInput = document.getElementById('operatorInput');
const autostartCheckbox = document.getElementById('autostartCheckbox');
const addRuleBtn = document.getElementById('addRuleBtn');
const ruleList = document.getElementById('ruleList');
const logArea = document.getElementById('logArea');

// Gist UI
const gistEnabledCheckbox = document.getElementById('gistEnabledCheckbox');
const gistTokenInput = document.getElementById('gistTokenInput');
const gistIdInput = document.getElementById('gistIdInput');
const gistSyncBtn = document.getElementById('gistSyncBtn');

let config = { rules: [], gistSync: { enabled: false, token: '', gistId: '' } };

function appendLog(msg) {
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

// 初期データのロード
async function loadConfig() {
  config = await ipcRenderer.invoke('get-config');
  if (!config.gistSync) config.gistSync = { enabled: false, token: '', gistId: '' };
  
  gistEnabledCheckbox.checked = config.gistSync.enabled;
  gistTokenInput.value = config.gistSync.token;
  gistIdInput.value = config.gistSync.gistId;
  
  renderRules();
}

async function saveConfig() {
  await ipcRenderer.invoke('save-config', config);
  renderRules();
}

const allowedSongsInput = document.getElementById('allowedSongsInput');

const matchTypeInput = document.getElementById('matchTypeInput');

function renderRules() {
  ruleList.innerHTML = '';
  config.rules.forEach((rule, index) => {
    const li = document.createElement('li');
    li.className = 'rule-item';
    
    const matchTypeStr = rule.matchType === 'includes' ? 'を含む' : 'と完全一致';
    const text = document.createElement('span');
    const operatorStr = rule.yearOperator === 'older_than' ? '以前' : '以降';
    let ruleDesc = `「${rule.artist}」${matchTypeStr} ( ${rule.year}年 ${operatorStr}をスキップ )`;
    if (rule.allowedSongs && rule.allowedSongs.length > 0) {
      ruleDesc = `「${rule.artist}」${matchTypeStr} ( 許可: ${rule.allowedSongs.join(', ')} ) ※他は全スキップ`;
    }
    text.textContent = ruleDesc;
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.onclick = () => {
      config.rules.splice(index, 1);
      saveConfig();
    };
    
    li.appendChild(text);
    li.appendChild(delBtn);
    ruleList.appendChild(li);
  });
}

addRuleBtn.addEventListener('click', () => {
  const artist = artistInput.value.trim();
  const year = parseInt(yearInput.value, 10);
  const matchType = matchTypeInput.value;
  const allowedSongsRaw = allowedSongsInput.value.trim();
  
  if (!artist) {
    alert('アーティスト名を入力してください。');
    return;
  }
  
  let allowedSongs = [];
  if (allowedSongsRaw) {
    allowedSongs = allowedSongsRaw.split(',').map(s => s.trim()).filter(s => s !== '');
  }

  if (allowedSongs.length === 0 && isNaN(year)) {
    alert('「年以降」または「許可する曲名」のどちらかを入力してください。');
    return;
  }
  
  const yearOperator = operatorInput.value;
  config.rules.push({ 
    artist,
    matchType,
    year: isNaN(year) ? 0 : year, 
    yearOperator,
    allowedSongs 
  });
  saveConfig();
  
  artistInput.value = '';
  yearInput.value = '';
  allowedSongsInput.value = '';
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  appendLog('監視を開始しています...');
  await ipcRenderer.invoke('start-skipper');
});

stopBtn.addEventListener('click', async () => {
  startBtn.disabled = false;
  stopBtn.disabled = true;
  await ipcRenderer.invoke('stop-skipper');
  appendLog('監視を停止しました。');
});

ipcRenderer.on('skipper-log', (event, msg) => {
  appendLog(msg);
});

ipcRenderer.on('config-updated', (event, newConfig) => {
  config = newConfig;
  renderRules();
});

ipcRenderer.on('skipper-status', (event, isRunning) => {
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
});

// 再生中のアーティストを入力欄にセット
const nowPlayingBtn = document.getElementById('nowPlayingBtn');
nowPlayingBtn.addEventListener('click', async () => {
  const np = await ipcRenderer.invoke('get-now-playing');
  if (np && np.artist) {
    artistInput.value = np.artist;
    appendLog(`アーティスト欄にセット: ${np.artist}`);
  } else {
    appendLog('現在再生中の楽曲情報が取得できません。監視開始後にお試しください。');
  }
});

// Gist 設定の保存
function updateGistConfig() {
  if (!config.gistSync) config.gistSync = {};
  config.gistSync.enabled = gistEnabledCheckbox.checked;
  config.gistSync.token = gistTokenInput.value.trim();
  config.gistSync.gistId = gistIdInput.value.trim();
  saveConfig();
}
gistEnabledCheckbox.addEventListener('change', updateGistConfig);
gistTokenInput.addEventListener('change', updateGistConfig);
gistIdInput.addEventListener('change', updateGistConfig);

// Gist 手動同期
gistSyncBtn.addEventListener('click', async () => {
  updateGistConfig();
  if (!config.gistSync.enabled || !config.gistSync.token || !config.gistSync.gistId) {
    alert('Gistの同期を有効にし、TokenとIDを入力してください。');
    return;
  }
  gistSyncBtn.disabled = true;
  gistSyncBtn.textContent = '同期中...';
  appendLog('Gist と手動同期を開始しました...');
  
  const result = await ipcRenderer.invoke('manual-gist-sync');
  if (result.success) {
    appendLog('Gist 同期が完了しました！');
  } else {
    appendLog(`Gist 同期エラー: ${result.error}`);
  }
  
  gistSyncBtn.disabled = false;
  gistSyncBtn.textContent = '今すぐクラウドと同期する';
});

// 初期化
async function init() {
  await loadConfig();
  
  // 自動起動設定の初期化
  try {
    const autostart = await ipcRenderer.invoke('get-autostart');
    autostartCheckbox.checked = autostart;
    
    autostartCheckbox.addEventListener('change', async () => {
      await ipcRenderer.invoke('set-autostart', autostartCheckbox.checked);
      appendLog(`自動起動を ${autostartCheckbox.checked ? '有効' : '無効'} にしました。`);
    });
  } catch (e) {
    console.error('Failed to get autostart settings', e);
  }
}
init();
