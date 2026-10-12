'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const compiled=read('dist/assets/index-Dt0TTW2G.js');

test('legacy AutoDJ cannot enqueue text-only station liners as blank songs',()=>{
  assert.match(compiled,/_selectHostItem\(\)\{\/\* Text-only interstitials/);
  assert.match(compiled,/if\(e&&e\.url\)try\{let n=\{/);
  assert.match(compiled,/_selectHostItem\(\)\{[^}]*return null\}/);
});

test('robotic legacy announcer is removed without disabling the native Nova DJ controller',()=>{
  assert.match(compiled,/async _announce\(e\)\{\/\* Legacy browser voice deliberately retired/);
  const start=compiled.indexOf('async _announce(e){');
  const end=compiled.indexOf('_selectTrackFromQueue(',start);
  assert.ok(start>0 && end>start);
  assert.doesNotMatch(compiled.slice(start,end),/speechSynthesis|synthesizeSpeech|SpeechSynthesisUtterance/);
  assert.match(compiled,/\/dj\/prepare/,'native DJ break path remains');
  assert.match(read('dist/media-center-upgrades.js'),/window\.spider\.novaPrepare\(request\)/);
});

test('legacy Show Generator navigation points to canonical Playlist Workshop',()=>{
  assert.match(compiled,/window\.SpiderPlaylistWorkshop\?\.open/);
  assert.match(compiled,/window\.SpiderPlaylistWorkshop\.open\(\)/);
  const workshop=read('dist/playlist-workshop.js');
  assert.match(workshop,/bcnRegisterProgram/);
  assert.match(workshop,/Save show to BCN Scheduler/);
  const ui=read('dist/media-center-upgrades.js');
  assert.match(ui,/snapshot\.programs/);
  assert.match(ui,/programId:selectedProgram\.value/);
  assert.match(ui,/spider:bcn-program-changed/);
});

test('legacy one-off timer inventory is visible and operator-only shutdown preserves its state',()=>{
  assert.match(compiled,/window\.__spiderLegacyOneOffScheduler=P/);
  const ui=read('dist/media-center-upgrades.js');
  assert.match(ui,/legacy\.stop\(\)/);
  assert.match(ui,/window\.confirm\('Stop OLD one-off AutoDJ schedule timers/);
  assert.match(ui,/Legacy AutoDJ Schedule \(separate, for review\)/);
  assert.doesNotMatch(ui,/localStorage\.removeItem\('spider\.scheduler\.shows'\)/);
});

test('paired installer pins the native neural-only Nova version and reports actual voice engine',()=>{
  const installer=read('scripts/install-v7-with-v6-nova.sh');
  assert.match(installer,/NOVA_OS_COMMIT='d66eeebc06a2d2546a7f906ab38311170b2bf736'/);
  const adapter=read('electron/nova-service.cjs');
  assert.match(adapter,/voiceEngine:/);
  assert.match(adapter,/robotVoiceAllowed:/);
  const ui=read('dist/media-center-upgrades.js');
  assert.match(ui,/spider:nova-voice-used/);
  assert.match(ui,/Last voice:/);
  assert.match(ui,/robotic fallback disabled/);
});
