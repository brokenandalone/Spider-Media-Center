'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {dedupe,bulkAdd,search,createShow,move,m3u,rundownText,BCN_ARTISTS,isBcnArtist}=require('../dist/playlist-workshop-core.js');
const songs=Array.from({length:120},(_,i)=>({id:'song-'+i,title:'BCN Track '+i,artist:'Band '+i%13,extension:'mp3',duration:220+i%15,url:'file:///media/track-'+i+'.mp3'}));
test('bulk playlist operation adds 120 tracks without duplicated additions',()=>{
  const p={id:1,name:'BCN',tracks:songs.slice(0,5)};
  const result=bulkAdd(p,[...songs,...songs.slice(0,20)]);
  assert.equal(result.tracks.length,120);
  assert.equal(p.tracks.length,5);
  assert.equal(dedupe(result.tracks).length,120);
});
test('library search and playlist reordering',()=>{
  assert.ok(search(songs,'band 7').length>0);
  assert.equal(search(songs,'not found').length,0);
  assert.deepEqual(move([1,2,3],0,2),[2,3,1]);
  assert.deepEqual(move([1,2,3],-1,2),[1,2,3]);
});
test('show generator produces deterministic, diverse music and planned Nova breaks',()=>{
  const o={name:'BCN Midnight',library:songs,durationMinutes:60,breakEvery:4,seed:'fixed'};
  const a=createShow(o),b=createShow(o);
  assert.ok(a.count>7&&a.count<19);
  assert.deepEqual(a.tracks.map(t=>t.url),b.tracks.map(t=>t.url));
  assert.equal(new Set(a.tracks.map(t=>t.url)).size,a.count);
  assert.ok(a.rundown.some(e=>e.type==='cue'&&/NOVA/.test(e.label)));
  assert.equal(a.rundown.filter(e=>e.type==='music').length,a.count);
  assert.ok(a.estimatedMinutes<=63);
  assert.match(rundownText(a),/NOVA DJ BREAK/);
});
test('videos and DJ cues never enter the player music list',()=>{
  const show=createShow({library:[...songs.slice(0,15),{title:'Film',url:'file:///film.mkv',extension:'mkv'}],durationMinutes:30});
  assert.ok(show.count>0);
  assert.equal(show.tracks.some(t=>/\.mkv$/.test(t.url)),false);
  assert.equal(show.tracks.some(t=>/NOVA/.test(t.title)),false);
});
test('short libraries emit a warning, optional repeats extend short sets',()=>{
  const short=createShow({library:songs.slice(0,2),durationMinutes:120});
  assert.equal(short.complete,false);
  assert.match(short.warning,/too small/);
  const long=createShow({library:songs.slice(0,2),durationMinutes:30,allowRepeats:true});
  assert.ok(long.count>2);
});
test('strict theme and M3U behavior',()=>{
  assert.equal(createShow({library:songs,theme:'does not exist',requireTheme:true}).count,0);
  const text=m3u(songs.slice(0,2));
  assert.match(text,/^#EXTM3U\n/);
  assert.match(text,/file:\/\/\/media\/track-0\.mp3/);
  assert.doesNotMatch(text,/NOVA DJ BREAK/);
});
test('workshop never autostarts broadcast or AI DJ',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','dist','playlist-workshop.js'),'utf8');
  assert.match(src,/enqueueMany\(tracks,false\)/);
  assert.match(src,/getRadioState\?\.\(\)\?\.active/);
  assert.doesNotMatch(src,/\b(startRadio|stopRadio|novaPrepare|startBroadcast)\s*\(/);
  assert.doesNotMatch(src,/\bdj\(\)\.(start|stop)\(/);
});
test('both UI entrypoints link core before controller and preserve visualizers',()=>{
  for(const filename of ['dist/index.html','electron/player.html']){
    const html=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
    assert.ok(html.indexOf('playlist-workshop-core.js')>0);
    assert.ok(html.indexOf('playlist-workshop.js')>html.indexOf('playlist-workshop-core.js'));
    assert.match(html,/visualizer-3d\.js/);
  }
});

test('BCN owns exactly four artists, including J-Cold, without a genre or outside-artist fallback',()=>{
  assert.deepEqual(BCN_ARTISTS,['Broken Sorrow','Therapy and Sonz','Justin Therapy','J-Cold']);
  for(const artist of BCN_ARTISTS)assert.equal(isBcnArtist(artist),true);
  assert.equal(isBcnArtist('j–cold'),true);
  assert.equal(isBcnArtist('J Cold'),true);
  assert.equal(isBcnArtist('J-Cold featuring Outside Artist'),false);
  assert.equal(isBcnArtist('Other Music'),false);
  const allowed=BCN_ARTISTS.flatMap((artist,index)=>Array.from({length:8},(_,i)=>({
    artist,title:artist+' #'+i,extension:'mp3',duration:210+i*3,url:'file:///approved-'+index+'-'+i+'.mp3'
  })));
  const mixed=[...allowed,...songs];
  const show=createShow({name:'BCN Approved',library:mixed,durationMinutes:60,seed:'artists-only',bcnOnly:true});
  assert.ok(show.tracks.length>5);
  assert.ok(show.tracks.some(t=>t.artist==='J-Cold'));
  assert.ok(show.tracks.every(t=>BCN_ARTISTS.includes(t.artist)));
  assert.ok(show.rundown.filter(t=>t.type==='music').every(t=>BCN_ARTISTS.includes(t.artist)));
  assert.equal(createShow({library:songs,bcnOnly:true}).count,0);
  assert.match(createShow({library:songs,bcnOnly:true}).warning,/J-Cold/);
  assert.ok(createShow({library:songs,bcnOnly:false}).count>0,'Private library rotation stays unrestricted');
});
test('temporary Unknown Artist allowance accepts blank metadata without admitting arbitrary named artists',()=>{
  // The native file importer records missing artist tags as an empty string.
  const untagged=[
    {title:'Imported untagged song',artist:'',url:'file:///media/no-tag.mp3',extension:'mp3',duration:200},
    {title:'Labelled unknown',artist:'Unknown Artist',url:'file:///media/unknown.mp3',extension:'mp3',duration:200},
    {title:'Mixed-case placeholder',artist:'  unknown  ARTIST ',url:'file:///media/unknown2.mp3',extension:'mp3',duration:200}
  ];
  const other={title:'Outside named artist',artist:'Another Band',url:'file:///media/other.mp3',extension:'mp3',duration:200};
  assert.equal(isBcnArtist(''),false,'missing artist defaults to strict unless explicitly allowed');
  assert.equal(isBcnArtist('Unknown Artist'),false,'literal placeholder defaults to strict');
  assert.equal(isBcnArtist('',{allowUnknown:true}),true);
  assert.equal(isBcnArtist('Unknown Artist',{allowUnknown:true}),true);
  assert.equal(isBcnArtist(' uNKNOWN ARTIST ',{allowUnknown:true}),true);
  assert.equal(isBcnArtist(null,{allowUnknown:true}),true);
  assert.equal(isBcnArtist('Another Band',{allowUnknown:true}),false);
  assert.equal(isBcnArtist('Unknown Artist featuring Other Band',{allowUnknown:true}),false);
  const temporary=createShow({name:'Untagged imports',library:[...untagged,other],
    durationMinutes:30,bcnOnly:true,allowUnknownBcn:true,seed:'untagged-test'});
  assert.equal(temporary.count,3);
  assert.ok(temporary.tracks.every(t=>t.artist===''||/unknown\s*artist/i.test(t.artist)));
  assert.equal(createShow({library:[...untagged,other],bcnOnly:true}).count,0);
  assert.equal(createShow({library:[...untagged,other],bcnOnly:true,allowUnknownBcn:false}).count,0);
});

test('BCN show UI activates four-artist filtering with explicit temporary unknown allowance',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','dist','playlist-workshop.js'),'utf8');
  assert.match(src,/library:tracks,bcnOnly:true,allowUnknownBcn:allowUnknown\(\)/);
  assert.match(src,/spider\.bcn\.allowUnknownArtist\.v1/);
  assert.match(src,/unknownToggle\.checked=allowUnknown\(\)/);
  for(const artist of BCN_ARTISTS)assert.ok(src.includes(artist));
});
