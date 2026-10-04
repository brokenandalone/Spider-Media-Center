// Lightweight audio engine scaffold for advanced processing features.
// This file creates an AudioContext, a 31-band EQ chain, an AnalyserNode,
// and exposes a small API for controlling EQ, presets, devices, and visualizer.

class AudioEngine {
  constructor() {
    this.ctx = null
    this.eqBands = []
    this.analyser = null
    this.master = null
    this.presetsKey = 'spider.audio.eq.presets'
    this.listeners = new Map()
  }

  async init() {
    if (this.ctx) return
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
      this.master = this.ctx.createGain()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.master.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)

      // Create the standard 1/3-octave frequency centers.
      const freqs = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
      this.eqBands = freqs.map((f) => {
        const n = this.ctx.createBiquadFilter()
        n.type = 'peaking'
        n.frequency.value = f
        n.Q.value = 1
        n.gain.value = 0
        return n
      })

      // chain: source -> eq0 -> ... -> eq30 -> mid/side -> master
      for (let i = 0; i < this.eqBands.length - 1; i++) {
        this.eqBands[i].connect(this.eqBands[i + 1])
      }

      // Mid/Side stereo width processing
      this._splitter = this.ctx.createChannelSplitter(2)
      // Summing nodes
      this._midSum = this.ctx.createGain()
      this._sideSum = this.ctx.createGain()
      // scaling
      this._midScale = this.ctx.createGain(); this._midScale.gain.value = 0.5
      this._sideScale = this.ctx.createGain(); this._sideScale.gain.value = 0.5
      // side width control
      this._sideWidth = this.ctx.createGain(); this._sideWidth.gain.value = 1
      // inverter for right channel when computing side
      this._rightNeg = this.ctx.createGain(); this._rightNeg.gain.value = -1

      // recombine
      this._leftOut = this.ctx.createGain()
      this._rightOut = this.ctx.createGain()
      this._merger = this.ctx.createChannelMerger(2)

      // connect EQ output into splitter
      this.eqBands[this.eqBands.length - 1].connect(this._splitter)

      // mid = L + R
      this._splitter.connect(this._midSum, 0)
      this._splitter.connect(this._midSum, 1)
      this._midSum.connect(this._midScale)

      // side = L - R
      this._splitter.connect(this._sideSum, 0)
      this._splitter.connect(this._rightNeg, 1)
      this._rightNeg.connect(this._sideSum)
      this._sideSum.connect(this._sideScale)

      // side width
      this._sideScale.connect(this._sideWidth)

      // left = mid + side*width
      this._midScale.connect(this._leftOut)
      this._sideWidth.connect(this._leftOut)
      // right = mid - side*width
      this._midScale.connect(this._rightOut)
      const _sideInvert = this.ctx.createGain(); _sideInvert.gain.value = -1
      this._sideWidth.connect(_sideInvert)
      _sideInvert.connect(this._rightOut)

      this._leftOut.connect(this._merger, 0, 0)
      this._rightOut.connect(this._merger, 0, 1)

