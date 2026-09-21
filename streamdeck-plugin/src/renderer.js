/**
 * NosTune SVG Image Renderer for Stream Deck Keys (144x144)
 * Generates sharp, clean, high-contrast SVG key images.
 * Pure white bold sans-serif text with soft drop shadows.
 * No ugly black strokes or rectangular artifacts.
 */

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(str, maxLen = 14) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 1) + '…';
}

function estimateTextWidth(text, fontSize = 28) {
  if (!text) return 0;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128 || (code >= 0xff61 && code <= 0xff9f)) {
      w += fontSize * 0.55;
    } else {
      w += fontSize * 0.95;
    }
  }
  return w;
}

function calculateLineScroll(text, fontSize, elapsed, config) {
  const cfg = config || { disableScroll: false, pauseSeconds: 5, scrollSpeed: 80 };
  const textWidth = estimateTextWidth(text, fontSize);
  const maxStaticWidth = 118; // 枠内静止幅

  // 1. スクロール無効設定、または枠内に収まる短いテキストの場合（toe 等は美しく中央揃え）
  if (cfg.disableScroll || textWidth <= maxStaticWidth) {
    return {
      isScrollable: false,
      isCentered: true,
      text: truncate(text, 14),
      offset: 0
    };
  }

  // 2. 枠に収まらない長いテキストの場合（左揃えからスタートして指定秒静止後スクロール）
  const gap = 50;
  const loopSpan = textWidth + gap;
  const pauseMs = (cfg.pauseSeconds !== undefined ? Number(cfg.pauseSeconds) : 5) * 1000;
  const speed = Number(cfg.scrollSpeed) || 80;
  const scrollDurationMs = loopSpan / (speed / 1000);
  const cycleMs = pauseMs + scrollDurationMs;
  const timeInCycle = elapsed % cycleMs;

  let currentOffset = 0;
  if (timeInCycle >= pauseMs) {
    currentOffset = (timeInCycle - pauseMs) * (speed / 1000);
  }

  return {
    isScrollable: true,
    isCentered: false,
    text: text,
    loopSpan: loopSpan,
    offset: Math.round(currentOffset),
    padLeft: 12
  };
}

function renderScrollableLine(text, y, fontSize, lineId, elapsed, config, filterId = 'textShadow') {
  if (!text) return '';
  const scroll = calculateLineScroll(text, fontSize, elapsed, config);

  if (!scroll.isScrollable) {
    const anchor = scroll.isCentered ? 'middle' : 'start';
    const x = scroll.isCentered ? 72 : 12;
    const escaped = escapeXml(scroll.text);
    return `
      <text x="${x}" y="${y}" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" text-anchor="${anchor}" dominant-baseline="central" filter="url(#${filterId})">
        ${escaped}
      </text>
    `;
  }

  const escaped = escapeXml(scroll.text);
  const x1 = Math.round(scroll.padLeft - scroll.offset);
  const x2 = Math.round(x1 + scroll.loopSpan);

  return `
    <text x="${x1}" y="${y}" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" text-anchor="start" dominant-baseline="central" filter="url(#${filterId})">
      ${escaped}
    </text>
    <text x="${x2}" y="${y}" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff" text-anchor="start" dominant-baseline="central" filter="url(#${filterId})">
      ${escaped}
    </text>
  `;
}

/**
 * 1. Now Playing Action (再生中: アートワーク全面 + クリーンな純白3行太字テキスト)
 * 短い文字は中央揃え、長い文字は左揃えからスムーズにティッカースクロール
 */
