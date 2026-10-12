/* Spider Media Center Playlist Workshop. Extends existing React/legacy player non-invasively. */
(() => {
 'use strict';
 const Core=window.SpiderPlaylistWorkshopCore;
 if(!Core)return;
 const STORE='spider.playlist.workshop.shows.v1';
 const UNKNOWN_STORE='spider.bcn.allowUnknownArtist.v1';
 // Default on for the owner's currently untagged collection. Turning it off
 // restores the strict four-artist filter without changing any media tags.
 const allowUnknown=()=>{try{return localStorage.getItem(UNKNOWN_STORE)!=='off';}catch{return true;}};
 const setAllowUnknown=value=>{
   try{localStorage.setItem(UNKNOWN_STORE,value?'on':'off');}catch{}
   window.dispatchEvent(new Event('spider:bcn-unknown-change'));
 };
 const state={chosen:new Set(),filter:'',playlistId:'',page:0,draft:null};
 const $=id=>document.getElementById(id);
 const bridge=()=>window.__spiderPlayerBridge||window.__spiderPlayerEngine;
 const dj=()=>window.__spiderAutoDJ;
 const dom=(tag,cls,text)=>{
   const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;
 };
 const btn=(label,action,cls='')=>{
   const el=dom('button','pw-button '+cls,label);el.type='button';el.addEventListener('click',action);return el;
 };
 const input=(type,value='')=>{const el=document.createElement('input');el.type=type;el.value=value;return el;};
 const field=(text,control)=>{const l=dom('label','pw-field');l.append(dom('span','',text),control);return l;};
 const row=(...els)=>{const d=dom('div','pw-actions');d.append(...els);return d;};
 function notify(message,error=false){const el=$('pw-status');if(el){el.textContent=message;el.dataset.error=String(error);}}
 function ready(){
   if(!dj()?.createPlaylist||!dj()?.savePlaylist||!bridge()?.getLibrarySnapshot)throw Error('AutoDJ or media library is loading. Reopen the workshop once the player has started.');
   return {dj:dj(),bridge:bridge()};
 }
 function library(){
   return Core.dedupe([...(bridge()?.getLibrarySnapshot?.()?.library||[]),...(bridge()?.getQueueSnapshot?.()?.queue||[])]);
 }
 function playlists(){return dj()?.listPlaylists?.()||[];}
 function active(){return playlists().find(p=>String(p.id)===String(state.playlistId))||null;}
 function savedShows(){try{const v=JSON.parse(localStorage.getItem(STORE)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}}
 function saveShow(id,show){const all=savedShows();all[id]={...show,savedAt:new Date().toISOString()};localStorage.setItem(STORE,JSON.stringify(all));}
 function download(content,filename,type='text/plain;charset=utf-8'){
   const url=URL.createObjectURL(new Blob([content],{type}));
   const a=dom('a');a.href=url;a.download=filename.replace(/[^\w .-]/g,'_');document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function refreshPlaylists(){
   const select=$('pw-playlists');if(!select)return;
   select.replaceChildren(new Option('Choose a saved playlist',''));
   for(const p of playlists())select.add(new Option(p.name+' ('+(p.tracks||[]).length+')',String(p.id)));
   if(playlists().some(p=>String(p.id)===String(state.playlistId)))select.value=String(state.playlistId);
   else {state.playlistId='';select.value='';}
   renderTracks();
 }
 function create(name){
   const p=ready().dj.createPlaylist(String(name||'').trim()||'New BCN Playlist');
   state.playlistId=String(p.id);refreshPlaylists();return p;
 }
 function renderLibrary(){
   const box=$('pw-library');if(!box)return;
   const items=Core.search(library(),state.filter), pageItems=items.slice(state.page*250,(state.page+1)*250);
   box.replaceChildren();
   if(!items.length)box.append(dom('p','pw-muted','No matches. Import a music folder into the main Media Center first.'));
   for(const t of pageItems){
     const line=dom('label','pw-track-row'),check=input('checkbox');
     check.checked=state.chosen.has(Core.key(t));
     check.addEventListener('change',()=>{check.checked?state.chosen.add(Core.key(t)):state.chosen.delete(Core.key(t));renderCounts();});
     const desc=dom('span','pw-track-copy');
     desc.append(dom('strong','',t.title),dom('small','',t.artist+' · '+(t.album||t.extension||'audio')));
     line.append(check,desc);box.append(line);
   }
   $('pw-page').textContent=(items.length?state.page+1:0)+' / '+Math.max(1,Math.ceil(items.length/250))+' pages';
   $('pw-prev').disabled=state.page===0;
   $('pw-next').disabled=(state.page+1)*250>=items.length;
   renderCounts();
 }
 function renderCounts(){
   if($('pw-library-count'))$('pw-library-count').textContent=library().length+' library / queue items · '+state.chosen.size+' selected';
 }
 function renderTracks(){
   const box=$('pw-tracks');if(!box)return;
   box.replaceChildren();const p=active(),tracks=p?.tracks||[];
   $('pw-playlist-count').textContent=p?tracks.length+' tracks':'No playlist selected';
   if(!p){box.append(dom('p','pw-muted','Create or choose a playlist.'));return;}
   if(!tracks.length){box.append(dom('p','pw-muted','Select multiple songs on the left, then add them all.'));return;}
   for(let i=0;i<Math.min(tracks.length,400);i++){
     const t=tracks[i],line=dom('div','pw-saved-row'),description=dom('span','pw-track-copy');
     description.append(dom('strong','',(i+1)+'. '+(t.title||'Untitled')),dom('small','',t.artist||'Unknown artist'));
     const controls=dom('div','pw-tiny-actions');
     const up=btn('↑',()=>{dj().savePlaylist({...p,tracks:Core.move(tracks,i,i-1)});refreshPlaylists();});
     const down=btn('↓',()=>{dj().savePlaylist({...p,tracks:Core.move(tracks,i,i+1)});refreshPlaylists();});
     up.disabled=i===0;down.disabled=i===tracks.length-1;
     controls.append(up,down,btn('×',()=>{dj().savePlaylist({...p,tracks:tracks.filter((_,n)=>n!==i)});refreshPlaylists();}));
     line.append(description,controls);box.append(line);
   }
   if(tracks.length>400)box.append(dom('p','pw-muted','Showing first 400 tracks. Exports include every track.'));
 }
 function addSelected(){
   const p=active();if(!p)return notify('Create or select a playlist first.',true);
   const tracks=library().filter(t=>state.chosen.has(Core.key(t)));
   if(!tracks.length)return notify('Select some music first.',true);
   const result=Core.bulkAdd(p,tracks);
   dj().savePlaylist(result);refreshPlaylists();
   notify('Added '+(result.tracks.length-(p.tracks||[]).length)+' new tracks to '+p.name+' in one click.');
 }
 async function queue(items,replace=false){
   const player=ready().bridge,tracks=Core.dedupe(items).filter(t=>t.url);
   if(!tracks.length)return notify('This playlist has no playable tracks.',true);
   if(replace){
     if(player.getRadioState?.()?.active)return notify('BCN is ON AIR. Queue replacement is blocked. Use Append instead.',true);
     if(!window.confirm('Replace the playing queue with '+tracks.length+' tracks? Current playback will stop.'))return;
     await player.clearQueue();
   }
   await player.enqueueMany(tracks,false);
   notify(tracks.length+' songs '+(replace?'loaded into':'appended to')+' the queue. Playback was not started.');
 }
 function exportCurrent(which){
   const p=active();if(!p)return notify('Select a playlist first.',true);
   if(which==='json')download(JSON.stringify({format:'spider-playlist-v1',name:p.name,tracks:Core.dedupe(p.tracks),show:savedShows()[p.id]||null},null,2),p.name+'.spider-playlist.json','application/json');
   else if(which==='m3u')download(Core.m3u(p.tracks),p.name+'.m3u','audio/x-mpegurl');
   else{const show=savedShows()[p.id];if(!show)return notify('No saved show rundown for this playlist.',true);download(Core.rundownText(show),p.name+'-rundown.txt');}
   notify('Exported '+which.toUpperCase()+' for '+p.name+'.');
 }
 async function importPlaylist(file){
   if(!file||file.size>2000000)throw Error('Import a Spider Playlist JSON file smaller than 2 MB.');
   const object=JSON.parse(await file.text());
   if(object.format!=='spider-playlist-v1'||!Array.isArray(object.tracks))throw Error('Unsupported playlist file. Use a Workshop JSON export.');
   const tracks=Core.dedupe(object.tracks).slice(0,5000);
   if(!tracks.length)throw Error('Playlist contains no playable track URLs.');
   const p=create(String(object.name||file.name).slice(0,90));
   dj().savePlaylist({...p,tracks});
   if(object.show&&Array.isArray(object.show.rundown))saveShow(p.id,{...object.show,tracks});
   refreshPlaylists();notify('Imported '+tracks.length+' tracks into '+p.name+'.');
 }
 function generate(){
   const mode=$('pw-source').value,all=library();
   const tracks=mode==='selection'?all.filter(t=>state.chosen.has(Core.key(t))):mode==='playlist'?(active()?.tracks||[]):all;
   const result=Core.createShow({
     name:$('pw-show-name').value,durationMinutes:Number($('pw-length').value),
     averageTrackMinutes:Number($('pw-average').value),breakEvery:Number($('pw-breaks').value),
     theme:$('pw-theme').value,requireTheme:$('pw-strict').checked,
     allowRepeats:$('pw-repeat').checked,seed:$('pw-show-name').value+':'+$('pw-seed').value,library:tracks,bcnOnly:true,allowUnknownBcn:allowUnknown()
   });
   state.draft=result;
   const box=$('pw-rundown');box.replaceChildren();
   box.append(dom('p','pw-muted',result.count+' songs, estimated '+result.estimatedMinutes+'/'+result.durationMinutes+' minutes. '+result.assumptions));
   if(result.warning)box.append(dom('p','pw-warning',result.warning));
   for(const entry of result.rundown.slice(0,140))
     box.append(dom('div','pw-rundown-row',(entry.type==='cue'?'◆ ':'♪ ')+Number(entry.atMinute).toFixed(1)+'m · '+(entry.label||(entry.artist?entry.artist+' - ':'')+entry.title)));
   $('pw-save-show').disabled=!result.tracks.length;
   notify(result.count?'Generated rundown. Save it to create a real AutoDJ playlist.':result.warning,!result.count);
 }
 async function saveGenerated(){
   const result=state.draft;if(!result?.tracks.length)return notify('Generate a show with music first.',true);
   if(typeof window.spider?.bcnRegisterProgram!=='function')throw Error('Native BCN programming desk is unavailable. Your show was not saved. Install the programming integration first.');
   const p=create(result.name);
   dj().savePlaylist({...p,tracks:result.tracks.map(t=>({...t,weight:1,kind:'music'}))});
   saveShow(p.id,result);refreshPlaylists();
   try {
     await window.spider.bcnRegisterProgram({
       name:result.name,playlistId:String(p.id),durationMinutes:result.durationMinutes,
       trackCount:result.tracks.length,tone:'natural'
     });
     window.dispatchEvent(new Event('spider:bcn-program-changed'));
     notify('Saved '+result.name+' to AutoDJ and BCN Media > Show Scheduler. Choose a day and time in BCN Media to schedule the show. No broadcast was started.');
   } catch(error) {
     notify('The playlist was saved, but BCN registration failed: '+(error?.message||String(error))+'. Open BCN Media to check, then retry.',true);
   }
 }

 async function scanInvalidMusic(){
   ready();
   if(bridge()?.getRadioState?.()?.active)throw Error('Stop BCN broadcasting before cleaning stored media.');
   const indexed=bridge().getLibrarySnapshot?.()?.library||[];
   const queueItems=bridge().getQueueSnapshot?.()?.queue||[];
   const saved=playlists();
   const combined=[...indexed,...queueItems,...saved.flatMap(p=>p.tracks||[])];
   const report=await window.spider.auditStoredMedia(combined);
   state.audit={report,combined,indexed,queueItems,saved};
   const status=$('pw-audit-status'),list=$('pw-audit-preview');
   list.replaceChildren();
   status.textContent=report.invalid.length+' invalid stored references; '+report.valid+' valid, '+report.unknown+' unverifiable, '+report.skipped+' streams/network items not checked. Missing files on disconnected drives may be restored by reconnecting them.';
   for(const item of report.invalid.slice(0,80)){
     const track=combined[item.index];
     list.append(dom('div','pw-rundown-row',(track?.artist?track.artist+' / ':'')+(track?.title||track?.url||'Unnamed')+' · '+item.reason));
   }
   if(report.invalid.length>80)list.append(dom('small','pw-muted','Showing first 80 broken references. All '+report.invalid.length+' are included in cleanup.'));
   $('pw-remove-invalid').disabled=!report.invalid.length;
   notify('Audit finished. Review invalid entries before clearing stored records.');
 }
 async function removeInvalidMusic(){
   const snapshot=state.audit;
   if(!snapshot?.report.invalid.length)throw Error('Run Scan invalid entries first.');
   if(dj()?.isRunning?.())throw Error('Stop AutoDJ before clearing stored entries.');
   if(bridge()?.getRadioState?.()?.active)throw Error('Stop BCN broadcasting before clearing stored entries.');
   const before=bridge().getLibrarySnapshot?.()?.library||[];
   const currentQueue=bridge().getQueueSnapshot?.()?.queue||[];
   const currentSaved=playlists();
   const combined=[...before,...currentQueue,...currentSaved.flatMap(p=>p.tracks||[])];
   // Do not act on a stale preview after the library or playlists have changed.
   if(combined.length!==snapshot.combined.length ||
      combined.some((track,i)=>String(track?.url||'')!==String(snapshot.combined[i]?.url||'')))
     throw Error('Your library or playlists changed. Scan again before clearing.');
   const fresh=await window.spider.auditStoredMedia(combined);
   const prior=snapshot.report.invalid.map(x=>x.index).join(',');
   if(fresh.invalid.map(x=>x.index).join(',')!==prior)
     throw Error('File availability changed. Scan again before clearing.');
   const count=fresh.invalid.length;
   const cleanPlaylists=$('pw-clean-playlists').checked;
   if(!window.confirm('Remove '+count+' broken saved references from the indexed library and queue'+
      (cleanPlaylists?' AND remove broken song entries from AutoDJ playlists':'')+
      '? This does NOT delete any audio files. A recovery backup is created first.'))return;
   const rawState=localStorage.getItem('spider-player-state-v2');
   const backup=await window.spider.backupStoredMedia({
     library:before,queue:currentQueue,playlists:currentSaved,
     showRundowns:savedShows(),rawState
   });
   if(!backup?.ok||!backup.backupFile)throw Error('Backup failed. Nothing was removed.');
   // All entries have been verified by the native filesystem audit.
   const invalidKeys=new Set(fresh.invalid.map(entry=>{
     const track=combined[entry.index];return String(track?.url||'').trim()
       ? 'url:'+String(track.url).trim():'id:'+String(track?.id||'');
   }));
   const isInvalid=track=>invalidKeys.has(track?.url?'url:'+String(track.url).trim():'id:'+String(track?.id||''));
   const records=fresh.invalid.map(entry=>combined[entry.index]);
   if(cleanPlaylists){
     for(const p of currentSaved){
       const good=(p.tracks||[]).filter(t=>!isInvalid(t));
       if(good.length!==(p.tracks||[]).length){
         dj().savePlaylist({...p,tracks:good});
         const shows=savedShows();
         if(shows[String(p.id)]){
           const show=shows[String(p.id)];
           saveShow(p.id,{...show,tracks:good,
             rundown:(show.rundown||[]).filter(line=>line.type!=='music'||!isInvalid(line)),
             count:good.length,complete:false,
             warning:'Music entries changed. Regenerate this show for accurate timings.'});
         }
       }
     }
   }
   bridge().removeInvalidStoredMedia(records);
   state.audit=null;state.chosen.clear();
   $('pw-audit-preview').replaceChildren();
   $('pw-remove-invalid').disabled=true;
   $('pw-audit-status').textContent=count+' broken stored references cleared. Recovery backup: '+backup.backupFile+
       '. Audio files were not deleted. Unverifiable/network items were untouched.';
   refreshPlaylists();renderLibrary();
   notify('Invalid music references cleared. Recovery backup saved before any changes.');
 }
 function startup(){
   if($('pw-launcher'))return;
   const panel=dom('section','pw-panel');panel.id='pw-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Playlist Workshop');
   const launch=btn('☷ PLAYLIST WORKSHOP',()=>{
     panel.hidden=false;
     if($('pw-allow-unknown'))$('pw-allow-unknown').checked=allowUnknown();
     try{ready();refreshPlaylists();renderLibrary();notify('Select music in bulk or generate a BCN show. Live radio and Nova stay untouched.');}
     catch(e){notify(e.message,true);}
   },'pw-launcher');launch.id='pw-launcher';
   const head=dom('div','pw-header'),name=dom('div');
   name.append(dom('small','pw-overline','SPIDER MEDIA CENTER · BCN BROADCAST'),dom('h2','','Playlist Workshop'));
   head.append(name,btn('✕ Close',()=>panel.hidden=true,'pw-close'));
   const info=dom('p','pw-status','Choose music.');info.id='pw-status';info.setAttribute('role','status');
   panel.append(head,info);
   const grid=dom('div','pw-grid'),left=dom('section','pw-card'),right=dom('section','pw-card');
   left.append(dom('h3','','1. Select hundreds of tracks'));
   const find=input('search');find.placeholder='Search titles, artist, album or file path';
   find.addEventListener('input',()=>{state.filter=find.value;state.page=0;renderLibrary();});
   const selectedCount=dom('small','pw-muted');selectedCount.id='pw-library-count';
   const browse=dom('div','pw-scroll');browse.id='pw-library';
   const page=dom('div','pw-pages'),prev=btn('Previous',()=>{state.page--;renderLibrary();}),next=btn('Next',()=>{state.page++;renderLibrary();});
   prev.id='pw-prev';next.id='pw-next';const pages=dom('small','pw-muted');pages.id='pw-page';page.append(prev,pages,next);
   left.append(find,row(
     btn('Select all matches',()=>{Core.search(library(),state.filter).forEach(t=>state.chosen.add(Core.key(t)));renderLibrary();}),
     btn('Clear selection',()=>{state.chosen.clear();renderLibrary();}),
     btn('Add selected to playlist',addSelected,'pw-emphasis')
   ),selectedCount,browse,page);
   right.append(dom('h3','','2. Saved AutoDJ playlists'));
   const select=document.createElement('select');select.id='pw-playlists';
   select.addEventListener('change',()=>{state.playlistId=select.value;renderTracks();});
   const title=input('text');title.placeholder='Name a playlist';title.maxLength=90;
   const amount=dom('small','pw-muted');amount.id='pw-playlist-count';
   const tracks=dom('div','pw-scroll pw-saved');tracks.id='pw-tracks';
   right.append(select,row(title,btn('Create',()=>{try{const p=create(title.value);title.value='';notify('Created '+p.name+'.');}catch(e){notify(e.message,true);}},'pw-emphasis')),
     row(btn('Append to queue',()=>active()&&queue(active().tracks).catch(e=>notify(e.message,true))),
       btn('Replace queue',()=>active()&&queue(active().tracks,true).catch(e=>notify(e.message,true))),
       btn('Delete playlist',()=>{const p=active();if(!p)return;
         if(dj().isRunning?.())return notify('Stop AutoDJ before deleting a playlist.',true);
         if(window.confirm('Delete playlist '+p.name+'? Files will not be deleted.')){dj().deletePlaylist(p.id);state.playlistId='';refreshPlaylists();notify('Playlist deleted; audio files preserved.');}
       },'pw-warn')),amount,tracks);
   const upload=input('file');upload.accept='.json,application/json';upload.style.display='none';
   upload.addEventListener('change',async()=>{try{await importPlaylist(upload.files[0]);}catch(e){notify(e.message,true);}finally{upload.value='';}});
   right.append(row(
     btn('Export JSON',()=>exportCurrent('json')),btn('Export M3U',()=>exportCurrent('m3u')),
     btn('Export rundown',()=>exportCurrent('rundown')),btn('Import JSON',()=>upload.click()),upload
   ));
   grid.append(left,right);panel.append(grid);
   const generator=dom('section','pw-card pw-generator');
   generator.append(dom('h3','','3. BCN Show Playlist Generator'),
     dom('p','pw-muted','BCN music: Broken Sorrow, Therapy and Sonz, Justin Therapy and J-Cold. A temporary Unknown Artist exception also lets untagged songs into BCN. Other named artists remain excluded. This does not start a broadcast.'));
   const unknownToggle=input('checkbox');
   unknownToggle.id='pw-allow-unknown';
   unknownToggle.checked=allowUnknown();
   window.addEventListener('spider:bcn-unknown-change',()=>{unknownToggle.checked=allowUnknown();});
   unknownToggle.addEventListener('change',()=>{
     setAllowUnknown(unknownToggle.checked);
     state.draft=null;
     $('pw-save-show').disabled=true;
     $('pw-rundown').replaceChildren();
     notify(unknownToggle.checked
       ?'Temporary Unknown Artist exception enabled for BCN. Verify which tracks you have permission to broadcast.'
       :'Unknown Artist exception disabled. Regenerate the show using only the four named artists.');
   });
   generator.append(field('Temporarily allow Unknown Artist and empty artist tags on BCN',unknownToggle),
     dom('p','pw-muted','Turn this off after correcting your music metadata. It permits ALL otherwise eligible untagged tracks, so review the show before broadcasting.'));
   const form=dom('div','pw-form');
   const showName=input('text','BCN Midnight Signal');showName.id='pw-show-name';showName.maxLength=90;
   const length=document.createElement('select');length.id='pw-length';for(const n of [30,60,90,120,180,240])length.add(new Option(n+' minutes',n));length.value='60';
   const source=document.createElement('select');source.id='pw-source';
   for(const [label,value] of [['Entire indexed music library','library'],['Only selected tracks','selection'],['Current playlist','playlist']])source.add(new Option(label,value));
   const theme=input('search');theme.id='pw-theme';theme.placeholder='Optional artist / mood keyword';
   const breaks=input('number','5');breaks.min=2;breaks.max=20;breaks.id='pw-breaks';
   const avg=input('number','3.7');avg.min='1.5';avg.max='12';avg.step='.1';avg.id='pw-average';
   const seed=input('text','take-1');seed.id='pw-seed';
   form.append(field('Show name',showName),field('Show duration',length),field('Music source',source),field('Optional filter',theme),
     field('Songs between DJ breaks',breaks),field('Estimated song length (min)',avg),field('Rotation variation',seed));
   const strict=input('checkbox');strict.id='pw-strict';const repeat=input('checkbox');repeat.id='pw-repeat';
   const save=btn('Save show to BCN Scheduler',()=>saveGenerated().catch(e=>notify(e.message,true)),'pw-emphasis');save.id='pw-save-show';save.disabled=true;
   const lines=dom('div','pw-rundown');lines.id='pw-rundown';
   generator.append(form,row(field('Strict music filter',strict),field('Allow repeats for short libraries',repeat)),
     row(btn('Generate show',()=>{try{generate();}catch(e){notify(e.message,true);}},'pw-emphasis'),save,
       btn('Export draft rundown',()=>state.draft?download(Core.rundownText(state.draft),state.draft.name+'-rundown.txt'):notify('Generate a show first.',true)),
       btn('Append draft music to queue',()=>state.draft&&queue(state.draft.tracks).catch(e=>notify(e.message,true)))),lines);
   generator.append(row(btn('Open BCN show scheduler',()=>{
     panel.hidden=true;
     const trigger=document.getElementById('bcnMediaLauncher');
     if(trigger)trigger.click();else notify('BCN Media controls are still loading.',true);
   })));
   panel.append(generator);
   const cleaner=dom('section','pw-card pw-generator');
   cleaner.append(dom('h3','','4. Music Library Cleanup'),
      dom('p','pw-muted','Scan missing, empty, or malformed local media records. Network streams and files that cannot be verified stay untouched. Nothing here deletes actual files. Reconnect removable drives before cleaning.'));
   const cleanPlaylists=input('checkbox');cleanPlaylists.id='pw-clean-playlists';cleanPlaylists.checked=true;
   const auditStatus=dom('p','pw-muted','No scan run. Close any live BCN broadcast before scanning.');auditStatus.id='pw-audit-status';
   const auditPreview=dom('div','pw-rundown');auditPreview.id='pw-audit-preview';
   const clear=btn('Clear invalid stored entries',()=>removeInvalidMusic().catch(e=>notify(e.message,true)),'pw-warn');
   clear.id='pw-remove-invalid';clear.disabled=true;
   cleaner.append(row(btn('Scan invalid entries',()=>scanInvalidMusic().catch(e=>notify(e.message,true)),'pw-emphasis'),
      field('Also clean broken entries from saved playlists',cleanPlaylists),clear),auditStatus,auditPreview);
   panel.append(cleaner);
   document.body.append(launch,panel);
   document.addEventListener('keydown',event=>{if(event.key==='Escape')panel.hidden=true;});
   window.SpiderPlaylistWorkshop=Object.freeze({open:()=>launch.click(),generate:o=>Core.createShow(o)});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startup,{once:true});else startup();
})();
