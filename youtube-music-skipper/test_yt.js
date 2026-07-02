const axios = require('axios');

async function testSearch(query) {
  try {
    const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
    const html = res.data;
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    console.log("Search Match:", match ? match[1] : "Not found");
    return match ? match[1] : null;
  } catch (e) {
    console.error("Search Error:", e.message);
  }
}

async function testVideo(videoId) {
  try {
    const url = "https://www.youtube.com/watch?v=" + videoId;
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } });
    const html = res.data;
    let match = html.match(/"publishDate":"(\d{4})/);
    if (!match) match = html.match(/uploadDate":"(\d{4})/);
    console.log("Year Match:", match ? match[1] : "Not found");
  } catch(e) {
    console.error("Video Error:", e.message);
  }
}

async function run() {
  const vid = await testSearch("Taylor Swift Anti-Hero topic");
  if (vid) {
    await testVideo(vid);
  }
}
run();
