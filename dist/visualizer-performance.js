'use strict';
// Pure, bounded adaptive GPU governor. This module is usable in both
// Electron renderer and Node's test runner, without new dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpiderVisualizerPerformance = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const PRESETS = Object.freeze({
    eco: Object.freeze({ scale: 0.60, fps: 18 }),
    balanced: Object.freeze({ scale: 0.86, fps: 30 }),
    ultra: Object.freeze({ scale: 1.18, fps: 45 })
  });
  const THEMES = Object.freeze({
    purple: Object.freeze([0.36, 0.06, 0.95]),
    crimson: Object.freeze([0.85, 0.04, 0.18]),
    ice: Object.freeze([0.08, 0.70, 0.95]),
    emerald: Object.freeze([0.10, 0.90, 0.55]),
    gold: Object.freeze([0.95, 0.55, 0.10])
  });
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  function sanitize(settings = {}) {
    return {
      quality: Object.hasOwn(PRESETS, settings.quality) ? settings.quality : 'balanced',
      theme: Object.hasOwn(THEMES, settings.theme) ? settings.theme : 'purple',
      motion: settings.motion === 'calm' || settings.motion === 'still' ? settings.motion : 'full',
      adaptive: settings.adaptive !== false,
      showStats: settings.showStats === true
    };
  }
  class AdaptiveGovernor {
    constructor() { this.reset(); }
    reset() {
      this.scale = 1;
      this.samples = [];
      this.cooldown = 0;
      this.lastAverage = 0;
      this.adjustments = 0;
    }
    record(durationMs, fps, adaptive = true) {
      if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(fps) || fps <= 0) return this.scale;
      if (!adaptive) return this.scale;
      this.samples.push(clamp(durationMs, 0, 250));
      if (this.samples.length < 24) return this.scale;
      const ordered = this.samples.sort((a, b) => a - b);
      // p75 rather than average avoids a single fast frame masking stutters.
      const p75 = ordered[Math.floor((ordered.length - 1) * 0.75)];
      this.samples = [];
      this.lastAverage = p75;
      if (this.cooldown > 0) { this.cooldown--; return this.scale; }
      const budget = 1000 / fps;
      if (p75 > budget * 0.88 && this.scale > 0.48) {
        this.scale = clamp(Math.round((this.scale - 0.12) * 100) / 100, 0.48, 1);
        this.cooldown = 2;
        this.adjustments++;
      } else if (p75 < budget * 0.45 && this.scale < 1) {
        this.scale = clamp(Math.round((this.scale + 0.05) * 100) / 100, 0.48, 1);
        this.cooldown = 3;
        this.adjustments++;
      }
      return this.scale;
    }
    snapshot() { return { scale: this.scale, p75Ms: this.lastAverage, adjustments: this.adjustments }; }
  }
  function renderSize(width, height, dpr, quality, adaptiveScale = 1, maxPixels = 1280 * 720) {
    const preset = PRESETS[quality] || PRESETS.balanced;
    const scale = preset.scale * clamp(dpr || 1, 0.6, 1.6) * clamp(adaptiveScale, 0.48, 1);
    const reduction = Math.min(1, Math.sqrt(maxPixels / Math.max(1, width * height * scale * scale)));
    return {
      width: Math.max(2, Math.floor(width * scale * reduction)),
      height: Math.max(2, Math.floor(height * scale * reduction))
    };
  }
  return Object.freeze({ PRESETS, THEMES, sanitize, AdaptiveGovernor, renderSize });
});
