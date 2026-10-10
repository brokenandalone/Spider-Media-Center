const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../electron/renderer.js'),'utf8');
function extract(start,end) { return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))); }
test('saved link and QR never resurrect a stopped broadcast', () => {
  const context = vm.createContext({state:{radio:{active:false,publicUrl:'https://old.invalid',qrDataUrl:'data:image/png,old'}},currentItem:()=>null,Date});
  vm.runInContext(extract('function getRadioStateSnapshot()','function updateNowPlaying()'),context);
  const stopped = vm.runInContext('getRadioStateSnapshot()',context);
  assert.equal(stopped.active,false);assert.equal(stopped.connectionStatus,'offline');
  context.state.radio.active=true;
  assert.equal(vm.runInContext('getRadioStateSnapshot().active',context),true);
});
test('visualizer keeps scheduling after canvas unmount or unavailable context', () => {
  let canvas = null; const frames=[];
  const context=vm.createContext({state:{lightweightMode:false},lastVisualizerFrameAt:0,
    updateDjMicMeter(){},evaluateBroadcastRecovery(){},$:()=>canvas,
    requestAnimationFrame:fn=>frames.push(fn),window:{devicePixelRatio:1}});
  vm.runInContext(extract('function visualizerFrame(time)','function syncPartyState()'),context);
  vm.runInContext('visualizerFrame(100)',context);assert.equal(frames.length,1);
  canvas={getBoundingClientRect:()=>({width:100,height:100}),getContext:()=>null};
  vm.runInContext('visualizerFrame(200)',context);assert.equal(frames.length,2);
});

test('detached React decks are resolved again', () => {
  const old={isConnected:false};const replacement={isConnected:true};
  const context=vm.createContext({decks:[old,old],$:()=>replacement});
  vm.runInContext(extract('function resolveDecks()','function isReactOwned('),context);
  assert.equal(vm.runInContext('resolveDecks()[0]',context),replacement);
});
test('Play waits for the first queued movie to start', async () => {
  let finish;let started=false;
  const context=vm.createContext({state:{currentIndex:-1},indicesOfPlayable:()=>[0],playAt:()=>new Promise(resolve=>{finish=()=>{started=true;resolve(true)}})});
  vm.runInContext(extract('async function togglePlay()','function advance('),context);
  const pending=vm.runInContext('togglePlay()',context);
  assert.equal(started,false); finish(); assert.equal(await pending,true);
});
test('movie playback succeeds even when the optional mixer throws', async () => {
  const makeDeck=()=>({src:'',paused:true,dataset:{},classList:{add(){},toggle(){}},pause(){this.paused=true},async play(){this.paused=false}});
  const decks=[makeDeck(),makeDeck()];let visible=false;
  const state={queue:[{id:'movie',url:'file:///movie.mkv'}],currentIndex:-1,activeDeck:0,aiDj:{},crossfade:0};
  const context=vm.createContext({state,decks,playable:()=>true,resolveDecks(){},ensureAudioEngine(){throw new Error('optional mixer failed')},console:{warn(){}},activeMedia:()=>decks[state.activeDeck],prepareDeck:(deck,item)=>{deck.src=item.url},applyDeckVolume(){},syncMediaStageForItem(){visible=true},nextAIDJTrack(){},toAIDJTrack(){},emitPlayerEvent(){},updateNowPlaying(){},renderQueue(){},primeNextDeck(){},IS_REACT_UI:true,$:()=>null});
  vm.runInContext(extract('async function playAt(','async function togglePlay()'),context);
  assert.equal(await vm.runInContext('playAt(0)',context),true);
  assert.equal(decks[0].paused,false);assert.equal(state.currentIndex,0);assert.equal(visible,true);
});
test('a failed mixer can retry without attaching a second source to a deck', () => {
  let fail=true,sources=0;const decks=[{},{}];
  const node=()=>({connect(){},disconnect(){},gain:{},frequency:{},Q:{},threshold:{},knee:{},ratio:{},attack:{},release:{},frequencyBinCount:4});
  class AudioContext {
    constructor(){this.state='running';this.destination=node()}
    createMediaStreamDestination(){return node()}
    createMediaElementSource(){sources++;return node()}
    createBiquadFilter(){if(fail)throw new Error('unsupported filter');return node()}
    createChannelSplitter(){return node()}createChannelMerger(){return node()}
    createGain(){return node()}createStereoPanner(){return node()}
    createAnalyser(){return node()}createDynamicsCompressor(){return node()}
    async resume(){}
  }
  const state={audioContext:null,audioGraphs:[]};
  const context=vm.createContext({state,decks,deckSources:new WeakMap(),window:{AudioContext},resolveDecks(){},EQ_FREQUENCIES:[20],applySoundSettings(){},console:{warn(){}}});
  vm.runInContext(extract('function ensureAudioEngine()','function applySoundSettings()'),context);
  vm.runInContext('ensureAudioEngine()',context);assert.equal(state.audioGraphs.length,0);assert.equal(sources,1);
  fail=false;vm.runInContext('ensureAudioEngine()',context);assert.equal(state.audioGraphs.length,2);assert.equal(sources,2);
});
test('prepared movie replaces a failed source even when the queue ID is unchanged', () => {
  let loads=0;
  const deck={dataset:{endedBound:'1',itemId:'movie',itemUrl:'file:///original.mkv'},src:'file:///original.mkv',pause(){},removeAttribute(){this.src=''},load(){loads++}};
  const context=vm.createContext({deck});
  vm.runInContext(extract('function prepareDeck(','function normalizeDJAudioUrl('),context);
  vm.runInContext("prepareDeck(deck,{id:'movie',url:'file:///prepared.webm'})",context);
  assert.equal(deck.src,'file:///prepared.webm');assert.equal(loads,2);
  vm.runInContext("prepareDeck(deck,{id:'movie',url:'file:///prepared.webm'})",context);
  assert.equal(loads,2);
});
