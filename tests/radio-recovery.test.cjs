'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RadioRecoveryState, safeProfile } = require('../electron/radio-recovery.cjs');

function fixture() {
  let now = Date.UTC(2026, 9, 10, 18, 0, 0);
  const recovery = new RadioRecoveryState({ clock: () => now });
  return { recovery, advance: ms => { now += ms; } };
}
const profile = Object.freeze({
  name: 'Broken City Network',
  dj: 'Nova',
  description: 'Live music from Spider OS',
  mimeType: 'audio/mp4;codecs=mp4a.40.2'
});

test('a manual start, successful radio connection or normal stop never arms recovery', () => {
  const {recovery} = fixture();
  assert.equal(recovery.retryState().available, false);
  recovery.manualStart(profile);
  assert.equal(recovery.retryState().lost, false);
  assert.throws(() => recovery.beginRecovery(), /No unexpectedly disconnected/);
  recovery.relayLost('Tunnel exited');
  assert.equal(recovery.retryState().lost, true);
  recovery.manualStop();
  assert.equal(recovery.retryState().lost, false);
  assert.throws(() => recovery.beginRecovery(), /No unexpectedly disconnected/);
});

test('unexpected tunnel failure allows an explicit retry with sanitized profile and fresh URL requirement', () => {
  const {recovery,advance} = fixture();
  recovery.manualStart({...profile, token:'DO NOT COPY', publicUrl:'https://secret.example'});
  recovery.relayLost('Cloudflare relay exited');
  const status = recovery.retryState();
  assert.equal(status.available, true);
  assert.equal(status.freshLinkRequired, true);
  assert.match(status.reason, /exited/);
  const next = recovery.beginRecovery();
  assert.deepEqual(next, profile);
  assert.equal(JSON.stringify(status).includes('secret.example'), false);
  assert.equal(JSON.stringify(status).includes('DO NOT COPY'), false);
  recovery.recovered();
  assert.equal(recovery.retryState().lost, false);
  recovery.relayLost('Dropped again');
  assert.equal(recovery.retryState().available, false);
  assert.equal(recovery.retryState().retryAfterSeconds, 15);
  advance(15000);
  assert.equal(recovery.retryState().available, true);
});

test('repeated recoveries are capped until the rolling hour expires', () => {
  const {recovery,advance} = fixture();
  recovery.manualStart(profile);
  for(let count=0; count<3; count++) {
    recovery.relayLost('Unexpected exit');
    assert.equal(recovery.retryState().available, true);
    recovery.beginRecovery();
    recovery.recovered();
    advance(15000);
  }
  recovery.relayLost('Fourth relay drop');
  assert.equal(recovery.retryState().available, false);
  assert.equal(recovery.retryState().attemptsRemaining, 0);
  assert.throws(() => recovery.beginRecovery(), /limit reached/i);
  advance(60*60*1000);
  assert.equal(recovery.retryState().available, true);
});

test('restart profile rejects invalid entries and omits tokens', () => {
  assert.throws(() => safeProfile(null), /Invalid/);
  assert.throws(() => safeProfile({name:''}), /required/);
  const value=safeProfile({name:'BCN\nLive',dj:'Nova',token:'secret',publicUrl:'https://old.invalid',
    description:'X'.repeat(600),mimeType:'application/x-fake'});
  assert.equal(value.name, 'BCN Live');
  assert.equal(value.description.length, 220);
  assert.equal(value.mimeType, 'audio/mp4;codecs=mp4a.40.2');
  assert.deepEqual(Object.keys(value), ['name','dj','description','mimeType']);
});

test('radio recovery is explicitly initiated and queue/state operations are serialized', () => {
  const main=fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const preload=fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const panel=fs.readFileSync(path.join(__dirname, '..', 'dist', 'media-center-upgrades.js'), 'utf8');
  const pack=fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package-media-center.mjs'), 'utf8');
  assert.match(main, /ipcMain\.handle\('radio:recover'/);
  assert.match(main, /trustedMediaSender\(event\)/);
  assert.match(main, /serializeRadioOperation\(async \(\) =>/);
  assert.match(main, /radioRecovery\.manualStop\(\)/);
  assert.match(main, /establishedTunnel\.once\('exit'/);
  assert.match(main, /type: 'relay-lost'/);
  assert.match(main, /freshLinkRequired: true/);
  assert.match(preload, /radioRecover: \(\) => invoke\('radio:recover'\)/);
  assert.match(panel, /Operator Relay Recovery/);
  assert.match(panel, /restoreRights\.checked/);
  assert.doesNotMatch(panel, /setInterval\(\s*\(\)\s*=>\s*window\.spider\.radioRecover/);
  assert.match(pack, /'radio-recovery\.cjs'/);
});
