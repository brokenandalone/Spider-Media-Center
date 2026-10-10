'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
const start=source.indexOf('    function disarmContinuity(reason) {');
const end=source.indexOf('\n\n    const novaStatus',start);
assert.ok(start>0 && end>start,'BCN session-only guard must be present');
const guard=source.slice(start,end);

function build(options={}) {
  const clock={now:1000};
  const rights={checked:true};
  const button={textContent:'Disarm continuity'};
  const status={textContent:''};
  const state={
    radio: options.radio !== false,
    autoDj: options.autoDj !== false,
    paused: options.paused !== false,
    fallback:options.fallback === undefined?3:options.fallback,
    pending:false,breakActive:false,
    calls:0
  };
  const bridge={
    getRadioState:()=>({active:state.radio}),
    getBroadcastRecoveryState:()=>({fallbackCount:state.fallback}),
    getAIDJSnapshot:()=>({current:{id:'track-1'},paused:state.paused}),
    getAIDJConfig:()=>({pendingBreak:state.pending,liveBreakActive:state.breakActive}),
    triggerBroadcastRecovery:()=>{state.calls++;return Boolean(options.recovers);}
  };
  const sandbox=vm.createContext({
    continuityRights:rights,continuityStatus:status,continuityButton:button,
    window:{__spiderPlayerBridge:bridge,__spiderAutoDJ:{isRunning:()=>state.autoDj}},
    Date:{now:()=>clock.now}
  });
  vm.runInContext('let continuityArmed=true,continuityPausedAt=0,continuityAttempts=0,continuityHealthyAt=0;\n'+guard,sandbox);
  const tick=()=>vm.runInContext('checkContinuity()',sandbox);
  return {tick,clock,rights,button,status,state,sandbox};
}

test('guard never starts broadcasts and disarms immediately when BCN goes off air',()=>{
  assert.doesNotMatch(guard,/\.startRadio\(|\.startBroadcast\(|startRadioServer\(/);
  const g=build({radio:false});
  g.tick();
  assert.match(g.status.textContent,/went off air/);
  assert.equal(g.button.textContent,'Arm continuity');
  assert.equal(g.state.calls,0);
});

test('guard only recovers after sustained paused playback and maxes out at three attempts',()=>{
  const g=build();
  g.tick();
  assert.equal(g.state.calls,0);
  g.clock.now=10000;g.tick();
  assert.equal(g.state.calls,0);
  for(let i=0;i<3;i++) {
    g.clock.now+=16000;
    g.tick();
  }
  assert.equal(g.state.calls,3);
  g.clock.now+=16000;g.tick();
  assert.equal(g.button.textContent,'Arm continuity');
  assert.match(g.status.textContent,/Three unsuccessful/);
  assert.equal(g.state.calls,3);
});

test('guard never interrupts live DJ breaks or manually disarmed AutoDJ',()=>{
  const g=build();
  g.state.pending=true;
  g.tick();
  g.clock.now+=20000;g.tick();
  assert.equal(g.state.calls,0);
  g.state.pending=false;g.state.autoDj=false;g.tick();
  assert.match(g.status.textContent,/AutoDJ was turned off/);
  assert.equal(g.state.calls,0);
});

test('guard requires ongoing rights and an adequate playable queue',()=>{
  const g=build();
  g.rights.checked=false;g.tick();
  assert.match(g.status.textContent,/rights confirmation/i);
  const other=build({fallback:1});
  other.tick();
  assert.match(other.status.textContent,/Too few playable tracks/);
  assert.equal(other.state.calls,0);
});