      // panner/balance and master chain
      this._panner = this.ctx.createStereoPanner()
      // separate music bus so we can duck music when mic is live
      this._musicGain = this.ctx.createGain(); this._musicGain.gain.value = 1
      this._merger.connect(this._panner)
      this._panner.connect(this._musicGain)
      this._musicGain.connect(this.master)
      // inputs (microphones) will connect directly into master via per-input gain
      // map of attached media elements -> source nodes
      this._attached = new Map()
      // map of input id -> { stream, src, gain }
      this._inputs = new Map()
      this._buffers = new Map()
      this._duck = { enabled: false, depth: 0.6, attack: 0.02, release: 0.1 }
    } catch (e) {
      console.warn('AudioEngine init failed', e)
      this.ctx = null
    }
  }

  attachElement(el) {
    if (!el || !this.ctx) return
    if (this._attached.has(el)) return
    try {
      const src = this.ctx.createMediaElementSource(el)
      // connect to first EQ node
      src.connect(this.eqBands[0])
      this._attached.set(el, src)
    } catch (e) {
      console.warn('attachElement failed', e)
    }
  }

  async attachInputStream(stream) {
    await this.init()
    if (!stream) throw new Error('no stream')
    const id = `in_${Math.random().toString(36).slice(2,9)}`
    try {
      const src = this.ctx.createMediaStreamSource(stream)
      const preGain = this.ctx.createGain(); preGain.gain.value = 1
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -24
      comp.knee.value = 30
      comp.ratio.value = 12
      comp.attack.value = 0.003
      comp.release.value = 0.25

      const outGain = this.ctx.createGain(); outGain.gain.value = 1
      const analyser = this.ctx.createAnalyser(); analyser.fftSize = 1024
      const monitorGain = this.ctx.createGain(); monitorGain.gain.value = 0.5

      // chain: src -> preGain -> comp -> outGain -> master
      src.connect(preGain)
      preGain.connect(comp)
      comp.connect(outGain)
      outGain.connect(this.master)

      // analyser taps after compressor
      comp.connect(analyser)

      // monitor path (disconnected by default)
      // monitorGain will be connected to ctx.destination when requested

      this._inputs.set(id, { stream, src, preGain, compressor: comp, gainNode: outGain, analyser, monitorGain, monitorEnabled: false })
      this.emit('inputAttached', id)
      return id
    } catch (e) {
      console.warn('attachInputStream failed', e)
      throw e
    }
  }

  detachInputStream(id) {
    const rec = this._inputs.get(id)
    if (!rec) return
    try { rec.src.disconnect(); if (rec.preGain) rec.preGain.disconnect(); if (rec.compressor) rec.compressor.disconnect(); if (rec.gainNode) rec.gainNode.disconnect(); if (rec.analyser) rec.analyser.disconnect(); if (rec.monitorGain) rec.monitorGain.disconnect(); } catch {}
    this._inputs.delete(id)
    this.emit('inputDetached', id)
  }

  setMicGain(id, value = 1) {
    const rec = this._inputs.get(id)
    if (!rec) return
    try { if (rec.gainNode) rec.gainNode.gain.value = Number(value) } catch {}
    this.emit('micGain', { id, value })
  }

  setDucking(options = {}) {
    this._duck.enabled = Boolean(options.enabled)
    if (typeof options.depth === 'number') this._duck.depth = options.depth
    if (typeof options.attack === 'number') this._duck.attack = options.attack
    if (typeof options.release === 'number') this._duck.release = options.release
    this.emit('duckingChanged', this._duck)
  }

  triggerDucking(active = true) {
    if (!this._duck.enabled) return
    try {
      const now = this.ctx.currentTime
      const target = active ? Math.max(0, 1 - this._duck.depth) : 1
      const time = active ? this._duck.attack : this._duck.release
      this._musicGain.gain.cancelScheduledValues(now)
      this._musicGain.gain.setValueAtTime(this._musicGain.gain.value, now)
      this._musicGain.gain.linearRampToValueAtTime(target, now + time)
      this.emit('duck', { active, target })
    } catch (e) { console.warn('triggerDucking', e) }
  }

  detachElement(el) {
    const src = this._attached.get(el)
    if (!src) return
    try { src.disconnect() } catch {}
    this._attached.delete(el)
  }

  async setEQ(bands = []) {
    await this.init()
    for (const b of bands) {
      const idx = Math.max(0, Math.min(30, b.band | 0))
      const node = this.eqBands[idx]
      if (!node) continue
      if (typeof b.freq === 'number') node.frequency.value = b.freq
      if (typeof b.q === 'number') node.Q.value = b.q
      if (typeof b.gainDb === 'number') node.gain.value = b.gainDb
    }
    this.emit('eqChanged', this.getEQ())
  }

  getEQ() {
    return this.eqBands.map((n, i) => ({ band: i, freq: n.frequency.value, q: n.Q.value, gainDb: n.gain.value }))
  }

  async listEQPresets() {
    try { return JSON.parse(localStorage.getItem(this.presetsKey) || '{}') } catch { return {} }
  }

  async saveEQPreset(name, bands) {
    const all = await this.listEQPresets()
    all[name] = bands
    try { localStorage.setItem(this.presetsKey, JSON.stringify(all)) } catch {}
    this.emit('presetChanged', name)
  }

  async loadEQPreset(name) {
    const all = await this.listEQPresets()
    if (!all[name]) throw new Error('preset not found')
    await this.setEQ(all[name])
    this.emit('presetChanged', name)
  }

  async deleteEQPreset(name) {
    const all = await this.listEQPresets()
    delete all[name]
    try { localStorage.setItem(this.presetsKey, JSON.stringify(all)) } catch {}
    this.emit('presetChanged', null)
  }

  setStereoWidth() { /* stub */ }
  setStereoWidth(value = 1) {
    try { this._sideWidth.gain.value = Number(value) } catch {}
    this.emit('stereoWidth', value)
  }

  setBalance(value = 0) {
    try { this._panner.pan.value = Number(value) } catch {}
    this.emit('balance', value)
  }

  async listOutputDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label }))
  }

  async setOutputDevice(deviceId) {
    // attempt to set sinkId on attached audio elements
    try {
      for (const el of Array.from(this._attached.keys())) {
        if (typeof el.setSinkId === 'function') {
          try { await el.setSinkId(deviceId) } catch (e) { console.warn('setSinkId failed', e) }
        }
      }
    } catch (e) { console.warn('setOutputDevice', e) }
    this.emit('outputChanged', deviceId)
  }

  setVisualizerMode() { /* stub */ }
  getAnalyzerData() {
    if (!this.analyser) return null
    const arr = new Uint8Array(this.analyser.frequencyBinCount)
    this.analyser.getByteFrequencyData(arr)
    return arr
  }

  async refreshDevices() {
    const list = await this.listOutputDevices()
    this.emit('devices', list)
    return list
  }

  async loadBuffer(url) {
    await this.init()
    if (this._buffers.has(url)) return this._buffers.get(url)
    try {
      const resp = await fetch(url)
      const ab = await resp.arrayBuffer()
      const buf = await this.ctx.decodeAudioData(ab)
      this._buffers.set(url, buf)
      return buf
    } catch (e) {
      console.warn('loadBuffer failed', url, e)
      throw e
    }
  }

  async playBuffer(url, when = 0, opts = {}) {
    await this.init()
    try {
      let buf = this._buffers.get(url)
      if (!buf) buf = await this.loadBuffer(url)
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const g = this.ctx.createGain(); g.gain.value = typeof opts.volume === 'number' ? opts.volume : 1
      src.connect(g)
      g.connect(this.eqBands[0])
      src.start(this.ctx.currentTime + when)
      // optional stop after duration
      if (opts.duration && opts.duration > 0) src.stop(this.ctx.currentTime + when + opts.duration)
      return src
    } catch (e) { console.warn('playBuffer failed', e); throw e }
  }

  setInputMonitor(id, enabled = false) {
    const rec = this._inputs.get(id)
    if (!rec) return
    try {
      if (enabled && !rec.monitorEnabled) {
        // connect monitor path to destination
        rec.gainNode.connect(rec.monitorGain)
        rec.monitorGain.connect(this.ctx.destination)
        rec.monitorEnabled = true
      } else if (!enabled && rec.monitorEnabled) {
        try { rec.gainNode.disconnect(rec.monitorGain) } catch {}
        try { rec.monitorGain.disconnect(this.ctx.destination) } catch {}
        rec.monitorEnabled = false
      }
    } catch (e) { console.warn('setInputMonitor', e) }
    this.emit('monitor', { id, enabled })
  }

  setInputCompressor(id, opts = {}) {
    const rec = this._inputs.get(id)
    if (!rec || !rec.compressor) return
    try {
      if (typeof opts.threshold === 'number') rec.compressor.threshold.value = opts.threshold
      if (typeof opts.knee === 'number') rec.compressor.knee.value = opts.knee
      if (typeof opts.ratio === 'number') rec.compressor.ratio.value = opts.ratio
      if (typeof opts.attack === 'number') rec.compressor.attack.value = opts.attack
      if (typeof opts.release === 'number') rec.compressor.release.value = opts.release
    } catch (e) { console.warn('setInputCompressor', e) }
    this.emit('compressor', { id, opts })
  }

  getInputLevel(id) {
    const rec = this._inputs.get(id)
    if (!rec || !rec.analyser) return 0
    try {
      const arr = new Uint8Array(rec.analyser.fftSize)
      rec.analyser.getByteTimeDomainData(arr)
      // compute RMS
      let sum = 0
      for (let i = 0; i < arr.length; i++) {
        const v = (arr[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / arr.length)
      return Math.max(0, Math.min(1, rms))
    } catch (e) { return 0 }
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(cb)
    return () => this.off(event, cb)
  }

  off(event, cb) {
    if (!this.listeners.has(event)) return
    this.listeners.get(event).delete(cb)
  }

  emit(event, payload) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const cb of Array.from(set)) cb(payload)
  }
}

const audioEngine = new AudioEngine()
window.__spiderAudioEngine = audioEngine
export default audioEngine