function renderNowPlaying(track, elapsed = 0, config = null) {
  const title = (track && track.title && track.title !== '未再生') ? track.title.trim() : '';
  const artist = (track && track.artist && track.artist !== 'NosTune') ? track.artist.trim() : '';
  const year = track && track.year ? `${track.year}年` : '';
  const artwork = track && track.artworkUrl ? track.artworkUrl : '';

  if (!title) {
    return `
      <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgIdle" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1e1b4b"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <filter id="badgeShadowIdle" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.85"/>
          </filter>
        </defs>
        <rect width="144" height="144" fill="url(#bgIdle)" rx="14"/>
        <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>
        <text x="72" y="50" font-family="Segoe UI Emoji, sans-serif" font-size="44" fill="#ffffff" text-anchor="middle" dominant-baseline="central">🎵</text>
        <text x="72" y="108" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="central" filter="url(#badgeShadowIdle)">未再生</text>
      </svg>
    `.trim();
  }

  return `
    <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" style="overflow: hidden;">
      <defs>
        <linearGradient id="fallbackGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.9"/>
        </filter>
      </defs>

      ${artwork ? `
        <image href="${escapeXml(artwork)}" width="144" height="144" preserveAspectRatio="xMidYMid slice"/>
        <rect width="144" height="144" fill="#000000" opacity="0.38" rx="14"/>
      ` : `
        <rect width="144" height="144" fill="url(#fallbackGrad)" rx="14"/>
      `}

      <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>

      ${year ? `
        ${renderScrollableLine(title, 35, 28, 'np_t', elapsed, config, 'textShadow')}
        ${renderScrollableLine(artist, 72, 28, 'np_a', elapsed, config, 'textShadow')}
        ${renderScrollableLine(year, 109, 28, 'np_y', elapsed, config, 'textShadow')}
      ` : `
        ${renderScrollableLine(title, 52, 28, 'np_t', elapsed, config, 'textShadow')}
        ${renderScrollableLine(artist, 94, 28, 'np_a', elapsed, config, 'textShadow')}
      `}
    </svg>
  `.trim();
}

/**
 * 2. Next Track Action (次の曲: 3行テキスト bold 28px #ffffff)
 */
function renderNextTrack(track, elapsed = 0, config = null) {
  const title = (track && track.title) ? track.title.trim() : '';
  const artist = (track && track.artist) ? track.artist.trim() : '';
  const year = track && track.year ? `${track.year}年` : '';

  if (!title) {
    return `
      <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgNextFb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#1e3a8a"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <filter id="badgeShadowNextFb" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.85"/>
          </filter>
        </defs>
        <rect width="144" height="144" fill="url(#bgNextFb)" rx="14"/>
        <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>
        <text x="72" y="50" font-family="Segoe UI Emoji, sans-serif" font-size="44" fill="#ffffff" text-anchor="middle" dominant-baseline="central">⏭</text>
        <text x="72" y="108" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="central" filter="url(#badgeShadowNextFb)">次の曲</text>
      </svg>
    `.trim();
  }

  return `
    <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" style="overflow: hidden;">
      <defs>
        <linearGradient id="bgNext" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1e3a8a"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <filter id="textShadowNext" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.9"/>
        </filter>
      </defs>
      <rect width="144" height="144" fill="url(#bgNext)" rx="14"/>
      <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>

      ${year ? `
        ${renderScrollableLine(title, 35, 28, 'nx_t', elapsed, config, 'textShadowNext')}
        ${renderScrollableLine(artist, 72, 28, 'nx_a', elapsed, config, 'textShadowNext')}
        ${renderScrollableLine(year, 109, 28, 'nx_y', elapsed, config, 'textShadowNext')}
      ` : `
        ${renderScrollableLine(title, 52, 28, 'nx_t', elapsed, config, 'textShadowNext')}
        ${renderScrollableLine(artist, 94, 28, 'nx_a', elapsed, config, 'textShadowNext')}
      `}
    </svg>
  `.trim();
}

/**
 * 3. Previous Track Action (前の曲: 3行テキスト bold 28px #ffffff)
 */
