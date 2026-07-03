const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let config = {
  allowedSongs: [],
  dislikeBeforeSkip: true,
  rules: []
};

let isRunning = false;
let browserInstance = null;
let activePage = null; // 外部操作用に保持
let wakeUp = null; // メインループ即時起動用
let nowPlaying = { artist: '', title: '' }; // 現在再生中の楽曲情報
const yearCache = new Map();
const skippedIds = new Set(); // 二重スキップ防止用

// カスタム待機関数（外部からの通知で即座に目覚める）
function sleep(ms) {
  return new Promise(resolve => {
    wakeUp = resolve;
    setTimeout(() => {
      if (wakeUp === resolve) wakeUp = null;
      resolve();
    }, ms);
  });
}

async function skipCurrentTrackExternally() {
  if (!activePage) {
    return { success: false, error: 'YouTube Musicが接続されていません。' };
  }
  try {
    const result = await activePage.evaluate(async () => {
      const pb = document.querySelector('ytmusic-player-bar');
      const moviePlayer = document.getElementById('movie_player');
      const api = pb?.playerApi_ || moviePlayer;
      if (!api) return { success: false, error: 'API不可' };

      // 1. 低評価
      const dislikeBtn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
      const isAlreadyDisliked = dislikeBtn?.getAttribute('aria-pressed') === 'true';

      if (!isAlreadyDisliked) {
        let retry = 0;
        while (retry < 8) {
          const btn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
          if (btn && btn.offsetParent !== null) break;
          await new Promise(r => setTimeout(r, 200));
          retry++;
        }
        const btn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
        if (btn) {
          const currentVideoId = api.getVideoData?.()?.video_id;
          btn.click();
          if (api.setLikeStatus) api.setLikeStatus('DISLIKE');
          // 自動スキップされるケースとされないケースがあるため、1.5秒待って曲が変わっていなければ手動スキップを送る
          await new Promise(r => setTimeout(r, 1500));
          const newVideoId = pb?.playerApi_?.getVideoData?.()?.video_id || document.getElementById('movie_player')?.getVideoData?.()?.video_id;
          
          if (currentVideoId && currentVideoId === newVideoId) {
            if (api.nextVideo) api.nextVideo();
            else {
              const nextBtn = pb?.querySelector('.next-button') || document.querySelector('.next-button');
              if (nextBtn) nextBtn.click();
            }
            return { success: true, method: 'dislike_and_manual_skip' };
          }
          return { success: true, method: 'dislike_auto_skipped' };
        }
      }

      // すでに低評価済み、またはボタンが押せなかった場合は、手動で次の曲に送る
      if (api.nextVideo) api.nextVideo();
      else {
        const nextBtn = pb?.querySelector('.next-button') || document.querySelector('.next-button');
        if (nextBtn) nextBtn.click();
      }
      return { success: true, method: 'manual_skip' };
    });
    return result;
  } catch (e) {
    if (e.message.includes('Promise was collected') || e.message.includes('Execution context was destroyed') || e.message.includes('Target closed')) {
      // スキップや低評価によって画面(DOM)が更新されコンテキストが破棄された場合は、実質的に成功とみなす
      return { success: true, method: 'forced_success_by_context_destroy' };
    }
    return { success: false, error: e.message };
  }
}

