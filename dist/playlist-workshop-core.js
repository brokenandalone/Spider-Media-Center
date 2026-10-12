/* BCN Playlist Workshop: pure, browser/Node-compatible playlist and show-planning logic. */
(function (root, build) {
  const api = build();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpiderPlaylistWorkshopCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const AUDIO = new Set(['mp3','flac','m4a','aac','wav','aiff','ogg','opus','wma']);
  const VIDEO = new Set(['mp4','m4v','avi','mkv','mov','mpeg','mpg','wmv','webm']);
  const key = t => t ? String(t.url || t.originalUrl || ('id:' + (t.id || ''))).trim() : '';
  function normalize(item) {
    if (!item || typeof item !== 'object' || !String(item.url || '').trim()) return null;
    const url = String(item.url).trim();
    return { ...item, id:item.id || 'pw-' + key(item), title:String(item.title || item.name || 'Untitled'),
      artist:String(item.artist || ''), album:String(item.album || ''), url,
      source:item.source || 'local', extension:String(item.extension || url.split(/[?#]/)[0].split('.').pop() || '').replace(/^\./,'').toLowerCase(),
      weight:Number(item.weight)>0 ? Number(item.weight) : 1, kind:item.kind || 'music' };
  }
  function isAudio(t) {
    const ext = String(t?.extension || t?.url?.split(/[?#]/)[0].split('.').pop() || '').replace(/^\./,'').toLowerCase();
    return AUDIO.has(ext) || (!VIDEO.has(ext) && ['local','network','guest'].includes(String(t?.source || 'local')));
  }
  function dedupe(items) {
    const seen=new Set(), out=[];
    for (const item of Array.isArray(items)?items:[]) {
      const t=normalize(item); if(!t || seen.has(key(t)))continue;
      seen.add(key(t));out.push(t);
    }
    return out;
  }
  function search(items,query) {
    const terms=String(query||'').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return dedupe(items).filter(t=>terms.every(q=>(t.title+' '+t.artist+' '+t.album+' '+t.url).toLocaleLowerCase().includes(q)));
  }
  const bulkAdd=(playlist,additions)=>({ ...playlist, tracks:dedupe([...(playlist?.tracks||[]),...(additions||[])]) });
  function move(tracks,from,to) {
    const out=[...tracks]; if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=out.length||to>=out.length)return out;
    out.splice(to,0,out.splice(from,1)[0]);return out;
  }
  function rng(seed) {
    let n=2166136261;
    for(const c of String(seed))n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;
    return ()=>{n+=0x6D2B79F5;let z=n;z=Math.imul(z^z>>>15,z|1);z^=z+Math.imul(z^z>>>7,z|61);return ((z^z>>>14)>>>0)/4294967296;};
  }
  function shuffle(items,random) {
    const a=[...items];
    for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
    return a;
  }
  function durationMinutes(track,average) {
    const n=Number(track?.duration||track?.durationSeconds||0);
    return Number.isFinite(n)&&n>15&&n<43200?n/60:average;
  }
  function createShow(o={}) {
    const target=Math.min(360,Math.max(15,Math.round(Number(o.durationMinutes)||60)));
    const average=Math.min(12,Math.max(1.5,Number(o.averageTrackMinutes)||3.7));
    const gap=Math.min(20,Math.max(2,Math.floor(Number(o.breakEvery)||5)));
    const breakMinutes=Math.min(4,Math.max(0,Number(o.breakMinutes)||1));
    const name=String(o.name||'BCN Radio Show').trim().slice(0,90)||'BCN Radio Show';
    const random=rng(o.seed===undefined?name+'|'+target+'|'+(o.theme||''):o.seed);
    const source=dedupe(o.library).filter(isAudio), filtered=search(source,o.theme||'');
    const pool=filtered.length?filtered:(o.requireTheme?[]:source);
    const ordered=shuffle(pool,random),tracks=[],rundown=[],recent=[];
    let music=0,talk=0,countSinceBreak=0,remaining=[...ordered];
    if(o.includeIntro!==false)rundown.push({type:'cue',label:'SHOW OPEN / station ID',atMinute:0});
    for(let i=0;i<200&&remaining.length;i++) {
      const alternatives=remaining.filter(t=>t.artist&&!recent.includes(t.artist.toLowerCase()));
      const choices=alternatives.length?alternatives:remaining;
      const t=choices[Math.floor(random()*choices.length)];
      const minutes=durationMinutes(t,average);
      const nextBreak=countSinceBreak+1>=gap?breakMinutes:0;
      if(tracks.length&&music+talk+minutes+nextBreak>target+average/2)break;
      tracks.push(t);
      rundown.push({type:'music',title:t.title,artist:t.artist,url:t.url,atMinute:Number((music+talk).toFixed(2)),estimatedMinutes:Number(minutes.toFixed(2))});
      music+=minutes;countSinceBreak++;recent.push(t.artist.toLowerCase());if(recent.length>2)recent.shift();
      remaining.splice(remaining.findIndex(x=>key(x)===key(t)),1);
      if(o.allowRepeats===true&&!remaining.length)remaining=shuffle(ordered,random);
      if(countSinceBreak>=gap&&music+talk+breakMinutes<target) {
        rundown.push({type:'cue',label:'NOVA DJ BREAK / station ID (planned, not rendered)',atMinute:Number((music+talk).toFixed(2)),estimatedMinutes:breakMinutes});
        talk+=breakMinutes;countSinceBreak=0;
      }
    }
    const estimatedMinutes=Number((music+talk).toFixed(1));
    if(tracks.length&&o.includeOutro!==false)rundown.push({type:'cue',label:'SHOW CLOSE / next program tease',atMinute:estimatedMinutes});
    const warning=!pool.length?'No matching playable audio in the library.':!tracks.length?'No tracks fit the requested show duration.':
      estimatedMinutes<target-average*1.5?'The music library is too small to fill this show without additional tracks or repeats.':'';
    return {name,durationMinutes:target,estimatedMinutes,count:tracks.length,tracks,rundown,
      complete:estimatedMinutes>=target-average*1.5,warning,
      assumptions:'Unknown track lengths are estimated at '+average+' minutes; DJ breaks are planned cues, not synthesized audio.'};
  }
  function m3u(tracks) {
    return '#EXTM3U\n'+dedupe(tracks).map(t=>'#EXTINF:'+(Number(t.duration)>0?Math.round(Number(t.duration)):-1)+','+
      ((t.artist?t.artist+' - ':'')+t.title).replace(/[\r\n]/g,' ')+'\n'+t.url).join('\n')+'\n';
  }
  function rundownText(show) {
    const lines=[show.name+' | Target '+show.durationMinutes+' min | Estimated '+show.estimatedMinutes+' min',''];
    for(const t of show.rundown||[])lines.push(String(Math.floor(t.atMinute/60)).padStart(2,'0')+':'+String(Math.floor(t.atMinute%60)).padStart(2,'0')+
      '  '+(t.type==='cue'?'[CUE] '+t.label:(t.artist?t.artist+' - ':'')+t.title));
    lines.push('',show.assumptions||'');if(show.warning)lines.push('WARNING: '+show.warning);
    return lines.join('\n')+'\n';
  }
  return Object.freeze({key,normalize,isAudio,dedupe,search,bulkAdd,move,createShow,m3u,rundownText});
});