function renderPreviousTrack(track, elapsed = 0, config = null) {
  const title = (track && track.title) ? track.title.trim() : '';
  const artist = (track && track.artist) ? track.artist.trim() : '';
  const year = track && track.year ? `${track.year}年` : '';

  if (!title) {
    return `
      <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgPrevFb" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
          <filter id="badgeShadowPrevFb" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.85"/>
          </filter>
        </defs>
        <rect width="144" height="144" fill="url(#bgPrevFb)" rx="14"/>
        <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>
        <text x="72" y="50" font-family="Segoe UI Emoji, sans-serif" font-size="44" fill="#ffffff" text-anchor="middle" dominant-baseline="central">⏮</text>
        <text x="72" y="108" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="central" filter="url(#badgeShadowPrevFb)">前の曲</text>
      </svg>
    `.trim();
  }

  return `
    <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg" style="overflow: hidden;">
      <defs>
        <linearGradient id="bgPrev" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#334155"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <filter id="textShadowPrev" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.9"/>
        </filter>
      </defs>
      <rect width="144" height="144" fill="url(#bgPrev)" rx="14"/>
      <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>

      ${year ? `
        ${renderScrollableLine(title, 35, 28, 'pv_t', elapsed, config, 'textShadowPrev')}
        ${renderScrollableLine(artist, 72, 28, 'pv_a', elapsed, config, 'textShadowPrev')}
        ${renderScrollableLine(year, 109, 28, 'pv_y', elapsed, config, 'textShadowPrev')}
      ` : `
        ${renderScrollableLine(title, 52, 28, 'pv_t', elapsed, config, 'textShadowPrev')}
        ${renderScrollableLine(artist, 94, 28, 'pv_a', elapsed, config, 'textShadowPrev')}
      `}
    </svg>
  `.trim();
}

/**
 * 4. General Action Badge (汎用アクションボタン)
 * ヘッダーピル撤廃、大アイコン、font28太字白文字
 * subText がある場合は2行、ない場合は単一行でバランス配置
 */
function renderActionBadge(icon, mainText, subText, gradStart, gradEnd, iconColor = '#ffffff') {
  const gradId = `bgBadge_${String(gradStart).replace(/[^a-zA-Z0-9]/g, '')}`;
  const mainEscaped = escapeXml(mainText);
  const subEscaped = escapeXml(subText);
  const iconEscaped = escapeXml(icon);

  const isLong = String(mainText).length >= 5;
  const lengthAttr = isLong ? 'textLength="130" lengthAdjust="spacingAndGlyphs"' : '';

  const iconY = subEscaped ? 44 : 50;
  const iconSize = subEscaped ? 40 : 44;

  return `
    <svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${gradStart}"/>
          <stop offset="100%" stop-color="${gradEnd}"/>
        </linearGradient>
        <filter id="badgeShadow_${gradId}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000000" flood-opacity="0.85"/>
        </filter>
      </defs>
      <rect width="144" height="144" fill="url(#${gradId})" rx="14"/>
      <rect x="1" y="1" width="142" height="142" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" rx="13"/>

      <!-- アイコン -->
      <text x="72" y="${iconY}" font-family="Segoe UI Emoji, sans-serif" font-size="${iconSize}" fill="${iconColor}" text-anchor="middle" dominant-baseline="central">${iconEscaped}</text>

      ${subEscaped ? `
        <!-- メイン行 (28px bold #ffffff) -->
        <text x="72" y="88" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="central" ${lengthAttr} filter="url(#badgeShadow_${gradId})">
          ${mainEscaped}
        </text>
        <!-- サブ行 (14px bold #ffffff) -->
        <text x="72" y="120" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="14" fill="#ffffff" text-anchor="middle" dominant-baseline="central" filter="url(#badgeShadow_${gradId})">
          ${subEscaped}
        </text>
      ` : `
        <!-- 単一行 (28px bold #ffffff) -->
        <text x="72" y="108" font-family="Segoe UI, Hiragino Sans, Meiryo, sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="central" ${lengthAttr} filter="url(#badgeShadow_${gradId})">
          ${mainEscaped}
        </text>
      `}
    </svg>
  `.trim();
}

module.exports = {
  renderNowPlaying,
  renderNextTrack,
  renderPreviousTrack,
  renderActionBadge
};
