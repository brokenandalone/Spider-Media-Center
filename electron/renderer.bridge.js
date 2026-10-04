// Minimal external bridge that proxies to the internal engine
// and intentionally avoids touching the DOM. This isolates the
// React-facing API from legacy UI code.

const engine = window.__spiderPlayerEngine;

window.__spiderPlayerBridge = {
  getSnapshot() { return engine.getSnapshot(); },
  getAIDJSnapshot() { return engine.getAIDJSnapshot ? engine.getAIDJSnapshot() : null; },
  onPlayerEvent(eventName, callback) { return engine.onPlayerEvent ? engine.onPlayerEvent(eventName, callback) : () => {}; },
  queueDJBreak(payload) { return engine.queueDJBreak ? engine.queueDJBreak(payload) : { ok: false, message: 'AI DJ unavailable' }; },
  getAIDJConfig() { return engine.getAIDJConfig ? engine.getAIDJConfig() : null; },
  setAIDJConfig(config) { return engine.setAIDJConfig ? engine.setAIDJConfig(config) : null; },
  getQueueSnapshot() { return engine.getQueueSnapshot(); },
  getLibrarySnapshot() { return engine.getLibrarySnapshot ? engine.getLibrarySnapshot() : { library: [], count: 0 } },
  removeLibraryEntries(ids) { return engine.removeLibraryEntries ? engine.removeLibraryEntries(ids) : [] },
  playQueueIndex(i) { return engine.playQueueIndex(i); },
  enqueue(item, playNow = false) { return engine.enqueue ? engine.enqueue(item, !!playNow) : Promise.reject(new Error('no engine enqueue')) },
  enqueueMany(items, playFirst = false) { return engine.enqueueMany ? engine.enqueueMany(items, !!playFirst) : Promise.reject(new Error('no engine enqueueMany')) },
  addMedia() { return engine.addMedia(); },
  clearQueue() { return engine.clearQueue(); },
  togglePlay() { return engine.togglePlay(); },
  previous() { return engine.previous(); },
  next() { return engine.next(); },
  back(s = 10) { return engine.back(s); },
  forward(s = 10) { return engine.forward(s); },
  toggleShuffle() { return engine.toggleShuffle(); },
  cycleRepeat() { return engine.cycleRepeat(); },
  seek(v) { return engine.seek(v); },
  setVolume(v) { return engine.setVolume(v); },
  toggleMute() { return engine.toggleMute(); },
  setCrossfade(v) { return engine.setCrossfade(v); },
  cycleVisualizer() { return engine.cycleVisualizer(); },
  testTone(f, d, v) { return engine.testTone ? engine.testTone(f, d, v) : { ok: false, message: 'no test tone support' } },
  resetAudio() { return engine.resetAudio ? engine.resetAudio() : { ok: false, message: 'no reset support' } },
  getDiagnostics() { return engine.getDiagnostics ? engine.getDiagnostics() : { track: 'unavailable', mixer: 'unavailable', speakers: 'unavailable', broadcast: 'unavailable' } },
  getLightweightMode() { return engine.getLightweightMode ? engine.getLightweightMode() : false },
  setLightweightMode(enabled) { return engine.setLightweightMode ? engine.setLightweightMode(enabled) : false },
  getBroadcastRecoveryState() { return engine.getBroadcastRecoveryState ? engine.getBroadcastRecoveryState() : { enabled: true, silenceThresholdMs: 5000, fallbackCount: 0 } },
  setBroadcastRecovery(config) { return engine.setBroadcastRecovery ? engine.setBroadcastRecovery(config) : { enabled: true, silenceThresholdMs: 5000, fallbackCount: 0 } },
  triggerBroadcastRecovery() { return engine.triggerBroadcastRecovery ? engine.triggerBroadcastRecovery() : false }
  ,
  // Audio engine hooks
  setEQ(bands) { return window.__spiderAudioEngine?.setEQ ? window.__spiderAudioEngine.setEQ(bands) : engine.setEQ(bands) },
  getEQ() { return window.__spiderAudioEngine?.getEQ ? window.__spiderAudioEngine.getEQ() : engine.getEQ() },
  listEQPresets() { return window.__spiderAudioEngine?.listEQPresets ? window.__spiderAudioEngine.listEQPresets() : engine.listEQPresets() },
  saveEQPreset(name, bands) { return window.__spiderAudioEngine?.saveEQPreset ? window.__spiderAudioEngine.saveEQPreset(name, bands) : engine.saveEQPreset(name, bands) },
  loadEQPreset(name) { return window.__spiderAudioEngine?.loadEQPreset ? window.__spiderAudioEngine.loadEQPreset(name) : engine.loadEQPreset(name) },
  deleteEQPreset(name) { return window.__spiderAudioEngine?.deleteEQPreset ? window.__spiderAudioEngine.deleteEQPreset(name) : engine.deleteEQPreset(name) },
  listOutputDevices() { return (window.__spiderAudioEngine && window.__spiderAudioEngine.listOutputDevices) ? window.__spiderAudioEngine.listOutputDevices() : Promise.resolve([]) },
  setOutputDevice(id) { return (window.__spiderAudioEngine && window.__spiderAudioEngine.setOutputDevice) ? window.__spiderAudioEngine.setOutputDevice(id) : Promise.reject(new Error('no audio engine')) },
  getAnalyzerData() { return window.__spiderAudioEngine?.getAnalyzerData ? window.__spiderAudioEngine.getAnalyzerData() : engine.getAnalyzerData() },
  getProgramGain() { return engine.getProgramGain() },
  setProgramGain(value) { return engine.setProgramGain(value) },
  panicMute() { return engine.panicMute() },
  clearPanicMute() { return engine.clearPanicMute() },
  isPanicMuted() { return engine.isPanicMuted() },
  getDeckGains() { return engine.getDeckGains() },
  setDeckGain(index, value) { return engine.setDeckGain(index, value) },
  getEQSettings() { return window.__spiderAudioEngine?.getEQSettings ? window.__spiderAudioEngine.getEQSettings() : engine.getEQSettings() },
  setEQSettings(settings) { return window.__spiderAudioEngine?.setEQSettings ? window.__spiderAudioEngine.setEQSettings(settings) : engine.setEQSettings(settings) },
  refreshDevices() { return (window.__spiderAudioEngine && window.__spiderAudioEngine.refreshDevices) ? window.__spiderAudioEngine.refreshDevices() : Promise.resolve([]) },
  onAudio(event, cb) { return (window.__spiderAudioEngine && window.__spiderAudioEngine.on) ? window.__spiderAudioEngine.on(event, cb) : () => {} }
  ,
  // Attach existing audio elements (useful after React mounts audio elements)
  attachAllAudioElements() { if (window.__spiderAudioEngine && typeof window.__spiderAudioEngine.attachElement === 'function') { document.querySelectorAll('audio').forEach(a => { try { window.__spiderAudioEngine.attachElement(a) } catch {} }); return true } return false }
  ,
  // Input stream / mic control
  attachInputStream(stream) { return window.__spiderAudioEngine?.attachInputStream ? window.__spiderAudioEngine.attachInputStream(stream) : engine.attachInputStream(stream) },
  detachInputStream(id) { return window.__spiderAudioEngine?.detachInputStream ? window.__spiderAudioEngine.detachInputStream(id) : engine.detachInputStream(id) },
  setMicGain(id, value) { return window.__spiderAudioEngine?.setMicGain ? window.__spiderAudioEngine.setMicGain(id, value) : engine.setMicGain(id, value) },
  setDucking(opts) { return window.__spiderAudioEngine?.setDucking ? window.__spiderAudioEngine.setDucking(opts) : engine.setDucking(opts) },
  triggerDucking(active) { return window.__spiderAudioEngine?.triggerDucking ? window.__spiderAudioEngine.triggerDucking(active) : engine.triggerDucking(active) },
  // Buffer playback for soundboard
  loadBuffer(url) { return window.__spiderAudioEngine?.loadBuffer ? window.__spiderAudioEngine.loadBuffer(url) : engine.loadBuffer(url) },
  playBuffer(url, when, opts) { return window.__spiderAudioEngine?.playBuffer ? window.__spiderAudioEngine.playBuffer(url, when, opts) : engine.playBuffer(url, when, opts) }
  ,
  // Broadcast controls
  startRadio(profile) { return (engine && typeof engine.startRadio === 'function') ? engine.startRadio(profile) : Promise.reject(new Error('no engine')) },
  stopRadio() { return (engine && typeof engine.stopRadio === 'function') ? engine.stopRadio() : Promise.reject(new Error('no engine')) },
  getRadioState() { return (engine && typeof engine.getRadioState === 'function') ? engine.getRadioState() : { active: false } }
  ,
  // Recording (RECORD SHOW)
  startRecording(meta) { return (engine && typeof engine.startRecording === 'function') ? engine.startRecording(meta) : Promise.reject(new Error('no engine')) },
  stopRecording() { return (engine && typeof engine.stopRecording === 'function') ? engine.stopRecording() : Promise.reject(new Error('no engine')) },
  // Input monitoring and compressor
  setInputMonitor(id, enabled) { return window.__spiderAudioEngine?.setInputMonitor ? window.__spiderAudioEngine.setInputMonitor(id, enabled) : engine.setInputMonitor(id, enabled) },
  getInputLevel(id) { return window.__spiderAudioEngine?.getInputLevel ? window.__spiderAudioEngine.getInputLevel(id) : engine.getInputLevel(id) }
  ,
  setVoiceEffect(id, effect) { return window.__spiderAudioEngine?.setVoiceEffect ? window.__spiderAudioEngine.setVoiceEffect(id, effect) : engine.setVoiceEffect(id, effect) },
  setInputCompressor(id, options) { return window.__spiderAudioEngine?.setInputCompressor ? window.__spiderAudioEngine.setInputCompressor(id, options) : engine.setInputCompressor(id, options) },
  listInputDevices() { return window.__spiderAudioEngine?.listInputDevices ? window.__spiderAudioEngine.listInputDevices() : engine.listInputDevices() }
  ,
  stopBuffer(source, fadeMs) { return window.__spiderAudioEngine?.stopBuffer ? window.__spiderAudioEngine.stopBuffer(source, fadeMs) : engine.stopBuffer(source, fadeMs) },
  stopAllBuffers() { return window.__spiderAudioEngine?.stopAllBuffers ? window.__spiderAudioEngine.stopAllBuffers() : engine.stopAllBuffers() }
};
