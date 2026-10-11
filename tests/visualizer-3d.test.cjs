'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const visual=fs.readFileSync(path.join(root,'dist/visualizer-3d.js'),'utf8');
const shaders=fs.readFileSync(path.join(root,'dist/visualizer-3d-shaders.js'),'utf8');
const performanceSource=fs.readFileSync(path.join(root,'dist/visualizer-performance.js'),'utf8');

function harness(webgl=true){
  let current='3d-tunnel';
  const frames=[],events=[],draws=[],listeners=new Map();
  function element(tag){
    const obj={
      tagName:tag.toUpperCase(),style:{},children:[],value:'',
      isConnected:true,hidden:false,attributes:{},events:{},width:0,height:0,
      append(...children){for(const c of children){this.children.push(c);c.isConnected=true;c.parent=this;}},
      addEventListener(name,cb){this.events[name]=cb;},
      setAttribute(k,v){this.attributes[k]=v;},
      remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);},
      getBoundingClientRect(){return {width:800,height:480};},
      getContext(name){return (name==='webgl'||name==='experimental-webgl')&&webgl?gl:null;}
    };
    return obj;
  }
  const gl={
    VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
    ARRAY_BUFFER:5,STATIC_DRAW:6,TEXTURE_2D:7,TEXTURE_MIN_FILTER:8,
    TEXTURE_MAG_FILTER:9,TEXTURE_WRAP_S:10,TEXTURE_WRAP_T:11,
    LINEAR:12,CLAMP_TO_EDGE:13,LUMINANCE:14,UNSIGNED_BYTE:15,
    TEXTURE0:16,FLOAT:17,TRIANGLE_STRIP:18,
    createShader(){return {};},shaderSource(){},compileShader(){},getShaderParameter(){return true;},
    getShaderInfoLog(){return '';},deleteShader(){},createProgram(){return {};},attachShader(){},
    linkProgram(){},getProgramParameter(){return true;},getProgramInfoLog(){return '';},
    deleteProgram(){},createBuffer(){return {};},bindBuffer(){},bufferData(){},
    getAttribLocation(){return 0;},createTexture(){return {};},bindTexture(){},
    texParameteri(){},texImage2D(){},getUniformLocation(_p,n){return n;},
    texSubImage2D(){},viewport(){},useProgram(){},enableVertexAttribArray(){},
    vertexAttribPointer(){},activeTexture(){},uniform1i(){},uniform2f(){},
    uniform1f(){},uniform3f(){},drawArrays(...args){draws.push(args);},deleteTexture(){},deleteBuffer(){}
  };
  const stage=element('div');stage.id='mediaStage';
  const document={
    hidden:false,activeElement:null,
    createElement:element,
    getElementById(id){return id==='mediaStage'?stage:(id==='spider3dControls'?stage.children.find(e=>e.id===id)||null:null);},
    addEventListener(name,cb){listeners.set(name,cb);}
  };
  const stored=new Map();
  const window={
    requestAnimationFrame(cb){frames.push(cb);},
    devicePixelRatio:1.5,
    matchMedia(){return {matches:false};},
    dispatchEvent(e){events.push(e);},
    __spiderVisualizerSnapshot(){return {mode:current,playing:true,lightweight:false,isVideo:false,bands:new Uint8Array(1024).fill(120)};},
    __spiderPlayerEngine:{setVisualizerMode(value){current=value;}}
  };
  const context={
    window,document,CustomEvent:class{constructor(type,config){this.type=type;this.detail=config?.detail;}},
    localStorage:{getItem(k){return stored.get(k)||null;},setItem(k,v){stored.set(k,v);}},
    Float32Array,Uint8Array,console,Math
  };
  vm.runInNewContext(shaders,context);
  vm.runInNewContext(performanceSource,context);
  vm.runInNewContext(visual,context);
  const frame=t=>{const callback=frames.shift();assert.ok(callback,'expected scheduled frame');callback(t);};
  return {stage,window,document,events,frames,draws,gl,frame,get mode(){return current;},listener:listeners};
}

