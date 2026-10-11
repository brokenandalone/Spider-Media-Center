'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { closeRadioHttpServer } = require('../electron/radio-http-shutdown.cjs');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

test('idle BCN HTTP listener server closes without forcing any sockets', async () => {
  const server = http.createServer((_request, response) => response.end('ready'));
  await listen(server);
  const result = await closeRadioHttpServer(server, { graceMs: 40, timeoutMs: 500 });
  assert.deepEqual(result, { closed: true, forced: false });
  assert.equal(server.listening, false);
});

test('an open radio audio response cannot block broadcast Stop indefinitely', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mp4', 'Cache-Control': 'no-store' });
    response.write(Buffer.from('stream-start'));
    // Intentionally leave stream open just like a live mobile BCN listener.
  });
  const port = await listen(server);
  let response;
  try {
    await new Promise((resolve, reject) => {
      const request = http.get('http://127.0.0.1:' + port + '/stream/test', reply => {
        response = reply;
        reply.resume();
        resolve();
      });
      request.on('error', reject);
    });
    const result = await closeRadioHttpServer(server, { graceMs: 50, timeoutMs: 1000 });
    assert.deepEqual(result, { closed: true, forced: true });
    assert.equal(server.listening, false);
  } finally {
    response?.destroy();
    server.closeAllConnections?.();
  }
});

test('unresponsive closure produces a bounded failure rather than a hanging operation', async () => {
  const calls = [];
  const hung = {
    close(_callback) { calls.push('close'); },
    closeAllConnections() { calls.push('force'); }
  };
  await assert.rejects(
    closeRadioHttpServer(hung, { graceMs: 15, timeoutMs: 60 }),
    /shutdown deadline/
  );
  assert.equal(calls[0], 'close');
  assert.ok(calls.filter(value => value === 'force').length >= 1);
});

test('invalid shutdown deadlines fail fast and a missing server is already closed', async () => {
  assert.deepEqual(await closeRadioHttpServer(null), { closed: true, forced: false });
  await assert.rejects(closeRadioHttpServer({close(){}}, {graceMs:30,timeoutMs:30}), /deadlines/);
  await assert.rejects(closeRadioHttpServer({}), /HTTP server/);
});

test('new shutdown module is wired and packaged without changing the V6 installer pin', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const pack = fs.readFileSync(path.join(root, 'scripts', 'package-media-center.mjs'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-nova-bcn.sh'), 'utf8');
  assert.match(main, /await closeRadioHttpServer\(server\)/);
  assert.match(pack, /'radio-http-shutdown\.cjs'/);
  assert.match(installer, /SOURCE_COMMIT='c8f95f74ecc93eb858801eb2025af8f151e5116e'/);
  assert.match(installer, /CI_RUN_ID='38127241699'/);
});
