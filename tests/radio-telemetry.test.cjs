'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RadioTelemetry } = require('../electron/radio-telemetry.cjs');

function fixture() {
  let now = 1000;
  const telemetry = new RadioTelemetry({ clock: () => now, staleAfterMs: 12000 });
  const tick = ms => { now += ms; };
  const status = () => telemetry.snapshot({active:true,publicUrl:'https://test.example/secret'});
  return { telemetry, tick, status };
}

test('a public relay with no listener is not considered audio delivery', () => {
  const { telemetry, status } = fixture();
  assert.equal(telemetry.snapshot().status, 'off_air');
  assert.equal(telemetry.snapshot({active:true}).status, 'relay_not_ready');
  assert.equal(status().status, 'no_listeners');
  assert.equal(status().lastChunkAgeSeconds, null);
  assert.equal(status().relayReady, true);
});

test('a listener stays unverified until chunks are written', () => {
  const { telemetry, tick, status } = fixture();
  telemetry.connect('a');
  assert.equal(status().status, 'waiting_for_first_audio');
  assert.equal(status().awaitingFirstChunk, 1);
  tick(11500);
  assert.equal(status().status, 'waiting_for_first_audio');
  tick(500);
  assert.equal(status().status, 'stalled');
  assert.equal(status().stalledListeners, 1);
  assert.equal(telemetry.written('a', 1024), true);
  assert.equal(status().status, 'sending');
  assert.equal(status().bytesWritten, 1024);
  assert.equal(status().chunksWritten, 1);
  assert.equal(status().lastChunkAgeSeconds, 0);
  tick(13000);
  assert.equal(status().status, 'stalled');
});

test('multiple receivers are diagnosed independently; stale delivery is not hidden', () => {
  const { telemetry, tick, status } = fixture();
  telemetry.connect('a');
  telemetry.connect('b');
  telemetry.written('a', 128);
  tick(13000);
  telemetry.written('b', 64);
  assert.equal(status().status, 'stalled');
  assert.equal(status().connectedListeners, 2);
  assert.equal(status().flowingListeners, 1);
  assert.equal(status().stalledListeners, 1);
  telemetry.disconnect('a', 'backpressure');
  assert.equal(status().status, 'sending');
  assert.equal(status().slowDisconnects, 1);
  assert.equal(status().connectedListeners, 1);
});

test('stale IDs and oversized payloads cannot create false delivered bytes', () => {
  const { telemetry, status } = fixture();
  telemetry.connect('a');
  for (const [id, size] of [['wrong',50], ['a',0], ['a',-1], ['a',1.5], ['a',2*1024*1024]]) {
    assert.equal(telemetry.written(id,size),false);
  }
  assert.equal(status().chunksWritten,0);
  assert.equal(status().bytesWritten,0);
  telemetry.written('a', 100);
  telemetry.reset();
  assert.equal(status().status,'no_listeners');
  assert.equal(status().bytesWritten,0);
});

test('only trusted renderer audio chunks can be written and backpressure disconnects clients', () => {
  const main = fs.readFileSync(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  const preload = fs.readFileSync(path.join(__dirname,'..','electron','preload.cjs'),'utf8');
  const panel = fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
  const pack = fs.readFileSync(path.join(__dirname,'..','scripts','package-media-center.mjs'),'utf8');
  assert.match(main,/ipcMain\.handle\('radio:diagnostics'/);
  assert.match(main,/event\.sender !== mainWindow\.webContents/);
  assert.match(main,/response\.writableLength > 2 \* 1024 \* 1024/);
  assert.match(main,/radioTelemetry\.written\(listenerId, size\)/);
  assert.match(preload,/radioDiagnostics: \(\) => invoke\('radio:diagnostics'\)/);
  assert.match(panel,/BCN Signal Monitor/);
  assert.match(panel,/continuityArmed && signal\.status === 'stalled'/);
  assert.match(pack,/'radio-telemetry\.cjs'/);
});
