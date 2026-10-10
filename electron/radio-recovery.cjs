'use strict';

// Operator-initiated recovery only. Never persist live tokens or silently
// restart a public relay. Quick Tunnel recovery produces a DIFFERENT URL.
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 15 * 1000;

function safeProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Invalid radio profile');
  const name = String(profile.name || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 80);
  if (!name) throw new Error('Station name is required');
  const dj = String(profile.dj || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 60);
  const description = String(profile.description || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 220);
  const formats = new Set(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']);
  const mimeType = formats.has(profile.mimeType) ? profile.mimeType : 'audio/mp4;codecs=mp4a.40.2';
  return {name, dj, description, mimeType};
}

class RadioRecoveryState {
  constructor(options = {}) {
    this.clock = options.clock || Date.now;
    this.profile = null;
    this.reason = '';
    this.failedAt = null;
    this.attempts = [];
  }

  manualStart(profile) {
    this.profile = safeProfile(profile);
    this.reason = '';
    this.failedAt = null;
    this.attempts = [];
  }

  relayLost(reason = 'Public relay disconnected unexpectedly') {
    if (!this.profile) return;
    this.reason = String(reason).slice(0, 160);
    this.failedAt = this.clock();
  }

  manualStop() {
    this.profile = null;
    this.reason = '';
    this.failedAt = null;
    this.attempts = [];
  }

  recovered() {
    this.reason = '';
    this.failedAt = null;
    // Keep attempts within the window to avoid limitless operator retries.
  }

  retryState(isActive = false) {
    const now = this.clock();
    this.attempts = this.attempts.filter(at => now - at < WINDOW_MS);
    const remaining = Math.max(0, MAX_ATTEMPTS - this.attempts.length);
    const cooloff = this.attempts.length ? COOLDOWN_MS - (now - this.attempts[this.attempts.length - 1]) : 0;
    const retryAfterSeconds = Math.max(0, Math.ceil(cooloff / 1000));
    return {
      available: Boolean(!isActive && this.profile && this.failedAt !== null && remaining && !retryAfterSeconds),
      lost: Boolean(!isActive && this.profile && this.failedAt !== null),
      reason: this.reason,
      failedAt: this.failedAt ? new Date(this.failedAt).toISOString() : null,
      attemptsRemaining: remaining,
      retryAfterSeconds,
      freshLinkRequired: Boolean(this.failedAt !== null),
      note: 'Operator confirmation required. Recovery rotates the listener URL; old links will not work.'
    };
  }

  beginRecovery(isActive = false) {
    const status = this.retryState(isActive);
    if (!status.lost) throw new Error('No unexpectedly disconnected broadcast to restore.');
    if (status.attemptsRemaining === 0) throw new Error('Recovery limit reached. Start a fresh broadcast manually.');
    if (status.retryAfterSeconds) throw new Error('Recovery cooling down; retry after ' + status.retryAfterSeconds + ' seconds.');
    this.attempts.push(this.clock());
    return {...this.profile};
  }
}

module.exports = { RadioRecoveryState, safeProfile };
