'use strict';

// Local-only radio stream diagnostics. Counts successful chunk writes into
// connected listener sockets; it cannot prove remote playback or audibility.
class RadioTelemetry {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.staleAfterMs = options.staleAfterMs || 12000;
    this.reset();
  }
  reset() {
    this.listeners = new Map();
    this.startedAt = this.clock();
    this.bytesWritten = 0;
    this.chunksWritten = 0;
    this.lastChunkAt = null;
    this.slowDisconnects = 0;
  }
  connect(id) {
    if (typeof id !== 'string') return;
    this.listeners.set(id, {
      startedAt: this.clock(),
      bytesWritten: 0,
      chunksWritten: 0,
      lastChunkAt: null
    });
  }
  disconnect(id, reason = '') {
    if (reason === 'backpressure') this.slowDisconnects += 1;
    this.listeners.delete(id);
  }
  written(id, byteCount) {
    const listener = this.listeners.get(id);
    if (!listener || !Number.isSafeInteger(byteCount) || byteCount <= 0 || byteCount > 1024 * 1024) return false;
    const now = this.clock();
    listener.bytesWritten += byteCount;
    listener.chunksWritten += 1;
    listener.lastChunkAt = now;
    this.bytesWritten += byteCount;
    this.chunksWritten += 1;
    this.lastChunkAt = now;
    return true;
  }
  snapshot({ active = false, publicUrl = '' } = {}) {
    const now = this.clock();
    const entries = [...this.listeners.values()];
    const connectedListeners = entries.length;
    const stalledListeners = entries.filter(item =>
      now - (item.lastChunkAt === null ? item.startedAt : item.lastChunkAt) >= this.staleAfterMs).length;
    const flowingListeners = entries.filter(item =>
      item.lastChunkAt !== null && now - item.lastChunkAt < this.staleAfterMs).length;
    const awaitingFirstChunk = connectedListeners - stalledListeners - flowingListeners;
    let status = 'off_air';
    if (active) {
      if (!publicUrl) status = 'relay_not_ready';
      else if (connectedListeners === 0) status = 'no_listeners';
      else if (stalledListeners > 0) status = 'stalled';
      else if (flowingListeners > 0) status = 'sending';
      else status = 'waiting_for_first_audio';
    }
    return {
      active: Boolean(active),
      relayReady: Boolean(active && publicUrl),
      status,
      connectedListeners,
      flowingListeners,
      stalledListeners,
      awaitingFirstChunk,
      chunksWritten: this.chunksWritten,
      bytesWritten: this.bytesWritten,
      slowDisconnects: this.slowDisconnects,
      // Age is null until the first actual stream write.
      lastChunkAgeSeconds: this.lastChunkAt === null
        ? null
        : Math.max(0, Math.floor((now - this.lastChunkAt) / 1000)),
      // Do not expose URLs, listener addresses, bearer tokens, or listener IDs.
      note: 'Socket writes are not proof of playback or audibility on a remote device.'
    };
  }
}

module.exports = { RadioTelemetry };
