'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {audit,checkLocal}=require('../electron/music-library-audit.cjs');

test('native audit finds only broken local records and never touches real media',()=>{
  const existing=pathToFileURL('/home/spider/Music/album/song.mp3').href;
  const missing=pathToFileURL('/home/spider/Music/deleted.mp3').href;
  const touched=[];
  const stat=(filename)=>{
    touched.push(filename);
    if(filename.endsWith('deleted.mp3'))throw Object.assign(new Error('absent'),{code:'ENOENT'});
    return {isFile:()=>true,size:123456};
  };
  const rows=[
    {id:'valid',source:'local',url:existing},
    {id:'bad',source:'local',url:missing},
    {id:'empty',source:'local',url:''},
    {id:'stream',source:'network',url:'https://example.org/live'},
    {id:'playlist',source:'network',url:'https://example.org/music.mp3'}
  ];
  const output=audit(rows,stat);
  assert.equal(output.invalid.length,2);
  assert.deepEqual(output.invalid.map(x=>x.id),['bad','empty']);
  assert.equal(output.valid,1);
  assert.equal(output.skipped,2);
  assert.equal(touched.length,2);
});
test('audit avoids deleting inaccessible or temporarily unmounted audio',()=>{
  const pathUrl=pathToFileURL('/media/external/track.flac').href;
  assert.equal(checkLocal({url:pathUrl},()=>{throw Object.assign(new Error('denied'),{code:'EACCES'})}).status,'unknown');
  assert.equal(checkLocal({url:pathUrl},()=>({isFile:()=>true,size:0})).status,'invalid');
  assert.equal(checkLocal({url:'https://site.example/radio',source:'network'}).status,'skipped');
  assert.equal(checkLocal({url:'file:///not%2Fvalid.mp3'}).status,'invalid');
});
test('UI guards against live BCN and creates backup before mutating state',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'..','dist','playlist-workshop.js'),'utf8');
  const renderer=fs.readFileSync(path.join(__dirname,'..','electron','renderer.js'),'utf8');
  const main=fs.readFileSync(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  assert.match(ui,/scanInvalidMusic/);
  assert.match(ui,/backupStoredMedia/);
  assert.ok(ui.indexOf('await window.spider.backupStoredMedia')<ui.indexOf('bridge().removeInvalidStoredMedia'));
  assert.match(ui,/getRadioState\?\.\(\)\?\.active/);
  assert.match(renderer,/removeInvalidStoredMedia/);
  assert.match(main,/media:audit-stored/);
  assert.match(main,/media:backup-stored/);
  assert.doesNotMatch(main,/unlinkSync\(.*library-cleanup/);
});
test('Nova connects named voice selection to safe native profiles',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
  const adapter=fs.readFileSync(path.join(__dirname,'..','electron','nova-service.cjs'),'utf8');
  assert.match(ui,/spider\.nova\.voice\.profile\.v1/);
  assert.match(ui,/Matilda/);
  assert.match(ui,/Kirra/);
  assert.match(adapter,/\/dj\/voices/);
  assert.match(adapter,/voiceProfile/);
});
test('unscheduled AutoDJ cues approved four-artist music without creating persistent playlists',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'..','dist','media-center-upgrades.js'),'utf8');
  assert.match(ui,/function startCueAutoDJ/);
  assert.match(ui,/SpiderPlaylistWorkshopCore\?\.isBcnArtist/);
  assert.match(ui,/dj\.playlists\.push\(cue\)/);
  assert.match(ui,/dj\.start\(CUE_ID\)/);
  assert.doesNotMatch(ui,/dj\.savePlaylist\(cue\)/);
  assert.match(ui,/installCueClickHandler\(\)/);
  assert.match(ui,/isBcn\(t\.artist,\{allowUnknown:allowUnknownBcn\(\)\}\)/);
  assert.match(ui,/spider\.bcn\.allowUnknownArtist\.v1/);
  assert.match(ui,/bcnAllowUnknownArtist/);
});
