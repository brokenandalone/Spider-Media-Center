'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { nativeNova } = require('../electron/nova-service.cjs');

async function fixture(verify) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-dj-fixture-'));
  const cache = path.join(root, 'cache');
  fs.mkdirSync(cache);
  const valid = path.join(cache, 'nova.wav');
  const unsafe = path.join(root, 'outside.wav');
  fs.writeFileSync(valid, Buffer.from('RIFFwave-demo'));
  fs.writeFileSync(unsafe, Buffer.from('outside-cache'));
  let reference = pathToFileURL(valid).href;
  let incoming;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ ok: true, service: 'Spider AI DJ' }));
      return;
    }
    if (req.url !== '/dj/prepare') { res.writeHead(404); res.end('{}'); return; }
    const chunks = [];
    for await (const part of req) chunks.push(part);
    incoming = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.end(JSON.stringify({
      id: 'nova-test', script: 'Nova here on BCN', audioFile: reference,
      talkOver: { startSecondsBeforeEnd: 5, duckLevel: 0.25, crossfadeSeconds: 3 }
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const dj = nativeNova({ port: server.address().port, cacheDir: cache, timeoutMs: 3000 });
    await verify({ dj, root, cache, valid, unsafe, setReference: next => { reference = next; }, getIncoming: () => incoming });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('native Nova prepares an on-air break and embeds only local generated voice', async () => {
  await fixture(async ({ dj, getIncoming }) => {
    assert.deepEqual(await dj.health(), { ok: true, host: 'Nova', service: 'Spider AI DJ' });
    const ready = await dj.prepare({
      currentTrack: { title: 'First Song', artist: 'Broken Sorrow' },
      nextTrack: { title: 'Next Song', artist: 'Broken Sorrow' },
      secondsRemaining: 17
    });
    assert.equal(ready.script, 'Nova here on BCN');
    assert.match(ready.audioFile, /^data:audio\/wav;base64,/);
    assert.equal(Buffer.from(ready.audioFile.split(',')[1], 'base64').toString(), 'RIFFwave-demo');
    assert.equal(ready.talkOver.duckLevel, 0.25);
    const request = getIncoming();
    assert.equal(request.context.host, 'Nova');
    assert.equal(request.context.station, 'Broken City Network');
    assert.equal(request.secondsRemaining, 17);
    assert.equal(request.currentTrack.title, 'First Song');
  });
});

test('Nova IPC adapter blocks arbitrary files and cache-escaping symlinks', async () => {
  await fixture(async ({ dj, cache, unsafe, setReference }) => {
    setReference(pathToFileURL(unsafe).href);
    await assert.rejects(dj.prepare({ currentTrack: {}, nextTrack: {} }), /DJ cache/);
    const link = path.join(cache, 'linked.wav');
    fs.symlinkSync(unsafe, link);
    setReference(pathToFileURL(link).href);
    await assert.rejects(dj.prepare({ currentTrack: {}, nextTrack: {} }), /DJ cache/);
    setReference('https://example.com/voice.wav');
    await assert.rejects(dj.prepare({ currentTrack: {}, nextTrack: {} }), /local generated audio/);
  });
});

test('Nova IPC adapter rejects oversized generated audio files', async () => {
  await fixture(async ({ dj, cache, setReference }) => {
    const oversize = path.join(cache, 'too-big.mp3');
    fs.writeFileSync(oversize, Buffer.alloc(4 * 1024 * 1024 + 1));
    setReference(pathToFileURL(oversize).href);
    await assert.rejects(dj.prepare({ currentTrack: {}, nextTrack: {} }), /too large/);
  });
});

test('Nova shares the BCN audio graph, respects mute and avoids duplicate legacy DJ', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer.js'), 'utf8');
  const upgrades = fs.readFileSync(path.join(__dirname, '..', 'dist', 'media-center-upgrades.js'), 'utf8');
  const compiled = fs.readFileSync(path.join(__dirname, '..', 'dist', 'assets', 'index-Dt0TTW2G.js'), 'utf8');
  assert.match(renderer, /voiceGain\.connect\(state\.broadcastDestination\)/);
  assert.match(renderer, /voiceGain\.connect\(context\.destination\)/);
  assert.match(renderer, /state\.novaVoiceGain\.gain\.setTargetAtTime\(0/);
  assert.match(upgrades, /window\.spider\.novaPrepare\(request\)/);
  assert.match(compiled, /requestTimeoutMs:58e3/);
  assert.match(compiled, /prepareSeconds:90/);
  assert.match(compiled, /secondsRemaining:Math\.max\(0,Number\(e\.duration/);
  assert.doesNotMatch(upgrades, /Scan USB DJ|portableDjInfo/);
});


test('native Nova rotates a BCN station ID into every fourth prepared transition', async () => {
  await fixture(async ({ dj, getIncoming }) => {
    const standard = {
      currentTrack: { title: 'The River Remembers', artist: 'Broken Sorrow' },
      nextTrack: { title: 'Neon Graves', artist: 'Broken Sorrow' },
      context: { showName: 'BCN Nightwatch' }
    };
    for (let count = 1; count <= 5; count++) {
      const result = await dj.prepare(standard);
      const expected = count === 4 ? 'station_id' : 'transition';
      assert.equal(getIncoming().type, expected, 'break ' + count);
      assert.equal(result.type, expected);
      assert.equal(getIncoming().context.showName, 'BCN Nightwatch');
    }
  });
});

test('native Nova only receives explicitly approved listener requests', async () => {
  await fixture(async ({ dj, getIncoming }) => {
    await dj.prepare({ type: 'request', currentTrack: {}, nextTrack: {},
      request: { approvedRequest: 'Neon Graves for Sam', approved: false } });
    assert.equal(getIncoming().request.approved, false);
    assert.equal(getIncoming().request.approvedRequest, undefined);
    await dj.prepare({ type: 'request', currentTrack: {}, nextTrack: {},
      request: { approvedRequest: 'Neon Graves for Sam', approved: true } });
    assert.equal(getIncoming().type, 'request');
    assert.equal(getIncoming().request.approved, true);
    assert.equal(getIncoming().request.approvedRequest, 'Neon Graves for Sam');
  });
});
