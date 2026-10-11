'use strict';
// Standalone, offline visualizer preset bank. No media data or network access.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SpiderVisualizerPresets=api;
})(typeof window!=='undefined'?window:null,function(){
  const MODES=Object.freeze(['3d-tunnel','3d-spectrum','3d-orbit','3d-broken-city']);
  const THEMES=Object.freeze(['purple','crimson','ice','emerald','gold']);
  const QUALITY=Object.freeze(['eco','balanced','ultra']);
  const MOTION=Object.freeze(['full','calm','still']);
  const BUILT_INS=Object.freeze([
    Object.freeze({id:'neon-tunnel',name:'NEON TUNNEL',mode:'3d-tunnel',theme:'purple',quality:'balanced',motion:'full'}),
    Object.freeze({id:'bcn-broadcast',name:'BCN BROADCAST',mode:'3d-spectrum',theme:'crimson',quality:'balanced',motion:'full'}),
    Object.freeze({id:'broken-city',name:'BROKEN CITY',mode:'3d-broken-city',theme:'crimson',quality:'ultra',motion:'calm'}),
    Object.freeze({id:'deep-forage',name:'DEEP FORAGE',mode:'3d-tunnel',theme:'ice',quality:'ultra',motion:'calm'}),
    Object.freeze({id:'orbit-emerald',name:'EMERALD ORBIT',mode:'3d-orbit',theme:'emerald',quality:'balanced',motion:'full'}),
    Object.freeze({id:'golden-hour',name:'GOLDEN HOUR',mode:'3d-orbit',theme:'gold',quality:'balanced',motion:'calm'}),
    Object.freeze({id:'low-power',name:'LOW POWER',mode:'3d-spectrum',theme:'purple',quality:'eco',motion:'still'}),
    Object.freeze({id:'midnight-radio',name:'MIDNIGHT RADIO',mode:'3d-broken-city',theme:'purple',quality:'eco',motion:'calm'})
  ]);
  const MAX_CUSTOM=12;
  function cleanPreset(raw,id){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const mode=MODES.includes(raw.mode)?raw.mode:null;
    if(!mode)return null;
    const theme=THEMES.includes(raw.theme)?raw.theme:'purple';
    const quality=QUALITY.includes(raw.quality)?raw.quality:'balanced';
    const motion=MOTION.includes(raw.motion)?raw.motion:'full';
    const name=String(raw.name||'MY SCENE').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,32)||'MY SCENE';
    return {id,name,mode,theme,quality,motion};
  }
  function readCustom(serialized){
    if(typeof serialized!=='string'||serialized.length>12000)return [];
    try{
      const parsed=JSON.parse(serialized);
      if(!Array.isArray(parsed))return [];
      const result=[];
      for(const item of parsed.slice(0,MAX_CUSTOM)){
        const preset=cleanPreset(item,'user-'+result.length);
        if(preset)result.push(preset);
      }
      return result;
    }catch{return [];}
  }
  class PresetBank{
    constructor(custom=[]){this.custom=readCustom(JSON.stringify(custom));this.nextId=this.custom.length;}
    list(){return [...BUILT_INS,...this.custom];}
    find(id){return this.list().find(p=>p.id===id)||null;}
    save(raw){
      const preset=cleanPreset(raw,'user-'+(this.nextId++).toString(36)+'-'+Date.now().toString(36));
      if(!preset)return null;
      if(this.custom.length>=MAX_CUSTOM)return null;
      this.custom.push(preset);
      return preset;
    }
    delete(id){
      if(typeof id!=='string'||!id.startsWith('user-'))return false;
      const old=this.custom.length;
      this.custom=this.custom.filter(p=>p.id!==id);
      return old!==this.custom.length;
    }
    serialize(){return JSON.stringify(this.custom);}
  }
  class FrameHealth{
    constructor(){this.reset();}
    reset(){this.count=0;this.drawn=0;this.skipped=0;this.errors=0;this.last=0;this.windowStart=0;this.fps=0;this.maxGap=0;}
    tick(now,drawn=false){
      if(!Number.isFinite(now)||now<0)return;
      if(this.last&&now>this.last)this.maxGap=Math.max(this.maxGap,Math.min(5000,now-this.last));
      this.last=now;this.count++;
      if(drawn)this.drawn++;else this.skipped++;
      if(!this.windowStart)this.windowStart=now;
      const delta=now-this.windowStart;
      if(delta>=1000){this.fps=Math.round(this.drawn*1000/delta);this.windowStart=now;this.drawn=0;this.skipped=0;}
    }
    failure(){this.errors=Math.min(9999,this.errors+1);}
    snapshot(){return Object.freeze({fps:this.fps,frames:this.count,skipped:this.skipped,errors:this.errors,maxGapMs:Math.round(this.maxGap)});}
  }
  return Object.freeze({BUILT_INS,MAX_CUSTOM,cleanPreset,readCustom,PresetBank,FrameHealth});
});
