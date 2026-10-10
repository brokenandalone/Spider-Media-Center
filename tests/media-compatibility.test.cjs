const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {fileURLToPath,pathToFileURL} = require('node:url');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {MediaCompatibility} = require('../electron/media-compatibility.cjs');
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(),'spider-movie-test-'));
test('movie preparation rejects network, executable, and missing inputs', async t => {
  const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const decoder=new MediaCompatibility(path.join(root,'cache'));
  await assert.rejects(decoder.prepare('https://example.invalid/movie.mkv'),/local movie/);
  const executable=path.join(root,'script.sh');fs.writeFileSync(executable,'echo bad');
  await assert.rejects(decoder.prepare(pathToFileURL(executable).href),/supported local movie/);
  await assert.rejects(decoder.prepare(pathToFileURL(path.join(root,'missing.mkv')).href),/local movie/);
});
test('cancelled conversion removes partial output and allows another job', async t => {
  const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input=path.join(root,'movie.mkv');fs.writeFileSync(input,'movie');let child;
  const decoder=new MediaCompatibility(path.join(root,'cache'),{spawn(_program,args,options){
    assert.equal(options.shell,false);assert.equal(args[args.indexOf('-i')+1],input);
    fs.writeFileSync(args.at(-1),'partial');
    child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true};return child;
  }});
  const pending=decoder.prepare(pathToFileURL(input).href);
  await assert.rejects(decoder.prepare(pathToFileURL(input).href),/Another movie/);
  assert.equal(decoder.cancel(),true);await assert.rejects(pending,/cancelled/);
  assert.equal(decoder.job,null);assert.deepEqual(fs.readdirSync(path.join(root,'cache')),[]);
  assert.equal(fs.readFileSync(input,'utf8'),'movie');
});
const ffmpegAvailable = spawnSync('ffmpeg',['-version']).status===0;
test('native decoding creates a playable WebM copy and reuses it without changing the original', {skip:!ffmpegAvailable}, async t => {
  const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const input=path.join(root,"movie with 'quotes'.mkv");
  const created=spawnSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','mpeg4','-c:a','pcm_s16le',input]);
  assert.equal(created.status,0,String(created.stderr));
  const original=fs.readFileSync(input);const decoder=new MediaCompatibility(path.join(root,'cache'));
  const result=await decoder.prepare(pathToFileURL(input).href);
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','json',fileURLToPath(result.url)]);
  assert.equal(probe.status,0,String(probe.stderr));
  assert.deepEqual(JSON.parse(probe.stdout).streams.map(s=>s.codec_name),['vp8','opus']);
  assert.deepEqual(fs.readFileSync(input),original);
  const again=await decoder.prepare(pathToFileURL(input).href);assert.equal(again.cached,true);assert.equal(again.url,result.url);
});