test('3D visualizer is real offline WebGL with 3D ray-marched geometry and FFT spectrum',()=>{
  assert.match(visual,/getContext\('webgl'/);
  assert.match(visual,/gl\.drawArrays\(gl\.TRIANGLE_STRIP,0,4\)/);
  assert.match(visual,/texSubImage2D/);
  assert.match(shaders,/float scene\(vec3 p\)/);
  assert.match(shaders,/vec3 normalAt\(vec3 p\)/);
  assert.match(shaders,/uniform sampler2D u_spectrum/);
  assert.match(shaders,/gl_FragColor/);
  assert.doesNotMatch(visual+shaders,/https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|mediaDevices/);
});

test('GPU scene renders on a separate canvas without claiming the audio output',()=>{
  const h=harness();
  h.frame(100);
  assert.equal(h.draws.length,1);
  const gpuCanvas=h.stage.children.find(e=>e.id==='spider3dCanvas');
  assert.ok(gpuCanvas);
  assert.equal(gpuCanvas.style.display,'block');
  assert.ok(gpuCanvas.width>0&&gpuCanvas.height>0);
  assert.ok(gpuCanvas.width*gpuCanvas.height<=1280*720);
  assert.equal(h.stage.children.some(e=>e.id==='spider3dControls'),true);
  assert.equal(h.window.__spider3dControls.modes.length,4);
});

test('GPU quality and 3D mode are controlled from accessible on-stage selectors',()=>{
  const h=harness();
  h.frame(100);
  const controls=h.stage.children.find(e=>e.id==='spider3dControls');
  const [mode,quality]=controls.children;
  assert.equal(mode.attributes['aria-label'],'Visualizer style');
  assert.equal(quality.attributes['aria-label'],'GPU visualizer quality');
  mode.value='3d-broken-city';
  mode.events.change();
  assert.equal(h.mode,'3d-broken-city');
  quality.value='eco';
  quality.events.change();
  assert.equal(h.window.__spider3dControls.quality(),'eco');
  h.frame(200);
  assert.ok(h.draws.length>=1);
  assert.equal(h.events.some(e=>e.type==='spider:notice'),true);
});

test('failure to initialize GPU safely reverts to a working 2D mode',()=>{
  const h=harness(false);
  h.frame(100);
  assert.equal(h.mode,'web');
  const canvas=h.stage.children.find(e=>e.id==='spider3dCanvas');
  h.frame(220);
  assert.equal(canvas.style.display,'none');
  assert.equal(h.draws.length,0);
});

test('video mode and hidden windows do not draw 3D behind video or use extra GPU',()=>{
  const h=harness();
  h.window.__spiderVisualizerSnapshot=()=>({mode:'3d-spectrum',playing:true,lightweight:false,isVideo:true,bands:new Uint8Array(1024)});
  h.frame(100);
  assert.equal(h.draws.length,0);
  const canvas=h.stage.children.find(e=>e.id==='spider3dCanvas');
  assert.equal(canvas.style.display,'none');
  h.window.__spiderVisualizerSnapshot=()=>({mode:'3d-spectrum',playing:true,lightweight:false,isVideo:false,bands:new Uint8Array(1024)});
  h.document.hidden=true;
  h.frame(200);
  assert.equal(h.draws.length,0);
});

test('React, classic player, renderer engine and release packager include all 3D pieces',()=>{
  const main=fs.readFileSync(path.join(root,'electron/renderer.js'),'utf8');
  const bridge=fs.readFileSync(path.join(root,'electron/renderer.bridge.js'),'utf8');
  const react=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
  const classic=fs.readFileSync(path.join(root,'electron/player.html'),'utf8');
  const packager=fs.readFileSync(path.join(root,'scripts/package-media-center.mjs'),'utf8');
  const installer=fs.readFileSync(path.join(root,'scripts/install-nova-bcn.sh'),'utf8');
  for(const name of ['3d-tunnel','3d-spectrum','3d-orbit','3d-broken-city']){
    assert.ok(main.includes(name));
    assert.ok(visual.includes(name));
  }
  assert.match(main,/window\.__spiderVisualizerSnapshot = /);
  assert.match(main,/setVisualizerMode: \(mode\) =>/);
  assert.match(bridge,/setVisualizerMode\(mode\)/);
  assert.match(react,/visualizer-3d-shaders\.js/);
  assert.match(react,/visualizer-3d\.js/);
  assert.match(react,/visualizer-performance\.js/);
  assert.match(classic,/visualizer-3d\.js/);
  assert.match(packager,/'dist\/visualizer-3d\.js'/);
  assert.match(packager,/'dist\/visualizer-3d-shaders\.js'/);
  assert.match(packager,/'dist\/visualizer-performance\.js'/);
  assert.match(installer,/SOURCE_COMMIT='c8f95f74ecc93eb858801eb2025af8f151e5116e'/);
  assert.match(installer,/CI_RUN_ID='38127241699'/);
});

test('new 3D FFT snapshot reads both live decks without a second AudioContext',()=>{
  const renderer=fs.readFileSync(path.join(root,'electron/renderer.js'),'utf8');
  const start=renderer.indexOf('const visualizer3dBands = new Uint8Array(1024);');
  const end=renderer.indexOf('const EQ_FREQUENCIES =',start);
  assert.ok(start>0&&end>start);
  let reads=0;
  const graph=(a,b)=>({
    deck:{paused:false},frequencyData:new Uint8Array(1024),
    analyser:{getByteFrequencyData(destination){reads++;destination[0]=a;destination[1]=b;}}
  });
  const first=graph(60,25),second=graph(35,99);
  const state={visualizerMode:'3d-spectrum',audioGraphs:[first,second],lightweightMode:false};
  const window={};
  vm.runInNewContext(renderer.slice(start,end),{
    state,window,Uint8Array,
    currentItem:()=>({type:'audio'}),isVideoItem:()=>false,
    Math
  });
  const withoutSample=window.__spiderVisualizerSnapshot();
  assert.equal(withoutSample.playing,true);
  assert.equal(reads,0);
  const actual=window.__spiderVisualizerSnapshot({sampleAudio:true});
  assert.equal(actual.playing,true);
  assert.equal(actual.bands[0],60);
  assert.equal(actual.bands[1],99);
  assert.equal(reads,2);
  first.deck.paused=true;
  const onlySecond=window.__spiderVisualizerSnapshot({sampleAudio:true});
  assert.equal(onlySecond.bands[0],35);
  state.visualizerMode='web';
  assert.equal(window.__spiderVisualizerSnapshot().bands,null);
  assert.equal(reads,3);
});

test('visualizer color, motion and performance HUD are adjustable without replacing audio',()=>{
  const h=harness();
  h.frame(100);
  const controls=h.stage.children.find(e=>e.id==='spider3dControls');
  const [mode,quality,theme,motion,adaptiveButton,statsButton,resetButton,theaterButton,stats]=controls.children;
  assert.equal(theme.attributes['aria-label'],'3D visualizer color theme');
  assert.equal(motion.attributes['aria-label'],'3D visualizer motion');
  theme.value='crimson';theme.events.change();
  motion.value='still';motion.events.change();
  adaptiveButton.events.click();
  assert.equal(adaptiveButton.textContent,'AUTO GPU OFF');
  adaptiveButton.events.click();
  assert.equal(adaptiveButton.textContent,'AUTO GPU ON');
  statsButton.events.click();
  h.frame(200);
  const report=h.window.__spider3dControls.diagnostics();
  assert.equal(report.theme,'crimson');
  assert.equal(report.motion,'still');
  assert.equal(stats.hidden,false);
  assert.match(stats.textContent,/FPS cap/);
  resetButton.events.click();
  assert.equal(h.window.__spider3dControls.diagnostics().theme,'purple');
});

test('3D layer restores legacy 2D canvas visibility on switching modes',()=>{
  const h=harness();
  const classic={
    style:{visibility:'visible'},
    isConnected:true
  };
  h.stage.querySelector=selector=>selector==='#visualizerCanvas'?classic:null;
  h.frame(100);
  assert.equal(classic.style.visibility,'hidden');
  h.window.__spiderPlayerEngine.setVisualizerMode('web');
  h.frame(200);
  assert.equal(classic.style.visibility,'visible');
});

test('cinema mode has an accessible control, fullscreen scoped to the visualizer stage',async()=>{
  const h=harness();
  h.document.fullscreenElement=null;
  h.stage.requestFullscreen=async()=>{h.document.fullscreenElement=h.stage;};
  h.document.exitFullscreen=async()=>{h.document.fullscreenElement=null;};
  h.frame(100);
  const controls=h.stage.children.find(e=>e.id==='spider3dControls');
  const cinema=controls.children.find(e=>e.attributes['aria-label']==='Toggle immersive fullscreen 3D cinema');
  assert.ok(cinema);
  assert.equal(cinema.attributes['aria-pressed'],'false');
  cinema.events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.document.fullscreenElement,h.stage);
  h.frame(200);
  assert.equal(cinema.textContent,'EXIT CINEMA');
  assert.equal(h.window.__spider3dControls.diagnostics().cinema,true);
  cinema.events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.document.fullscreenElement,null);
  h.frame(300);
  assert.equal(cinema.textContent,'CINEMA');
  assert.equal(h.window.__spider3dControls.diagnostics().cinema,false);
});

test('cinema is not activated in 2D mode or by a hidden media stage',async()=>{
  const h=harness();
  let entered=0;
  h.stage.requestFullscreen=async()=>{entered++;};
  h.frame(100);
  h.window.__spiderPlayerEngine.setVisualizerMode('web');
  h.frame(200);
  const cinema=h.stage.children.find(e=>e.id==='spider3dControls').children.find(e=>e.attributes['aria-label']==='Toggle immersive fullscreen 3D cinema');
  assert.equal(cinema.hidden,true);
  cinema.events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(entered,0);
});

test('cinema refuses fullscreen while video is occupying the media stage',async()=>{
  const h=harness();
  let entered=0;
  h.stage.requestFullscreen=async()=>{entered++;};
  h.window.__spiderVisualizerSnapshot=()=>({mode:'3d-tunnel',isVideo:true,playing:true,lightweight:false,bands:new Uint8Array(1024)});
  h.frame(100);
  const cinema=h.stage.children.find(e=>e.id==='spider3dControls').children.find(e=>e.attributes['aria-label']==='Toggle immersive fullscreen 3D cinema');
  assert.equal(cinema.hidden,true);
  cinema.events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(entered,0);
});
