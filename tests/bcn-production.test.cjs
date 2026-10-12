'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {BcnProductionLibrary}=require('../electron/bcn-production.cjs');
const {nativeNova}=require('../electron/nova-service.cjs');
const audio=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(56)]);
const dataUrl='data:audio/wav;base64,'+audio.toString('base64');
test('approved BCN imaging is backed up on disk and only the operator can delete it',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bcn-spots-'));
 try{
  const lib=new BcnProductionLibrary(root);
  const item={type:'station_id',title:'Station ID',script:'Nova welcomes you to BCN.',
    audioDataUrl:dataUrl,voiceEngine:'matilda'};
  assert.throws(()=>lib.save(item),/approval/);
  assert.throws(()=>lib.save({...item,approved:true,audioDataUrl:'file:///tmp/foo'}),/Unsupported/);
  const spot=lib.save({...item,approved:true});
  assert.equal(lib.records().length,1);
  assert.equal(lib.records()[0].voiceEngine,'matilda');
  assert.equal(fs.statSync(path.join(root,'index.json')).mode&0o777,0o600);
  assert.throws(()=>lib.remove('../unsafe'),/Invalid/);
  assert.equal(lib.remove(spot.id).length,0);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('Nova drafts do not generate audio and approved production speaks exactly the reviewed words',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bcn-voice-'));
 const filename=path.join(root,'nova.wav');fs.writeFileSync(filename,audio);
 let renders=0,latest;
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  res.setHeader('Content-Type','application/json');
  if(req.url==='/dj/draft')return res.end(JSON.stringify({script:'Nova here for BCN. This is Nightwatch.',draft:true}));
  renders++;latest=body;
  res.end(JSON.stringify({script:body.context.approvedCopy,audioFile:pathToFileURL(filename).href,voiceEngine:'matilda'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const nova=nativeNova({port:server.address().port,cacheDir:root});
  const input={type:'show_id',showName:'Nightwatch',voiceProfile:'matilda'};
  const draft=await nova.draftProduction(input);
  assert.equal(renders,0);
  await assert.rejects(nova.produceApproved({...input,approvedCopy:draft.script}),/approve/);
  const produced=await nova.produceApproved({...input,approvedCopy:draft.script,copyApproved:true});
  assert.equal(produced.voiceEngine,'matilda');
  assert.match(produced.audioDataUrl,/^data:audio\/wav;base64,/);
  assert.equal(latest.context.approvedCopy,draft.script);
  assert.equal(latest.context.productionMode,true);
  assert.equal(renders,1);
  await assert.rejects(nova.draftProduction({type:'commercial'}),/sponsor/);
 } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
test('production UI uses trusted IPC and is part of BCN Media',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
 for(const name of ['Nova Production Studio','novaProductionDraft','novaProductionVoice',
                    'bcnProductionSave','Cue explicitly'])assert.ok(read('dist/media-center-upgrades.js').includes(name));
 assert.match(read('electron/main.cjs'),/bcn:production-save/);
 assert.match(read('electron/preload.cjs'),/bcnProductionList/);
 assert.match(read('scripts/package-media-center.mjs'),/bcn-production\.cjs/);
});
