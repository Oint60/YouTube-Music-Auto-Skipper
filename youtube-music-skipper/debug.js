const puppeteer = require('puppeteer-core');
const http = require('http');

function getWsEndpoint() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/version', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data).webSocketDebuggerUrl));
    }).on('error', reject);
  });
}

async function debugTargets() {
  try {
    const wsEndpoint = await getWsEndpoint();
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    const targets = await browser.targets();
    
    console.log("=== TARGETS ===");
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      console.log(`[${i}] Type: ${t.type()}, URL: ${t.url()}`);
    }
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

debugTargets();
