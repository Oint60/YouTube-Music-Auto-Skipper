const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function dumpDOM() {
  try {
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const targets = await browser.targets();
    
    let dumped = false;
    for (const target of targets) {
      if (target.url().includes('music.youtube.com')) {
        const page = await target.page();
        if (page) {
          console.log(`Found YouTube Music target: ${target.url()}`);
          const html = await page.evaluate(() => document.body.innerHTML);
          fs.writeFileSync('dom-dump.txt', html);
          console.log('DOM dumped to dom-dump.txt. Please check this file.');
          dumped = true;
          break;
        }
      }
    }
    
    if (!dumped) {
      console.log('Could not find music.youtube.com target. Available targets:');
      targets.forEach(t => console.log(`- Type: ${t.type()}, URL: ${t.url()}`));
    }
    
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

dumpDOM();
