'use strict';

// IPC-only adapter to the native Spider OS Nova DJ service.
// Never expose an arbitrary local URL or file read to the renderer.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_REQUEST = 24 * 1024;
const MAX_RESPONSE = 96 * 1024;
const MAX_AUDIO = 4 * 1024 * 1024;

function nativeNova(options = {}) {
  const port = options.port || 9876;
  const cacheDir = options.cacheDir || path.join(os.homedir(), '.cache', 'spider-os', 'ai-dj');
  const timeoutMs = options.timeoutMs || 54000;
  const stationIdEvery = Math.max(2, Math.min(20, Number(options.stationIdEvery) || 4));
  let preparedBreaks = 0;

  function localRequest(method, endpoint, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    if (Buffer.byteLength(body) > MAX_REQUEST) return Promise.reject(new Error('Nova request is too large'));
    return new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1', port, path: endpoint, method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
        }
      }, response => {
        let received = 0;
        const chunks = [];
        response.on('data', part => {
          received += part.length;
          if (received > MAX_RESPONSE) {
            response.destroy(new Error('Nova returned too much data'));
            return;
          }
          chunks.push(part);
        });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Nova service returned HTTP ${response.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new Error('Nova returned invalid JSON')); }
        });
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('Nova service timed out')));
      request.on('error', reject);
      request.end(body || undefined);
    });
  }

  function readGeneratedAudio(reference) {
    if (typeof reference !== 'string' || !reference.startsWith('file:')) {
      throw new Error('Nova must return a local generated audio file');
    }
    let file;
    try { file = fileURLToPath(reference); }
    catch { throw new Error('Nova returned an invalid audio URL'); }
    const expected = path.resolve(cacheDir);
    const actual = fs.realpathSync(file);
    const actualDir = fs.realpathSync(expected);
    if (!actual.startsWith(actualDir + path.sep)) {
      throw new Error('Nova audio must be inside the DJ cache');
    }
    const extension = path.extname(actual).toLowerCase();
    const mimeType = extension === '.mp3' ? 'audio/mpeg' : extension === '.wav' ? 'audio/wav' : '';
    if (!mimeType) throw new Error('Nova returned an unsupported audio format');
    const stat = fs.statSync(actual);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_AUDIO) {
      throw new Error('Nova audio file is empty or too large');
    }
    const bytes = fs.readFileSync(actual);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  }

  return {
    async health() {
      const reply = await localRequest('GET', '/health');
      return { ok: reply.ok === true, host: 'Nova', service: reply.service || 'Spider AI DJ' };
    },
    async prepare(payload) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Invalid Nova request');
      }
      const current = payload.currentTrack || {};
      const next = payload.nextTrack || {};
      if (!current || !next || typeof current !== 'object' || typeof next !== 'object'
          || Array.isArray(current) || Array.isArray(next)) throw new Error('Invalid track metadata');
      const text = item => ({
        title: String(item.title || '').slice(0, 180),
        artist: String(item.artist || '').slice(0, 140),
        album: String(item.album || '').slice(0, 140)
      });
      const allowedTypes = new Set(['transition', 'station_id', 'liner', 'show_intro', 'show_outro', 'request']);
      const explicit = String(payload.type || 'transition').toLowerCase();
      const requestedType = allowedTypes.has(explicit) ? explicit : 'transition';
      // Every fourth successfully prepared automatic break identifies BCN.
      // Explicit station IDs, show starts and other operator choices take priority.
      const type = requestedType === 'transition' && (preparedBreaks + 1) % stationIdEvery === 0
        ? 'station_id' : requestedType;
      const safeContext = payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context)
        ? payload.context : {};
      const safeRequest = payload.request && typeof payload.request === 'object' && !Array.isArray(payload.request)
        ? payload.request : {};
      const approved = safeRequest.approved === true;
      const request = {
        event: 'prepareDJBreak',
        type,
        currentTrack: text(current),
        nextTrack: text(next),
        secondsRemaining: Math.max(0, Math.min(180, Number(payload.secondsRemaining) || 0)),
        context: {
          station: 'Broken City Network',
          host: 'Nova',
          showName: String(safeContext.showName || '').slice(0, 80),
          segment: String(safeContext.segment || '').slice(0, 80),
          tone: String(safeContext.tone || '').slice(0, 48)
        },
        request: approved
          ? { approved: true, approvedRequest: String(safeRequest.approvedRequest || '').slice(0, 180) }
          : { approved: false }
      };
      const reply = await localRequest('POST', '/dj/prepare', request);
      const audio = readGeneratedAudio(reply.audioFile);
      preparedBreaks += 1;
      return {
        id: String(reply.id || '').slice(0, 100),
        type,
        script: String(reply.script || '').slice(0, 1200),
        audioFile: audio,
        talkOver: reply.talkOver && typeof reply.talkOver === 'object'
          ? {
              startSecondsBeforeEnd: Math.max(2, Math.min(12, Number(reply.talkOver.startSecondsBeforeEnd) || 6)),
              duckLevel: Math.max(0.05, Math.min(1, Number(reply.talkOver.duckLevel) || 0.3)),
              crossfadeSeconds: Math.max(0, Math.min(12, Number(reply.talkOver.crossfadeSeconds) || 3))
            }
          : { startSecondsBeforeEnd: 6, duckLevel: 0.3, crossfadeSeconds: 3 }
      };
    }
  };
}

module.exports = { nativeNova };
