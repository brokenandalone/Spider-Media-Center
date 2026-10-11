'use strict';

// BCN remote relay health. Checks the existing public listener state endpoint
// over HTTPS, never creates tunnels, changes the playlist or restarts radio.
const DEFAULT_INTERVAL_MS = 30_000;
const FAILURE_THRESHOLD = 3;
const TIMEOUT_MS = 6_000;

function stateUrl(publicUrl, { allowLocal = false } = {}) {
  const url = new URL(publicUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid relay URL');
  const external = url.protocol === 'https:' && /^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) && !url.port;
  const local = allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    (!url.port || /^\d{1,5}$/.test(url.port));
  if (!external && !local) throw new Error('Unsupported relay host');
  if (!/^\/[a-f0-9]{40}$/i.test(url.pathname)) throw new Error('Invalid radio session token');
  url.pathname = '/state' + url.pathname;
  return url.toString();
}

class PublicRelayWatch {
  constructor(options = {}) {
    this.fetcher = options.fetcher || globalThis.fetch;
    this.clock = options.clock || Date.now;
    this.setInterval = options.setInterval || globalThis.setInterval;
    this.clearInterval = options.clearInterval || globalThis.clearInterval;
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs || TIMEOUT_MS;
    this.allowLocal = options.allowLocal === true;
    this.reset();
  }
  reset() {
    this.generation = (this.generation || 0) + 1;
    if (this.timer) this.clearInterval(this.timer);
    if (this.abort) this.abort.abort();
    this.timer = null;
    this.abort = null;
    this.endpoint = null;
    this.expectedName = '';
    this.onTransition = null;
    this.inFlight = false;
    this.status = 'off_air';
    this.lastSuccessAt = null;
    this.lastCheckedAt = null;
    this.consecutiveFailures = 0;
    this.totalFailures = 0;
  }
  start(publicUrl, expectedName, onTransition) {
    const endpoint = stateUrl(publicUrl, { allowLocal: this.allowLocal });
    this.reset();
    this.endpoint = endpoint;
    this.expectedName = String(expectedName || '');
    this.onTransition = typeof onTransition === 'function' ? onTransition : () => {};
    this.status = 'checking';
    this.timer = this.setInterval(() => { void this.check(); }, this.intervalMs);
    void this.check();
  }
  stop() { this.reset(); }
  async check() {
    if (!this.endpoint || this.inFlight) return this.snapshot();
    const generation = this.generation;
    this.inFlight = true;
    this.abort = new AbortController();
    const controller = this.abort;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let passed = false;
    try {
      const result = await this.fetcher(this.endpoint, {
        method: 'GET', signal: controller.signal, redirect: 'error',
        cache: 'no-store', credentials: 'omit', headers: { 'Accept': 'application/json' }
      });
      if (result?.ok && String(result.headers?.get?.('content-type') || '').includes('application/json')) {
        const body = await result.json();
        passed = body && typeof body === 'object' && body.name === this.expectedName &&
          Number.isSafeInteger(body.listenerCount) && body.listenerCount >= 0 &&
          Object.hasOwn(body, 'nowPlaying');
      }
    } catch { /* Network errors are not surfaced with secret URLs. */ }
    finally {
      clearTimeout(timer);
      if (generation === this.generation) {
        this.inFlight = false;
        this.abort = null;
      }
    }
    if (generation !== this.generation) return this.snapshot();
    const before = this.status;
    this.lastCheckedAt = this.clock();
    if (passed) {
      this.consecutiveFailures = 0;
      this.lastSuccessAt = this.lastCheckedAt;
      this.status = 'reachable';
    } else {
      this.consecutiveFailures += 1;
      this.totalFailures += 1;
      this.status = this.consecutiveFailures >= FAILURE_THRESHOLD ? 'degraded' : 'checking';
    }
    if (this.status !== before && (this.status === 'degraded' || (before === 'degraded' && this.status === 'reachable'))) {
      try { this.onTransition(this.snapshot()); } catch { }
    }
    return this.snapshot();
  }
  snapshot() {
    return {
      status: this.status,
      reachability: this.status === 'reachable' ? 'confirmed' :
        this.status === 'degraded' ? 'unreachable' : 'unverified',
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      lastCheckedAt: this.lastCheckedAt === null ? null : new Date(this.lastCheckedAt).toISOString(),
      lastSuccessAt: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      note: 'Public HTTP reachability is not proof that listeners can hear the audio. No automatic broadcast restart.'
    };
  }
}
module.exports = { PublicRelayWatch, stateUrl };
