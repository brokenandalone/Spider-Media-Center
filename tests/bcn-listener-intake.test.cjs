'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { BcnDesk } = require('../electron/bcn-desk.cjs');
const { BcnListenerIntake } = require('../electron/bcn-listener-intake.cjs');

async function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcn-intake-test-'));
  const desk = new BcnDesk({file:path.join(root,'desk.json')});
  const intake = new BcnListenerIntake({desk});
  const server = http.createServer((req,res) => {
    if (req.url === '/station/secret' && req.method === 'POST') {
      void intake.accept(req,res);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const submit = async (text, options={}) => {
    const payload = typeof options.rawBody === 'string' ? options.rawBody : JSON.stringify({text});
    const response = await fetch(base + (options.path || '/station/secret'), {
      method:'POST',
      headers: {'Content-Type':options.type || 'application/json', ...(options.headers || {})},
      body:payload
    });
    return {status:response.status, body:await response.json().catch(()=>({}))};
  };
  try {await callback({desk,intake,submit,base});}
  finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive:true,force:true});
  }
}

test('listener requests are closed by default, no public data or autoplay', async () => fixture(async ({desk,submit}) => {
  assert.equal(desk.state().listenerRequestsEnabled, false);
  assert.equal((await submit('Please play Broken Sorrow')).status,403);
  assert.equal(desk.state().requests.length,0);
  desk.setListenerRequestsEnabled(true);
  const result=await submit('Please play Broken Sorrow');
  assert.equal(result.status,202);
  assert.equal(result.body.ok,true);
  assert.equal(desk.state().requests[0].status,'pending');
  assert.equal(desk.state().requests[0].source,'listener');
  const second = new BcnDesk({file:desk.file});
  assert.equal(second.state().listenerRequestsEnabled,false,'public intake must not auto-enable after restart');
  assert.equal(second.state().requests[0].status,'pending');
}));

test('listener text cannot bypass approval', async () => fixture(async ({desk,submit}) => {
  desk.setListenerRequestsEnabled(true);
  await submit('A dedication for the midnight shift');
  assert.equal(desk.planBreak({type:'transition'}).payload.request.approved, false);
  const req=desk.state().requests[0];
  desk.reviewRequest(req.id,true);
  assert.equal(desk.planBreak({type:'transition'}).payload.request.approved,true);
  desk.reviewRequest(req.id,false);
  assert.equal(desk.planBreak({type:'transition'}).payload.request.approved,false);
}));

test('listener submission throttles per client', async () => fixture(async ({desk,submit}) => {
  desk.setListenerRequestsEnabled(true);
  assert.equal((await submit('Song request one')).status,202);
  assert.equal((await submit('Song request two')).status,202);
  assert.equal((await submit('Song request three')).status,202);
  assert.equal((await submit('Song request four')).status,429);
  assert.equal(desk.state().requests.length,3);
}));

test('public request endpoint rejects cross-site posts, media type and invalid JSON', async () => fixture(async ({desk,submit,base}) => {
  desk.setListenerRequestsEnabled(true);
  assert.equal((await submit('forged', {headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await submit('forged', {headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await submit('forged', {type:'text/plain'})).status,415);
  assert.equal((await submit(null,{rawBody:'{' })).status,400);
  assert.equal(desk.state().requests.length,0);
}));

test('listener request input size and content are bounded', async () => fixture(async ({desk,submit}) => {
  desk.setListenerRequestsEnabled(true);
  assert.equal((await submit('hi')).status,400);
  assert.equal((await submit('x'.repeat(181))).status,400);
  assert.equal((await submit('x'.repeat(180))).status,202);
  assert.equal(desk.state().requests[0].text.length,180);
}));

test('live radio page and operator control are integrated, no unauthenticated broadcast command', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  const panel=fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
  const preload=fs.readFileSync(path.join(__dirname,'..','electron','preload.cjs'),'utf8');
  assert.match(main,/radioRequestIntake\.accept\(request, response\)/);
  assert.match(main,/listenerRequestsEnabled: programmingDesk\(\)\.listenerRequestsEnabled/);
  assert.match(main,/trustedMediaSender\(event\)/);
  assert.match(main,/requestForm/);
  assert.match(panel,/Close listener submissions/);
  assert.match(preload,/bcnSetListenerIntake/);
});
