'use strict';
/* Spider 3D visualizer: local, GPU-accelerated, no new audio device or network. */
(() => {
  const MODES = Object.freeze(['3d-tunnel','3d-spectrum','3d-orbit','3d-broken-city']);
  const performanceKit=window.SpiderVisualizerPerformance;
  const QUALITY=performanceKit.PRESETS;
  const THEMES=performanceKit.THEMES;
  const KEY='spider.visualizer.3d.settings';
  const legacyKey='spider.visualizer.3d.quality';
  const governor=new performanceKit.AdaptiveGovernor();
  let stage=null,canvas=null,controls=null,selector=null,qualitySelect=null,status=null;
  let themeSelect=null,motionSelect=null,statsButton=null,stats=null;
  let oldCanvas=null,oldCanvasVisibility=null;
  let settings=performanceKit.sanitize();
  let gpu=null,unavailable=false,contextLost=false,lastFrame=0,modeShown='';
  let quality='balanced';
  const cap=1280*720;

  function compile(gl,type,source){
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
      const message=String(gl.getShaderInfoLog(shader)||'unknown compiler issue').slice(0,160);
      gl.deleteShader(shader);
      throw new Error('GPU shader compilation failed: '+message);
    }
    return shader;
  }
  function createGpu(target){
    const gl=target.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false}) ||
      target.getContext('experimental-webgl',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
    if(!gl)throw new Error('WebGL acceleration unavailable');
    const source=window.Spider3DShaders;
    if(!source?.vertex||!source?.fragment)throw new Error('Spider 3D shader asset unavailable');
    const vertex=compile(gl,gl.VERTEX_SHADER,source.vertex);
    const fragment=compile(gl,gl.FRAGMENT_SHADER,source.fragment);
    const program=gl.createProgram();
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);
    gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
      const message=String(gl.getProgramInfoLog(program)||'unknown link error').slice(0,160);
      gl.deleteProgram(program);
      throw new Error('GPU program failed: '+message);
    }
    const quad=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'a_position');
    const texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,64,1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,new Uint8Array(64));
    const uniforms={};
    for(const name of ['u_resolution','u_time','u_bass','u_mid','u_high','u_mode','u_playing','u_spectrum','u_theme']){
      uniforms[name]=gl.getUniformLocation(program,name);
    }
    return {gl,quad,program,position,texture,uniforms,smoothed:new Uint8Array(64)};
  }
  function dispose(){
    if(!gpu)return;
    try{
      gpu.gl.deleteTexture(gpu.texture);
      gpu.gl.deleteBuffer(gpu.quad);
      gpu.gl.deleteProgram(gpu.program);
    }catch{}
    gpu=null;
  }
  function switchMode(mode){
    const engine=window.__spiderPlayerEngine;
    if(!engine?.setVisualizerMode)return;
    engine.setVisualizerMode(mode);
    window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:mode.startsWith('3d-')?'3D: '+mode.slice(3).replace(/-/g,' '):'2D visualizer'}}));
  }
  function saveSettings(){
    try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}
  }
  function selectQuality(value){
    quality=Object.prototype.hasOwnProperty.call(QUALITY,value)?value:'balanced';
    settings.quality=quality;
    governor.reset();
    saveSettings();
    if(qualitySelect)qualitySelect.value=quality;
  }
  function selectTheme(value){
    settings.theme=Object.prototype.hasOwnProperty.call(THEMES,value)?value:'purple';
    saveSettings();
  }
  function selectMotion(value){
    settings.motion=value==='calm'||value==='still'?value:'full';
    saveSettings();
  }
  function makeControls(parent){
    controls=document.createElement('div');
    controls.id='spider3dControls';
    controls.style.cssText='position:absolute;z-index:6;top:16px;left:16px;display:flex;flex-wrap:wrap;gap:7px;align-items:center;max-width:calc(100% - 150px);pointer-events:auto';
    selector=document.createElement('select');
    selector.setAttribute('aria-label','Visualizer style');
    for(const [value,label] of [
      ['web','2D · WEB'],['3d-tunnel','3D · TUNNEL'],['3d-spectrum','3D · SPECTRUM'],
      ['3d-orbit','3D · ORBIT'],['3d-broken-city','3D · BROKEN CITY']
    ]){
      const option=document.createElement('option');
      option.value=value;option.textContent=label;selector.append(option);
    }
    selector.addEventListener('change',()=>switchMode(selector.value));
    qualitySelect=document.createElement('select');
    qualitySelect.setAttribute('aria-label','GPU visualizer quality');
    for(const name of ['eco','balanced','ultra']){
      const option=document.createElement('option');
      option.value=name;option.textContent='GPU '+name.toUpperCase();qualitySelect.append(option);
    }
    qualitySelect.addEventListener('change',()=>selectQuality(qualitySelect.value));
    qualitySelect.value=quality;
    themeSelect=document.createElement('select');
    themeSelect.setAttribute('aria-label','3D visualizer color theme');
    for(const theme of Object.keys(THEMES)){
      const option=document.createElement('option');
      option.value=theme;option.textContent='COLOR '+theme.toUpperCase();
      themeSelect.append(option);
    }
    themeSelect.value=settings.theme;
    themeSelect.addEventListener('change',()=>selectTheme(themeSelect.value));
    motionSelect=document.createElement('select');
    motionSelect.setAttribute('aria-label','3D visualizer motion');
    for(const name of ['full','calm','still']){
      const option=document.createElement('option');
      option.value=name;option.textContent='MOTION '+name.toUpperCase();
      motionSelect.append(option);
    }
    motionSelect.value=settings.motion;
    motionSelect.addEventListener('change',()=>selectMotion(motionSelect.value));
    statsButton=document.createElement('button');
    statsButton.type='button';statsButton.textContent='GPU STATS';
    statsButton.setAttribute('aria-label','Toggle 3D performance statistics');
    statsButton.addEventListener('click',()=>{
      settings.showStats=!settings.showStats;saveSettings();
      stats.hidden=!settings.showStats;
    });
    stats=document.createElement('span');
    stats.setAttribute('aria-label','3D performance diagnostics');
    stats.hidden=!settings.showStats;
    stats.style.cssText='font:10px monospace;color:#d8b5ff;text-shadow:0 1px 2px black';
    status=document.createElement('span');
    status.setAttribute('role','status');
    status.textContent='3D ready';
    status.style.cssText='font:10px system-ui;color:#d8b5ff;text-shadow:0 1px 2px black';
    for(const input of [selector,qualitySelect,themeSelect,motionSelect,statsButton]){
      input.style.cssText='color:#f2d9ff;background:#180d25;border:1px solid #9851c4;border-radius:7px;font:11px system-ui;padding:6px;max-width:170px';
    }
    controls.append(selector,qualitySelect,themeSelect,motionSelect,statsButton,stats,status);
    // The React player already supplies a fullscreen control. The classic
    // player gets the same affordance without modifying its legacy layout.
    if (!parent.querySelector?.('.visualizer-fullscreen')) {
      const full=document.createElement('button');
      full.type='button';
      full.textContent='FULLSCREEN';
      full.setAttribute('aria-label','Toggle fullscreen visualizer');
      full.style.cssText='color:#f2d9ff;background:#180d25;border:1px solid #9851c4;border-radius:7px;font:11px system-ui;padding:6px;cursor:pointer';
      full.addEventListener('click',async()=>{
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await parent.requestFullscreen();
        } catch(error) {
          window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:'Fullscreen unavailable: '+String(error?.message||'unsupported')}}));
        }
      });
      controls.append(full);
    }
    parent.append(controls);
  }
  function findStage(){
    const node=document.getElementById('mediaStage');
    if(!node)return false;
    if(node===stage&&canvas?.isConnected)return true;
    dispose();
    if(oldCanvas && oldCanvasVisibility!==null)oldCanvas.style.visibility=oldCanvasVisibility;
    oldCanvas=null;oldCanvasVisibility=null;
    canvas?.remove();controls?.remove();
    governor.reset();
    stage=node;
    oldCanvas=stage.querySelector?.('#visualizerCanvas')||null;
    if(oldCanvas)oldCanvasVisibility=oldCanvas.style.visibility;
    canvas=document.createElement('canvas');
    canvas.id='spider3dCanvas';canvas.setAttribute('aria-label','Audio-reactive 3D WebGL visualizer');
    canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;display:none;mix-blend-mode:screen';
    stage.append(canvas);
    makeControls(stage);
    gpu=null;unavailable=false;contextLost=false;
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();
      contextLost=true;unavailable=true;dispose();
      if(window.__spiderVisualizerSnapshot?.().mode?.startsWith('3d-'))switchMode('web');
      if(status)status.textContent='GPU lost · 2D fallback';
    });
    canvas.addEventListener('webglcontextrestored',()=>{
      contextLost=false;unavailable=false;gpu=null;
      if(status)status.textContent='3D ready';
    });
    return true;
  }
  function draw(time,snapshot,bounds){
    if(!gpu)gpu=createGpu(canvas);
    const size=performanceKit.renderSize(bounds.width,bounds.height,window.devicePixelRatio,quality,governor.scale,cap);
    const {width,height}=size;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    if(status && status.textContent!=='3D GPU ACTIVE')status.textContent='3D GPU ACTIVE';
    const {gl,program,quad,position,texture,uniforms,smoothed}=gpu;
    const bins=snapshot.bands;
    for(let i=0;i<64;i++){
      const bin=bins?.length?Math.min(bins.length-1,Math.floor(Math.pow(i/63,1.55)*(bins.length-1))):0;
      const current=bins?.length?bins[bin]:0;
      const target=snapshot.playing?current:(8+Math.sin(time/700+i*0.6)*5);
      smoothed[i]=Math.round(smoothed[i]*0.76+Math.max(0,Math.min(255,target))*0.24);
    }
    const mean=(a,b)=>{
      let total=0;for(let i=a;i<b;i++)total+=smoothed[i];
      return total/Math.max(1,b-a)/255;
    };
    gl.viewport(0,0,width,height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,64,1,gl.LUMINANCE,gl.UNSIGNED_BYTE,smoothed);
    gl.uniform1i(uniforms.u_spectrum,0);
    gl.uniform2f(uniforms.u_resolution,width,height);
    const motionFactor=settings.motion==='still'?0:settings.motion==='calm'?0.35:1;
    gl.uniform1f(uniforms.u_time,time/1000*motionFactor);
    gl.uniform1f(uniforms.u_bass,mean(0,10));
    gl.uniform1f(uniforms.u_mid,mean(10,38));
    gl.uniform1f(uniforms.u_high,mean(38,64));
    gl.uniform1f(uniforms.u_mode,MODES.indexOf(snapshot.mode));
    gl.uniform1f(uniforms.u_playing,snapshot.playing?1:0);
    const color=THEMES[settings.theme];
    gl.uniform3f(uniforms.u_theme,color[0],color[1],color[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  function loop(time){
    window.requestAnimationFrame(loop);
    if(!findStage())return;
    const snapshot=window.__spiderVisualizerSnapshot?.();
    if(!snapshot)return;
    const is3d=MODES.includes(snapshot.mode);
    const visible=is3d&&!snapshot.isVideo;
    if(canvas.style.display!==(visible?'block':'none'))canvas.style.display=visible?'block':'none';
    if(oldCanvas)oldCanvas.style.visibility=visible?'hidden':oldCanvasVisibility;
    if(snapshot.mode!==modeShown){
      selector.value=is3d?snapshot.mode:'web';
      modeShown=snapshot.mode;
    }
    qualitySelect.hidden=!is3d;
    themeSelect.hidden=!is3d;
    motionSelect.hidden=!is3d;
    statsButton.hidden=!is3d;
    stats.hidden=!is3d||!settings.showStats;
    status.hidden=!is3d;
    if(!visible||document.hidden||unavailable||contextLost)return;
    const fps=snapshot.lightweight?Math.min(QUALITY[quality].fps,15):QUALITY[quality].fps;
    if(time-lastFrame<1000/fps)return;
    lastFrame=time;
    const bounds=stage.getBoundingClientRect();
    if(bounds.width<2||bounds.height<2)return;
    // Only sample audio at the actual, throttled render frequency.
    const audioSnapshot=window.__spiderVisualizerSnapshot?.({sampleAudio:true}) || snapshot;
    try{
      const started=window.performance?.now?.()??time;
      draw(time,audioSnapshot,bounds);
      const elapsed=Math.max(0,(window.performance?.now?.()??started)-started);
      governor.record(elapsed,fps,settings.adaptive && !snapshot.lightweight);
      if(stats && settings.showStats){
        const report=governor.snapshot();
        stats.textContent=canvas.width+'×'+canvas.height+' · '+fps+' FPS cap · GPU '+Math.round(report.scale*100)+'% · '+report.p75Ms.toFixed(1)+'ms p75';
      }
    }
    catch(error){
      unavailable=true;dispose();switchMode('web');
      if(status)status.textContent='GPU unsupported · 2D fallback';
      console.warn('Spider visualizer 3D fallback:',error.message);
    }
  }
  document.addEventListener('keydown',event=>{
    if(!event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.repeat)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
    if(event.key.toLowerCase()==='v'){
      event.preventDefault();
      const current=window.__spiderVisualizerSnapshot?.().mode;
      switchMode(MODES[(MODES.indexOf(current)+1)%MODES.length]);
    }
  });
  try{
    const raw=localStorage.getItem(KEY);
    const saved=raw?JSON.parse(raw):{quality:localStorage.getItem(legacyKey)};
    settings=performanceKit.sanitize(saved);
    quality=settings.quality;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      quality='eco';settings.motion='still';
    }
  }catch{settings=performanceKit.sanitize();}
  window.requestAnimationFrame(loop);
  window.__spider3dControls={
    modes:MODES,quality:()=>quality,
    diagnostics:()=>Object.freeze({mode:window.__spiderVisualizerSnapshot?.().mode||'unknown',
      quality,theme:settings.theme,motion:settings.motion,
      resolution:canvas?{width:canvas.width,height:canvas.height}:null,
      governor:governor.snapshot(),webglActive:!!gpu,contextLost}),
    reset:()=>{
      settings=performanceKit.sanitize();
      selectQuality('balanced');selectTheme('purple');selectMotion('full');
      if(themeSelect)themeSelect.value='purple';
      if(motionSelect)motionSelect.value='full';
      if(stats)stats.hidden=true;
    }
  };
})();