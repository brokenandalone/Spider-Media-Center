'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
const start = code.indexOf('async function playDJBreak(breakItem) {');
const end = code.indexOf('\nfunction primeNextDeck()', start);
assert.ok(start >= 0 && end > start, 'Nova break handler must exist');

test('Nova voice reaches BOTH speakers and the BCN listener stream', async () => {
  const destination = { name: 'speakers' };
  const broadcastDestination = { name: 'BCN listeners' };
  const voiceDestinations = [];
  let duckCalls = 0;
  const gain = {
    gain: { value: 0.5, setTargetAtTime() {} },
    connect(target) { voiceDestinations.push(target); },
    disconnect() {}
  };
  const context = {
    destination,
    createGain: () => gain,
    createBufferSource: () => ({
      buffer: null, connect() {}, disconnect() {},
      start() { queueMicrotask(() => this.onended?.()); }
    }),
    async decodeAudioData() { return { duration: 0.2 }; }
  };
  const state = {
    muted: false, panicMuted: false, audioContext: context,
    broadcastDestination, aiDj: { musicDuckLevel: 0.3, voiceVolume: 1.0, duckingActive: false }
  };
  const sandbox = vm.createContext({
    state, decks: [{}, {}],
    applyDeckVolume() { duckCalls++; },
    ensureAudioEngine: () => context,
    normalizeDJAudioUrl: url => url,
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(64) }),
    window: { setTimeout() {} },
    console
  });
  vm.runInContext(code.slice(start, end), sandbox);
  await vm.runInContext("playDJBreak({audioFile:'data:audio/wav;base64,Zm9v',talkOver:{duckLevel:0.25}})", sandbox);
  assert.ok(voiceDestinations.includes(destination), 'Nova must be audible locally');
  assert.ok(voiceDestinations.includes(broadcastDestination), 'Nova must be included in BCN stream');
  assert.equal(state.aiDj.duckingActive, false, 'Music volume recovers after the break');
  assert.equal(state.novaVoiceGain, null, 'No voice nodes remain active');
  assert.ok(duckCalls >= 4, 'DJ ducking and restoration update both decks');
});

test('Nova does not speak while the panic mute is active', async () => {
  const state = { panicMuted: true, muted: false };
  const sandbox = vm.createContext({
    state, normalizeDJAudioUrl: v => v,
    ensureAudioEngine() { throw new Error('Muted DJ should never access audio'); }
  });
  vm.runInContext(code.slice(start, end), sandbox);
  await vm.runInContext("playDJBreak({audioFile:'data:audio/wav;base64,Zm9v'})", sandbox);
});
