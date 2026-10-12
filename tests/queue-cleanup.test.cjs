'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {clearUpcoming,clearAll,removeEmptyRows}=require('../dist/queue-cleanup-core.js');

const song=(id)=>({id,url:'file:///music/song-'+id+'.mp3',title:'Song '+id,artist:'Unknown Artist'});
const ghost={id:'old-ghost',url:'',title:'',artist:'Unknown Artist'};

test('Clear Up Next keeps the actual playing song and removes every other queue entry',()=>{
  const tracks=[song('old'),song('playing'),ghost,song('next'),song('later')];
  const result=clearUpcoming(tracks,1);
  assert.deepEqual(result.queue,[tracks[1]]);
  assert.equal(result.queue[0],tracks[1]);
  assert.equal(result.currentIndex,0);
  assert.equal(result.removed,4);
  assert.equal(result.keptCurrent,true);
  assert.equal(tracks.length,5,'original library records must not be mutated');
});
test('Clear Up Next when no song is active removes all upcoming rows',()=>{
  for(const idx of [-1,12,NaN]){
    const output=clearUpcoming([ghost,song('next')],idx);
    assert.equal(output.removed,2);
    assert.deepEqual(output.queue,[]);
    assert.equal(output.currentIndex,-1);
  }
});
test('Remove Blank Rows only purges records without audio URLs and keeps Unknown Artist songs',()=>{
  const rows=[ghost,song('playing'),{id:'missing-link',title:'Song with no link'},song('next')];
  const output=removeEmptyRows(rows,1);
  assert.deepEqual(output.queue,[rows[1],rows[3]]);
  assert.equal(output.currentIndex,0);
  assert.equal(output.removed,2);
  assert.equal(output.keptCurrent,true);
});
test('Clear All also removes current track from next playback list without deleting files',()=>{
  const items=[song(1),song(2)];
  const result=clearAll(items);
  assert.deepEqual(result.queue,[]);
  assert.equal(result.currentIndex,-1);
  assert.equal(result.removed,2);
  assert.equal(items.length,2);
});
test('both UI boot paths load queue planner before player/controls',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','dist/index.html'),'utf8');
  const legacy=fs.readFileSync(path.join(__dirname,'..','electron/player.html'),'utf8');
  assert.ok(html.indexOf('queue-cleanup-core.js')<html.indexOf('media-center-upgrades.js'));
  assert.ok(legacy.indexOf('queue-cleanup-core.js')<legacy.indexOf('renderer.js'));
});
test('renderer disarms AutoDJ, cancels prepared breaks and saves queue changes',()=>{
  const js=fs.readFileSync(path.join(__dirname,'..','electron/renderer.js'),'utf8');
  assert.match(js,/function clearStoredQueue\(/);
  assert.match(js,/window\.__spiderAutoDJ\?\.stop\?\.\(\)/);
  assert.match(js,/state\.aiDj\.pendingBreak = null/);
  assert.match(js,/state\.queue = \[\.\.\.plan\.queue\]/);
  assert.match(js,/state\.currentIndex = plan\.currentIndex/);
  assert.match(js,/state\.repeat = 'off'/);
  assert.match(js,/saveState\(\)/);
  assert.match(js,/emitPlayerEvent\('queueChanged', snapshot\)/);
  assert.match(js,/clearUpcomingQueue: \(\) => clearStoredQueue\('upcoming'\)/);
  assert.match(js,/clearQueue: \(\) => clearStoredQueue\('all'\)/);
  assert.match(js,/mode === 'all' && state\.radio\.active/);
});
test('queue controls are mounted outside the React-owned Up Next panel',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'..','dist/media-center-upgrades.js'),'utf8');
  assert.match(ui,/spiderQueueToolbar/);
  assert.match(ui,/document\.body\.append\(toolbar\)/);
  assert.match(ui,/Clear upcoming \(keep playing\)/);
  assert.match(ui,/REMOVE BLANK ROWS/);
  assert.match(ui,/ensureQueueControls\(\)/);
  assert.match(ui,/mode === 'all' && live/);
});
