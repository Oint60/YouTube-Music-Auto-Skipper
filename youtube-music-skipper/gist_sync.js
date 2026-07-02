const axios = require('axios');

const GIST_FILENAME = 'youtube-music-skipper-config.json';

/**
 * Gistから設定をダウンロードする
 * @param {string} token GitHub Personal Access Token
 * @param {string} gistId Gist ID
 * @returns {Promise<Object|null>} パースされた設定オブジェクト。失敗時はnull
 */
async function pullFromGist(token, gistId) {
  try {
    const response = await axios.get(`https://api.github.com/gists/${gistId}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache'
      }
    });

    const file = response.data.files[GIST_FILENAME];
    if (!file || !file.content) {
      throw new Error(`Gist内に ${GIST_FILENAME} が見つかりません。`);
    }

    const configData = JSON.parse(file.content);
    return configData;
  } catch (error) {
    console.error('[Gist Sync] Pull failed:', error.message);
    return null;
  }
}

/**
 * Gistへ設定をアップロードする
 * @param {string} token GitHub Personal Access Token
 * @param {string} gistId Gist ID
 * @param {Object} data アップロードする設定オブジェクト (rules, allowedSongs 等)
 * @returns {Promise<boolean>} 成功したかどうか
 */
async function pushToGist(token, gistId, data) {
  try {
    // 必要なプロパティだけを抽出してアップロード (GistのTokenなどは含めない)
    const exportData = {
      rules: data.rules || [],
      allowedSongs: data.allowedSongs || []
    };

    const content = JSON.stringify(exportData, null, 2);

    await axios.patch(`https://api.github.com/gists/${gistId}`, {
      files: {
        [GIST_FILENAME]: {
          content: content
        }
      }
    }, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    return true;
  } catch (error) {
    console.error('[Gist Sync] Push failed:', error.message);
    return false;
  }
}

module.exports = { pullFromGist, pushToGist, GIST_FILENAME };
