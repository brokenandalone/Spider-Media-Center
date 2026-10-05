const crypto = require('node:crypto');

const IPTV_DEFAULT_PLAYLIST = 'https://iptv-org.github.io/iptv/index.m3u';
const RADIO_BROWSER_ROOTS = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info'
];

function assertHttpUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS sources are supported.');
  }
  return url;
}

async function fetchText(value, maxBytes = 12 * 1024 * 1024) {
  const url = assertHttpUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Spider-Media-Center/1.0 (+Broken-City-Network)',
        'Accept': '*/*'
      }
    });

    if (!response.ok) throw new Error(`Remote source returned HTTP ${response.status}.`);

    const reader = response.body?.getReader();
    if (!reader) return await response.text();

    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        controller.abort();
        throw new Error('Remote response is too large.');
      }
      chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

function parseM3u(text, baseUrl, maximum = 10000) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const attributes = {};
      const rx = /([\w-]+)="([^"]*)"/g;
      let match;
      while ((match = rx.exec(line))) attributes[match[1]] = match[2];

      const comma = line.lastIndexOf(',');
      pending = {
        title: comma >= 0 ? line.slice(comma + 1).trim() : 'Untitled stream',
        group: attributes['group-title'] || '',
        artwork: attributes['tvg-logo'] || '',
        channelId: attributes['tvg-id'] || '',
        language: attributes['tvg-language'] || '',
        country: attributes['tvg-country'] || ''
      };
      continue;
    }

    if (line.startsWith('#')) continue;

    try {
      const url = new URL(line, baseUrl).href;
      if (!/^https?:/i.test(url)) continue;
      const info = pending || {};
      entries.push({
        id: crypto.randomUUID(),
        title: info.title || new URL(url).hostname,
        url,
        group: info.group || '',
        artwork: info.artwork || '',
        channelId: info.channelId || '',
        language: info.language || '',
        country: info.country || '',
        source: 'iptv',
        extension: 'LIVE'
      });
      if (entries.length >= maximum) break;
    } catch { }

    pending = null;
  }

  return entries;
}

async function loadIptvPlaylist(value = IPTV_DEFAULT_PLAYLIST) {
  const playlistUrl = String(value || IPTV_DEFAULT_PLAYLIST).trim() || IPTV_DEFAULT_PLAYLIST;
  const text = await fetchText(playlistUrl);
  const entries = parseM3u(text, playlistUrl);
  return { url: playlistUrl, count: entries.length, entries };
}

async function searchRadioStations(options = {}) {
  const countrycode = String(options.countrycode || '').trim().toUpperCase().slice(0, 2);
  const language = String(options.language || '').trim().slice(0, 40);
  const name = String(options.name || '').trim().slice(0, 80);
  const tags = (Array.isArray(options.tags) && options.tags.length
    ? options.tags
    : ['talk', 'news', 'speech'])
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 4);

  const limit = Math.max(10, Math.min(100, Number(options.limit) || 50));
  let lastError;

  for (const root of RADIO_BROWSER_ROOTS) {
    try {
      const found = new Map();

      for (const tag of tags) {
        const url = new URL('/json/stations/search', root);
        if (countrycode) url.searchParams.set('countrycode', countrycode);
        if (language) url.searchParams.set('language', language);
        if (name) url.searchParams.set('name', name);
        if (tag) url.searchParams.set('tag', tag);
        url.searchParams.set('hidebroken', 'true');
        url.searchParams.set('order', 'votes');
        url.searchParams.set('reverse', 'true');
        url.searchParams.set('limit', String(limit));

        const rows = JSON.parse(await fetchText(url.href, 5 * 1024 * 1024));

        for (const row of Array.isArray(rows) ? rows : []) {
          const streamUrl = String(row.url_resolved || row.url || '').trim();
          if (!/^https?:/i.test(streamUrl)) continue;
          const key = row.stationuuid || streamUrl;
          if (found.has(key)) continue;

          found.set(key, {
            id: row.stationuuid || crypto.randomUUID(),
            name: String(row.name || 'Untitled station').trim(),
            url: streamUrl,
            homepage: row.homepage || '',
            artwork: row.favicon || '',
            tags: row.tags || '',
            country: row.country || '',
            countrycode: row.countrycode || '',
            language: row.language || '',
            codec: row.codec || '',
            bitrate: Number(row.bitrate) || 0,
            votes: Number(row.votes) || 0,
            hls: Boolean(row.hls),
            source: 'radio-directory',
            extension: 'RADIO'
          });
        }
      }

      if (found.size) {
        return [...found.values()]
          .sort((a, b) => b.votes - a.votes)
          .slice(0, limit);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

module.exports = {
  IPTV_DEFAULT_PLAYLIST,
  loadIptvPlaylist,
  parseM3u,
  searchRadioStations
};