async function fetchReleaseYear(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const html = response.data;
    
    // 1. Description（説明文）からリリース年を探す
    const descMatch = html.match(/\"shortDescription\"\:\"(.*?)\"/);
    if (descMatch) {
      const desc = descMatch[1].replace(/\\n/g, ' ').replace(/\\/g, '');
      const deepMatch = desc.match(/(?:Released on|℗|©|\(P\)|\(C\))(?:\\n|\s|:)*(\d{4})/i);
      if (deepMatch) return parseInt(deepMatch[1], 10);
    }
    
    // 2. ページ全体のテキストから直接探す
    const pageDeepMatch = html.match(/(?:Released on|℗|©|\(P\)|\(C\))(?:\\n|\s|:)*(\d{4})/i);
    if (pageDeepMatch) return parseInt(pageDeepMatch[1], 10);
    
    // 3. 最後の手段として publishDate / uploadDate
    const match = html.match(/\"publishDate\"\:\"(\d{4})/) || html.match(/uploadDate\"\:\"(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  } catch (e) {
    return null;
  }
}

function getCachedYear(videoId) { return yearCache.get(videoId); }
function setCachedYear(videoId, year) { yearCache.set(videoId, year); }

function shouldSkip(artist, releaseYear, title) {
  if (!title || title.includes('ベストセラー曲')) return false;
  const globalAllowed = config.allowedSongs || [];
  const rules = config.rules || [];
  if (globalAllowed.some(song => (song.title && title.includes(song.title)) && (!song.artist || (artist && artist.includes(song.artist))))) return false;
  for (const rule of rules) {
    if (rule.artist && artist && artist.includes(rule.artist)) {
      const ruleAllowed = rule.allowedSongs || [];
      if (ruleAllowed.some(songTitle => title.includes(songTitle))) return false;
      
      // 全曲スキップルール（year: 0, newer_than）の場合はリリース年に関わらずスキップ
      if (rule.year === 0 && (rule.yearOperator === 'newer_than' || !rule.yearOperator)) {
        return true;
      }
      
      if (rule.year !== undefined && releaseYear !== null && releaseYear !== undefined) {
        const operator = rule.yearOperator || 'newer_than';
        if (operator === 'older_than') {
          if (releaseYear <= rule.year) return true;
        } else { // newer_than
          if (releaseYear >= rule.year) return true;
        }
      }
    }
  }
  return false;
}

async function start(initialConfig, onLog) {
  if (isRunning) return;
  if (initialConfig) config = initialConfig;
  isRunning = true;
  skippedIds.clear();

  try {
    onLog('YouTube Music を探索中...');
    let debuggerUrl = null;
    try {
      const resp = await axios.get('http://127.0.0.1:9222/json/version');
      debuggerUrl = resp.data.webSocketDebuggerUrl;
    } catch (e) {
      throw new Error('YouTube Music がデバッグポート(9222)で起動していません。');
    }

    onLog('ブラウザに接続中...');
    browserInstance = await puppeteer.connect({ browserWSEndpoint: debuggerUrl, defaultViewport: null });
    const pages = await browserInstance.pages();
    activePage = pages.find(p => p.url().includes('music.youtube.com')) || pages[0];

    activePage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Skipper]')) onLog(text.replace('[Skipper] ', ''));
    });

    onLog('監視プログラム起動完了');

    let lastVideoId = null;
    let isProcessing = false;
    const POLL_INTERVAL_MS = 1000;

    while (isRunning) {
      try {
        // メタデータの取得
        const current = await activePage.evaluate(() => {
          const pb = document.querySelector('ytmusic-player-bar');
          const api = pb?.playerApi_ || document.getElementById('movie_player');
          const data = api?.getVideoData?.() || {};
          const videoId = data.video_id;
          if (!videoId || !data.title || data.title.includes('YouTube Music')) return null;
          return { title: data.title, artist: data.author, videoId };
        });

        if (!current || current.title.includes('ベストセラー曲')) {
          await sleep(500);
          continue;
        }

        const { title, artist, videoId } = current;
        nowPlaying = { artist: artist || '', title: title || '' };
        if (videoId === lastVideoId) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        if (isProcessing && videoId !== lastVideoId) isProcessing = false;
        
        // 1. まず名前だけで「全曲スキップ」に該当するかチェック（0秒で判定）
        let skipDecision = shouldSkip(artist, null, title);
        let year = null;
        let source = '画面';

        // 2. スキップ対象でない場合は、DOMの年情報が同期されるまで最大3秒待つ
        if (!skipDecision) {
          for (let i = 0; i < 6; i++) {
            const domInfo = await activePage.evaluate((vid) => {
              const moviePlayer = document.getElementById('movie_player');
              const currentVid = moviePlayer?.getVideoData?.()?.video_id;
              
              if (currentVid === vid) {
                let bestYear = null;
                
                // PlayerResponseのDescriptionから正確なリリース年を抽出
                const response = moviePlayer?.getPlayerResponse?.();
                if (response) {
                  const desc = response.microformat?.microformatDataRenderer?.description || 
                               response.videoDetails?.shortDescription || '';
                  const deepMatch = desc.match(/(?:Released on|℗|©|\(P\)|\(C\))(?:\\n|\s|:)*(\d{4})/i);
                  if (deepMatch) {
                    bestYear = parseInt(deepMatch[1], 10);
                  }
                }
                
                if (bestYear) return bestYear;
                return -1; // 同期したが年が見つからない
              }
              return null; // まだ同期していない
            }, videoId);

            if (domInfo !== null) {
              if (domInfo !== -1) year = domInfo;
              break;
            }
            await sleep(500); // 同期するまで待つ
          }
        }

        // 3. 3秒待っても画面から年が取得できなかった場合、キャッシュまたは検索にフォールバック
        if (!skipDecision && !year) {
          year = getCachedYear(videoId);
          source = 'キャッシュ';
          if (year === undefined) {
            year = await fetchReleaseYear(videoId);
            source = '検索';
            if (year) setCachedYear(videoId, year);
          }
          // 年が取得できたので再度判定
          if (year) skipDecision = shouldSkip(artist, year, title);
        }

        lastVideoId = videoId;

        if (skipDecision) {
          isProcessing = true;
          onLog(`[判定: スキップ] ${artist} - ${title} (${year || '不明'}:${source})`);
          skippedIds.add(videoId);
          if (skippedIds.size > 100) skippedIds.delete(skippedIds.values().next().value);

          const result = await Promise.race([
            activePage.evaluate(async (targetId) => {
              const pb = document.querySelector('ytmusic-player-bar');
              const moviePlayer = document.getElementById('movie_player');
              const api = pb?.playerApi_ || moviePlayer;
              if (!api) return { success: false, error: 'API不可' };

              // 実行直前の最終同期チェック
              if (api.getVideoData?.()?.video_id !== targetId) return { success: false, error: '同期ズレ1' };

              // 1. 低評価
              const dislikeBtn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
              const isAlreadyDisliked = dislikeBtn?.getAttribute('aria-pressed') === 'true';

              if (!isAlreadyDisliked) {
                // 未評価なら準備を待ってクリック
                let retry = 0;
                while (retry < 8) {
                  const btn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
                  if (btn && btn.offsetParent !== null) break;
                  await new Promise(r => setTimeout(r, 200));
                  retry++;
                }
                const btn = pb?.querySelector('#button-shape-dislike button') || document.querySelector('#button-shape-dislike button');
                if (btn) {
                  btn.click();
                  if (api.setLikeStatus) api.setLikeStatus('DISLIKE');
                  // 低評価ボタンをクリックした場合は、自動的に次の曲へ送られるため、手動スキップは送らず終了する
                  return { success: true, method: 'dislike_click' };
                }
              }

              if (api.getVideoData?.()?.video_id !== targetId) return { success: false, error: '同期ズレ2' };
              
              // すでに低評価済み、またはボタンが押せなかった場合は、手動で次の曲に送る
              if (api.nextVideo) api.nextVideo();
              else {
                const nextBtn = pb?.querySelector('.next-button') || document.querySelector('.next-button');
                if (nextBtn) nextBtn.click();
              }
              return { success: true, method: 'manual_skip' };
            }, videoId),
            new Promise(r => setTimeout(() => r({ success: false, error: 'タイムアウト' }), 6000))
          ]);

          if (result.success) {
            let timeout = 0;
            while (timeout < 10000) {
              const currentId = await activePage.evaluate(() => document.querySelector('ytmusic-player-bar')?.playerApi_?.getVideoData?.()?.video_id);
              if (currentId && currentId !== videoId) break;
              await sleep(500);
              timeout += 500;
            }
            await sleep(1500);
          }
          isProcessing = false;
        } else {
          onLog(`[判定: 保持] ${artist} - ${title} (${year || '不明'}:${source})`);
        }
      } catch (e) {
        isProcessing = false;
        if (!e.message.includes('Promise was collected')) onLog(`エラー: ${e.message}`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } catch (e) {
    onLog(`致命的エラー: ${e.message}`);
  } finally {
    isRunning = false;
    activePage = null;
    if (browserInstance) browserInstance.disconnect();
    onLog('監視停止');
  }
}

function stop() { isRunning = false; }
function setConfig(newConfig) { config = newConfig; }
function getNowPlaying() { return { ...nowPlaying }; }

module.exports = { start, stop, setConfig, getNowPlaying, skipCurrentTrackExternally };
