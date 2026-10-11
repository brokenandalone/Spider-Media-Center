'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PublicRelayWatch, stateUrl } = require('../electron/radio-relay-probe.cjs');

const URL = 'https://bright-station-2026.trycloudflare.com/' + 'a'.repeat(40);
function reply(name='Broken City Network') {
  return { ok: true, headers:{ get: () => 'application/json; charset=utf-8' },
    json: async () => ({name,listenerCount:0,nowPlaying:null}) };
}
function fixture(fetcher) {
  let ms = Date.UTC(2026,9,10,20,0,0);
  let fired = null;
  const events = [];
  const monitor = new PublicRelayWatch({
    fetcher,clock:()=>ms,intervalMs:30_000,
    setInterval:callback=>{fired=callback;return 99;},
    clearInterval:()=>{fired=null;}
  });
  return { monitor, events, tick:()=>{ms+=30_000; return fired?.();} };
}

test('only station-owned HTTPS Quick Tunnel links are probed', () => {
  assert.equal(stateUrl(URL), URL.replace('.com/','.com/state/'));
  assert.throws(()=>stateUrl('https://evil.example/'+'a'.repeat(40)),/Unsupported/);
  assert.throws(()=>stateUrl('http://bright-station-2026.trycloudflare.com/'+'a'.repeat(40)),/Unsupported/);
  assert.throws(()=>stateUrl('https://bright-station-2026.trycloudflare.com@evil.example/'+'a'.repeat(40)),/Invalid/);
  assert.throws(()=>stateUrl(URL+'?token=leak'),/Invalid/);
  assert.throws(()=>stateUrl('https://bright-station-2026.trycloudflare.com/foo'),/Invalid/);
  assert.throws(()=>stateUrl('http://127.0.0.1:4567/'+'a'.repeat(40)),/Unsupported/);
  assert.match(stateUrl('http://127.0.0.1:4567/'+'a'.repeat(40),{allowLocal:true}), /\/state\//);
});

test('relay monitor confirms public reachability, not listener audio', async () => {
  const locations=[];
  const {monitor,events}=fixture(async (url,options)=>{
    locations.push({url,options});
    return reply();
  });
  await monitor.start(URL,'Broken City Network',s=>events.push(s));
  const state=monitor.snapshot();
  assert.equal(state.status,'reachable');
  assert.equal(state.reachability,'confirmed');
  assert.equal(state.consecutiveFailures,0);
  assert.equal(events.length,0);
  assert.equal(locations[0].url, URL.replace('.com/','.com/state/'));
  assert.equal(locations[0].options.redirect,'error');
  assert.equal(JSON.stringify(state).includes('trycloudflare'),false);
  assert.equal(JSON.stringify(state).includes('a'.repeat(40)),false);
  assert.match(state.note,/not proof/i);
  monitor.stop();
});

test('three consecutive failures mark a running tunnel as degraded without starting broadcasts', async () => {
  let allow=false;
  const {monitor,events}=fixture(async ()=>allow?reply():{ok:false,headers:{get:()=>''}});
  await monitor.start(URL,'Broken City Network',s=>events.push(s));
  assert.equal(monitor.snapshot().status,'checking');
  await monitor.check();
  assert.equal(monitor.snapshot().status,'checking');
  await monitor.check();
  assert.equal(monitor.snapshot().status,'degraded');
  assert.equal(events.length,1);
  assert.equal(events[0].status,'degraded');
  allow=true;
  await monitor.check();
  assert.equal(monitor.snapshot().status,'reachable');
  assert.equal(monitor.snapshot().consecutiveFailures,0);
  assert.equal(events.length,2);
  assert.equal(events[1].status,'reachable');
  monitor.stop();
  assert.equal(monitor.snapshot().status,'off_air');
});

test('incorrect station response, wrong content-type and malformed JSON do not count as healthy', async () => {
  let i=0;
  const results=[reply('Other Network'),
    {ok:true,headers:{get:()=> 'text/html'},json:async()=>({name:'Broken City Network',listenerCount:0,nowPlaying:null})},
    {ok:true,headers:{get:()=> 'application/json'},json:async()=>{throw Error('Malformed JSON')}}];
  const {monitor}=fixture(async()=>results[Math.min(i++,results.length-1)]);
  await monitor.start(URL,'Broken City Network',()=>{});
  await monitor.check();
  await monitor.check();
  assert.equal(monitor.snapshot().status,'degraded');
  monitor.stop();
});

test('late results from a previous live radio session cannot corrupt the new session', async () => {
  let resolveFetch;
  const {monitor}=fixture(()=>new Promise(resolve=>{resolveFetch=resolve;}));
  const first=monitor.start(URL,'Broken City Network',()=>{});
  monitor.stop();
  resolveFetch(reply());
  await first;
  assert.equal(monitor.snapshot().status,'off_air');
  assert.equal(monitor.snapshot().lastSuccessAt,null);
});

test('only one public fetch happens per interval, even when the first remains unresolved', async () => {
  let resolveFetch;
  let calls=0;
  const {monitor}=fixture(()=>{
    calls++;
    return new Promise(resolve=>{resolveFetch=resolve;});
  });
  const pending=monitor.start(URL,'Broken City Network',()=>{});
  await monitor.check();
  await monitor.check();
  assert.equal(calls,1);
  resolveFetch(reply());
  await pending;
  assert.equal(monitor.snapshot().status,'reachable');
  monitor.stop();
});

test('V6 bundles relay monitoring with the existing single DJ and radio diagnostics', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  const panel=fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
  const pack=fs.readFileSync(path.join(__dirname,'..','scripts','package-media-center.mjs'),'utf8');
  assert.match(main,/radioRelayWatch\.start/);
  assert.match(main,/radioRelayWatch\.stop\(\)/);
  assert.match(main,/publicRelay: radioRelayWatch\.snapshot\(\)/);
  assert.match(panel,/Public station page is reachable/);
  assert.match(panel,/Public station could not be reached/);
  assert.doesNotMatch(main,/radioRelayWatch\.on.*startRadioServer/);
  assert.match(pack,/'radio-relay-probe\.cjs'/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8')).version, '6.0.0');
  const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package-lock.json'),'utf8'));
  assert.equal(lock.version,'6.0.0');
  assert.equal(lock.packages[''].version,'6.0.0');
});
