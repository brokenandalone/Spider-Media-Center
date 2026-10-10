'use strict';

// Public requests are text-only suggestions; DJ audio and programming
// always require separate operator approval from BCN Request Desk.
const crypto = require('node:crypto');

const MAX_BODY = 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_CLIENT = 3;
const MAX_GLOBAL = 75;

function send(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(message));
}

class BcnListenerIntake {
  constructor(options) {
    this.desk = options.desk;
    this.clock = options.clock || (() => Date.now());
    this.onAccepted = options.onAccepted || (() => {});
    this.salt = crypto.randomBytes(32);
    this.attempts = new Map();
    this.globalAttempts = [];
  }

  rateKey(req) {
    // A Cloudflare Tunnel forwards a connecting-IP header to localhost.
    // Never write the raw address to disk, the radio metadata or response.
    const raw = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown').slice(0, 128);
    return crypto.createHmac('sha256', this.salt).update(raw).digest('hex');
  }

  checkRate(req) {
    const cutoff = this.clock() - WINDOW_MS;
    for (const [key, hits] of this.attempts) {
      const current = hits.filter(time => time > cutoff);
      if (!current.length) this.attempts.delete(key);
      else this.attempts.set(key, current);
    }
    this.globalAttempts = this.globalAttempts.filter(time => time > cutoff);
    const key = this.rateKey(req);
    const hits = this.attempts.get(key) || [];
    if (hits.length >= MAX_PER_CLIENT || this.globalAttempts.length >= MAX_GLOBAL) return false;
    hits.push(this.clock());
    this.attempts.set(key, hits);
    this.globalAttempts.push(this.clock());
    return true;
  }

  validOrigin(req) {
    const header = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || header === 'null') return false;
    if (!header) return true; // command-line clients may omit Origin
    try {
      const origin = new URL(header);
      const host = String(req.headers.host || '');
      const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
      return origin.host === host && (origin.protocol === 'https:' || (local && origin.protocol === 'http:'));
    } catch { return false; }
  }

  async accept(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, message: 'Use POST' });
    if (!this.desk.listenerRequestsEnabled) {
      return send(res, 403, { ok: false, message: 'BCN listener requests are closed.' });
    }
    if (!this.validOrigin(req)) return send(res, 403, { ok: false, message: 'Request origin rejected.' });
    const mediaType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') return send(res, 415, { ok: false, message: 'JSON content type required.' });
    if (!this.checkRate(req)) return send(res, 429, { ok: false, message: 'Request limit reached. Try again later.' });

    try {
      const length = Number(req.headers['content-length'] || 0);
      if (length > MAX_BODY || length < 0 || !Number.isFinite(length)) {
        return send(res, 413, { ok: false, message: 'Request is too large.' });
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) return send(res, 413, { ok: false, message: 'Request is too large.' });
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.text !== 'string') {
        return send(res, 400, { ok: false, message: 'Request must contain text.' });
      }
      if (body.text.length > 180 || body.text.trim().length < 3) {
        return send(res, 400, { ok: false, message: 'Request must be between 3 and 180 characters.' });
      }
      this.desk.addListenerRequest(body.text);
      try { this.onAccepted(); } catch {}
      return send(res, 202, { ok: true, message: 'Sent to BCN for review. No request is guaranteed airtime.' });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : /full/i.test(error.message) ? 429 : 400;
      return send(res, status, { ok: false, message: status === 429
        ? 'The request desk is full.'
        : 'Could not accept that request.' });
    }
  }
}

module.exports = { BcnListenerIntake };
