'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BUILT_INS,MAX_CUSTOM,cleanPreset,readCustom,PresetBank,FrameHealth}=require('../dist/visualizer-presets.js');
test('eight bundled visualizer scenes are distinct and valid',()=>{
  assert.equal(BUILT_INS.length,8);
  assert.equal(new Set(BUILT_INS.map(x=>x.id)).size,8);
  for(const item of BUILT_INS)assert.deepEqual(cleanPreset(item,item.id),item);
});
test('scene preset bank is bounded, local and protects built-in scenes',()=>{
  const bank=new PresetBank();
  assert.equal(bank.delete('broken-city'),false);
  assert.equal(bank.find('broken-city').theme,'crimson');
  for(let i=0;i<MAX_CUSTOM;i++)assert.ok(bank.save({name:'TEST '+i,mode:'3d-tunnel',theme:'ice'}));
  assert.equal(bank.save({name:'OVERFLOW',mode:'3d-tunnel'}),null);
  assert.equal(bank.custom.length,12);
  const restored=new PresetBank(readCustom(bank.serialize()));
  assert.equal(restored.custom.length,12);
  assert.equal(restored.delete('user-nonexistent'),false);
  assert.equal(restored.delete(restored.custom[0].id),true);
  assert.equal(restored.custom.length,11);
});
test('scene import sanitizes unsafe text, unsupported modes and huge payloads',()=>{
  assert.equal(cleanPreset({name:'X',mode:'javascript:alert(1)'},'x'),null);
  const safe=cleanPreset({name:'<img onerror=alert(1)>',mode:'3d-orbit',quality:'unsafe',theme:'unsafe',motion:'unsafe'},'x');
  assert.equal(safe.name.includes('<'),false);
  assert.equal(safe.theme,'purple');
  assert.equal(safe.quality,'balanced');
  assert.equal(safe.motion,'full');
  assert.deepEqual(readCustom('{not json'),[]);
  assert.deepEqual(readCustom('x'.repeat(12001)),[]);
  assert.deepEqual(readCustom(JSON.stringify([{mode:'web'},{mode:'3d-spectrum'}])).length,1);
});
test('GPU frame health samples render FPS and counts failures without collecting media',()=>{
  const h=new FrameHealth();
  for(let i=1;i<=120;i++)h.tick(i*16,true);
  const report=h.snapshot();
  assert.ok(report.fps>40 && report.fps<80);
  assert.equal(report.frames,120);
  assert.equal(report.errors,0);
  assert.ok(report.maxGapMs<=16);
  h.failure();h.tick(3000,false);
  assert.equal(h.snapshot().errors,1);
  assert.equal(h.snapshot().frames,121);
  h.reset();
  assert.equal(h.snapshot().frames,0);
});
