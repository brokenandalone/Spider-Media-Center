'use strict';
// Operator-owned BCN imaging library. No AI draft is ever broadcast automatically.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const CATEGORIES=new Set(['station_id','show_id','commercial','promo','sweeper','bumper','liner']);
const MAX_AUDIO=4*1024*1024;
const trim=(v,n)=>String(v||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,n);
function assertAudio(url){
  if(typeof url!=='string')throw Error('A finished Nova recording is required');
  const match=/^data:audio\/(mpeg|wav);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if(!match || match[2].length>MAX_AUDIO*1.37+20)throw Error('Unsupported or oversized Nova audio');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>MAX_AUDIO)throw Error('Finished voice audio exceeds safety limits');
  if(match[1]==='wav' && bytes.subarray(0,4).toString('ascii')!=='RIFF')
    throw Error('Invalid WAV voice recording');
  if(match[1]==='mpeg' && bytes.subarray(0,3).toString('ascii')!=='ID3' &&
     !(bytes[0]===0xff && (bytes[1]&0xe0)===0xe0))throw Error('Invalid MP3 voice recording');
  return {bytes,extension:match[1]==='wav'?'wav':'mp3'};
}
class BcnProductionLibrary{
  constructor(base){this.base=path.resolve(base);this.index=path.join(this.base,'index.json');}
  ensure(){
    if(fs.existsSync(this.base)&&fs.lstatSync(this.base).isSymbolicLink())
      throw Error('BCN production folder must not be a symlink');
    fs.mkdirSync(this.base,{recursive:true,mode:0o700});
  }
  list(){
    this.ensure();
    try {
      const data=JSON.parse(fs.readFileSync(this.index,'utf8'));
      return (Array.isArray(data.items)?data.items:[])
        .filter(x=>x&&/^[0-9a-f-]{36}$/.test(x.id))
        .map(x=>({...x}));
    }catch(e){if(e.code==='ENOENT')return [];throw e;}
  }
  writeIndex(items){
    const tmp=this.index+'.'+crypto.randomUUID()+'.tmp';
    try { fs.writeFileSync(tmp,JSON.stringify({version:1,items},null,2),{mode:0o600,flag:'wx'});
      fs.renameSync(tmp,this.index); }
    finally {try{fs.unlinkSync(tmp);}catch{}}
  }
  save(input){
    if(!input||typeof input!=='object'||input.approved!==true)throw Error('Operator approval required to store a BCN production');
    const type=trim(input.type,32);
    if(!CATEGORIES.has(type))throw Error('Invalid BCN production category');
    const title=trim(input.title,100),script=trim(input.script,1100),voice=trim(input.voiceEngine,40);
    if(title.length<2||script.length<8)throw Error('Title and approved copy required');
    const {bytes,extension}=assertAudio(input.audioDataUrl);
    this.ensure();
    const items=this.list();
    if(items.length>=300)throw Error('BCN imaging library full (300 spots)');
    const id=crypto.randomUUID(),filename=id+'.'+extension,file=path.join(this.base,filename);
    const record={id,type,title,script,voiceEngine:voice||'unverified',
      sponsor:trim(input.sponsor,90),showName:trim(input.showName,80),
      createdAt:new Date().toISOString(),filename};
    try{
      fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
      this.writeIndex([...items,record]);
    }catch(error){try{fs.unlinkSync(file);}catch{}throw error;}
    return {...record,url:pathToFileURL(file).href};
  }
  records(){
    return this.list().map(x=>({...x,url:pathToFileURL(path.join(this.base,x.filename)).href}));
  }
  remove(id){
    if(!/^[0-9a-f-]{36}$/.test(String(id)))throw Error('Invalid BCN production ID');
    const items=this.list(),spot=items.find(x=>x.id===id);
    if(!spot)throw Error('BCN production not found');
    this.writeIndex(items.filter(x=>x.id!==id));
    const file=path.join(this.base,spot.filename);
    if(path.dirname(file)!==this.base)throw Error('Unsafe BCN production path');
    try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    return this.records();
  }
}
module.exports={BcnProductionLibrary,CATEGORIES,assertAudio};
