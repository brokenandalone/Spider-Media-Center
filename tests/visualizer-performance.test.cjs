'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PRESETS,THEMES,sanitize,AdaptiveGovernor,renderSize}=require('../dist/visualizer-performance.js');

test('quality, color and motion inputs are sanitized before saving',()=>{
  assert.deepEqual(sanitize({quality:'ultra',theme:'crimson',motion:'still',adaptive:false,showStats:true}),{
    quality:'ultra',theme:'crimson',motion:'still',adaptive:false,showStats:true
  });
  assert.equal(sanitize({quality:'infinite',theme:'javascript:',motion:'fast'}).quality,'balanced');
  assert.equal(sanitize({quality:'infinite',theme:'javascript:',motion:'fast'}).theme,'purple');
  assert.equal(sanitize({quality:'infinite',theme:'javascript:',motion:'fast'}).motion,'full');
  assert.equal(Object.keys(THEMES).length,5);
  assert.equal(Object.keys(PRESETS).length,3);
});

test('governor steps down only after sustained slow frame submissions',()=>{
  const governor=new AdaptiveGovernor();
  for(let i=0;i<24;i++)governor.record(34,30);
  assert.equal(governor.scale,0.88);
  for(let i=0;i<24*60;i++)governor.record(40,30);
  assert.ok(governor.scale>=0.48);
  assert.ok(governor.scale<=0.88);
  assert.ok(governor.adjustments>1);
});

test('governor recovers quality gradually and does not change when disabled',()=>{
  const governor=new AdaptiveGovernor();
  for(let i=0;i<24*12;i++)governor.record(36,30);
  const lower=governor.scale;
  assert.ok(lower<1);
  for(let i=0;i<24*80;i++)governor.record(1,30);
  assert.equal(governor.scale,1);
  for(let i=0;i<24*5;i++)governor.record(250,30,false);
  assert.equal(governor.scale,1);
});

test('invalid timings do not poison governor statistics',()=>{
  const governor=new AdaptiveGovernor();
  governor.record(NaN,30);
  governor.record(-10,30);
  governor.record(Infinity,30);
  governor.record(10,0);
  assert.equal(governor.snapshot().p75Ms,0);
  assert.equal(governor.snapshot().scale,1);
});

test('render dimensions stay bounded across high-DPI and invalid size inputs',()=>{
  const big=renderSize(3840,2160,4,'ultra',1);
  assert.ok(big.width*big.height<=1280*720);
  const small=renderSize(0,0,1,'eco',0.48);
  assert.ok(small.width>=2&&small.height>=2);
  const low=renderSize(800,450,1,'balanced',0.5);
  const high=renderSize(800,450,1,'balanced',1);
  assert.ok(low.width<high.width);
});
