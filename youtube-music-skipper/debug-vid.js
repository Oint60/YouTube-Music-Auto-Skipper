const puppeteer = require('puppeteer-core');

async function debugVideoId() {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const targets = await browser.targets();
    let ytTarget = targets.find(t => t.url().includes('music.youtube.com'));
    if (!ytTarget) process.exit(1);
    const page = await ytTarget.page();
    
    const data = await page.evaluate(() => {
      const bar = document.querySelector('ytmusic-player-bar');
      if (!bar) return 'no player bar';
      if (bar.playerApi_ && bar.playerApi_.getVideoData) {
        return bar.playerApi_.getVideoData().video_id;
      }
      // Check moviePlayer
      const player = document.getElementById('movie_player');
      if (player && player.getVideoData) {
        return player.getVideoData().video_id;
      }
      return 'no videoId found in APIs';
    });
    console.log('Video ID from JS:', data);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
debugVideoId();
