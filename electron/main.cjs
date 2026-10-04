const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  shell,
  globalShortcut
} = require('electron');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const QRCode = require('qrcode');

const ROOT = path.join(__dirname, '..');
const USE_REACT_UI = process.env.SPIDER_LEGACY_UI !== '1' && process.env.SPIDER_SMOKE_TEST !== '1';
const PLAYER_FILE = USE_REACT_UI
  ? path.join(ROOT, 'dist', 'index.html')
  : path.join(__dirname, 'player.html');
const ICON_PATH = path.join(ROOT, 'assets', 'icon-512.png');
const APP_ID = 'com.spider.media.center';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function firstExistingFile(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

function resolveCloudflaredPath() {
  const override = String(process.env.SPIDER_CLOUDFLARED || '').trim();
  if (override) return override;

  if (process.platform === 'win32') {
    return firstExistingFile([
      app.isPackaged
        ? path.join(process.resourcesPath, 'tools', 'cloudflared.exe')
        : path.join(ROOT, 'assets', 'tools', 'cloudflared.exe')
    ]) || 'cloudflared.exe';
  }

  return firstExistingFile([
    app.isPackaged
      ? path.join(process.resourcesPath, 'tools', 'cloudflared')
      : path.join(ROOT, 'assets', 'tools', 'cloudflared'),
    '/usr/bin/cloudflared',
    '/usr/local/bin/cloudflared'
  ]) || 'cloudflared';
}

const CLOUDFLARED_PATH = resolveCloudflaredPath();

const SERVICES = Object.freeze({
  spotify: {
    title: 'Spotify',
    url: 'https://open.spotify.com/'
  },
  appleMusic: {
    title: 'Apple Music',
    url: 'https://music.apple.com/'
  },
  appleTv: {
    title: 'Apple TV',
    url: 'https://tv.apple.com/'
  }
});

const MEDIA_EXTENSIONS = new Set([
  '.aac', '.aiff', '.avi', '.flac', '.m4a', '.mkv', '.mov', '.mp3',
  '.mp4', '.mpeg', '.mpg', '.ogg', '.opus', '.wav', '.webm', '.wmv'
]);

let mainWindow;
let nearbyServer;
let nearbyInfo;
let partySnapshot = { enabled: false, queue: [], nowPlaying: null };
let partyConfig = { pin: '', requestLimit: 40, voting: true };
let guestRequests = [];
const partyVotes = new Map();
const serviceWindows = new Map();
const sharedFiles = new Map();
const radioListeners = new Map();
let radioServer;
let radioTunnel;
let radioState = { active: false, listenerCount: 0 };
let remoteServer;
let remoteSession;
let remoteSnapshot = { player: null, queue: null, radio: null, updatedAt: 0 };
let remoteCommandId = 0;
let pendingOpenPaths = process.argv.slice(1).filter((value) => MEDIA_EXTENSIONS.has(path.extname(value).toLowerCase()));
let regularWindowBounds;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', (_event, commandLine) => {
  const paths = commandLine.filter((value) => MEDIA_EXTENSIONS.has(path.extname(value).toLowerCase()));
  if (paths.length && mainWindow && !mainWindow.isDestroyed()) {
    void safeMediaEntries(paths).then((entries) => mainWindow.webContents.send('media:open', entries));
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

if (!app.isPackaged) {
  const runtimeDirectory = path.join(ROOT, '.runtime');
  const userDataDirectory = path.join(runtimeDirectory, 'user-data');
  const sessionDataDirectory = path.join(runtimeDirectory, 'session-data');
  const cacheDirectory = path.join(runtimeDirectory, 'cache');

  for (const directory of [userDataDirectory, sessionDataDirectory, cacheDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  app.setPath('userData', userDataDirectory);
  app.setPath('sessionData', sessionDataDirectory);
  app.commandLine.appendSwitch('disk-cache-dir', cacheDirectory);
}

if (app.isPackaged) {
  const cacheRoot = process.env.LOCALAPPDATA || app.getPath('userData');
  const cacheDirectory = path.join(cacheRoot, 'Spider Media Center', 'Cache');
  fs.mkdirSync(cacheDirectory, { recursive: true });
  app.commandLine.appendSwitch('disk-cache-dir', cacheDirectory);
}

app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function sendNearbyEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nearby:event', payload);
  }
}

function sendRemoteCommand(command, args = []) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const id = ++remoteCommandId;
  mainWindow.webContents.send('remote:command', { id, command, args });
  return true;
}

function remoteHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#100817"><title>Spider Mobile Studio</title>
  <style>
  :root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#100817;color:#fff}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,#44205f,#100817 55%);min-height:100vh}
  main{max-width:620px;margin:auto;padding:env(safe-area-inset-top) 14px calc(24px + env(safe-area-inset-bottom))}
  header{display:flex;align-items:center;justify-content:space-between;padding:18px 4px 10px}
  h1,h2,p{margin:0}h1{font-size:24px;letter-spacing:-.03em}.eyebrow{color:#d8b4fe;font-size:11px;letter-spacing:.14em;font-weight:800}
  .pill{border:1px solid #c084fc;border-radius:999px;padding:7px 10px;font-size:11px;font-weight:800}.live{color:#fda4af;border-color:#fb7185}
  .card{background:#1b1026dd;border:1px solid #a855f755;border-radius:18px;padding:16px;margin:10px 0;box-shadow:0 12px 32px #0004}
  .now{min-height:118px;display:flex;flex-direction:column;justify-content:end;gap:6px}.now h2{font-size:25px}.muted{color:#c4b5fd}
  .transport{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:8px;margin-top:14px}
  button{font:inherit;color:#fff;background:#7e22ce;border:0;border-radius:12px;padding:14px 10px;font-weight:800;min-height:48px;touch-action:manipulation}
  button:active{transform:scale(.98)}button.secondary{background:#31203d}button.danger{background:#b91c1c}button.warn{background:#a16207}
  .controls{display:grid;gap:13px;margin-top:16px}.control{display:grid;grid-template-columns:92px 1fr 42px;gap:10px;align-items:center;font-size:13px}
  input[type=range]{width:100%;accent-color:#c084fc}output{text-align:right;color:#e9d5ff;font-variant-numeric:tabular-nums}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.grid button{font-size:12px}.section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
  .section-title h3{font-size:15px}.queue{display:grid;gap:7px;max-height:260px;overflow:auto}.queue button{text-align:left;background:#2a1937;padding:11px;min-height:44px}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stat{background:#120b1a;border-radius:12px;padding:11px}.stat small{display:block;color:#c4b5fd;font-size:10px}.stat strong{display:block;margin-top:4px;font-size:16px}
  .notice{font-size:12px;color:#d8b4fe;line-height:1.4}.error{color:#fecaca}
  @media(min-width:560px){main{padding-left:24px;padding-right:24px}.grid{grid-template-columns:repeat(4,1fr)}}
  </style></head><body><main>
  <header><div><span class="eyebrow">SPIDER 3.0</span><h1>Mobile Studio</h1></div><span id="status" class="pill">CONNECTING</span></header>
  <section class="card now"><span class="eyebrow">PROGRAM</span><h2 id="now">Waiting for Spider</h2><p id="artist" class="muted">Secure remote session</p>
  <div class="transport"><button class="secondary" onclick="command('previous')">PREV</button><button onclick="command('togglePlay')">PLAY / PAUSE</button><button class="secondary" onclick="command('next')">NEXT</button></div></section>
  <section class="card controls"><div class="control"><span>Volume</span><input id="volume" type="range" min="0" max="100" value="82" oninput="command('setVolume',Number(this.value))"><output id="volumeOut">82%</output></div>
  <div class="control"><span>Crossfade</span><input id="crossfade" type="range" min="0" max="12" value="4" oninput="command('setCrossfade',Number(this.value))"><output id="crossfadeOut">4s</output></div></section>
  <section class="card"><div class="section-title"><h3>Station status</h3><span id="connection" class="muted">offline</span></div><div class="stats">
  <div class="stat"><small>LISTENERS</small><strong id="listeners">0</strong></div><div class="stat"><small>QUEUE</small><strong id="queueCount">0</strong></div><div class="stat"><small>RECORDING</small><strong id="recording">OFF</strong></div></div></section>
  <section class="card"><div class="section-title"><h3>Queue</h3><span class="muted">Tap to play</span></div><div id="queue" class="queue"><span class="muted">Loading…</span></div></section>
  <section class="card"><div class="section-title"><h3>Broadcast controls</h3><span id="radioLabel" class="muted">OFF AIR</span></div>
  <div class="grid"><button onclick="command('startRadio',{name:'Spider Radio',dj:'Mobile Studio'})">GO LIVE</button><button class="secondary" onclick="command('stopRecording')">STOP REC</button><button class="warn" onclick="command('startRecording',{show:'Mobile Studio'})">RECORD</button><button class="danger" onclick="command('stopRadio')">STOP RADIO</button></div></section>
  <section class="card"><div class="section-title"><h3>Safety</h3></div><div class="grid"><button class="danger" onclick="command('panicMute')">PANIC MUTE</button><button class="secondary" onclick="command('clearPanicMute')">RESTORE AUDIO</button><button class="danger" onclick="command('stopAllBuffers')">STOP CARTS</button></div><p id="error" class="notice"></p></section>
  <p class="notice">This phone is paired to the desktop with an expiring high-entropy session token. Revoke it from the desktop when you are finished.</p>
  </main><script>
  const token=new URLSearchParams(location.search).get('token')||'';
  const api=(path,options={})=>fetch(path+'?token='+encodeURIComponent(token),options);
  const esc=(value)=>String(value??'').replace(/[<>&"]/g,'');
  async function command(name,value){try{const r=await api('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:name,args:value===undefined?[]:[value]})});if(!r.ok)throw new Error('Command rejected');}catch(error){document.querySelector('#error').textContent=error.message;}}
  async function refresh(){try{const r=await api('/api/state');if(!r.ok)throw new Error('Remote session unavailable');const s=await r.json(),p=s.player||{},radio=s.radio||{},items=s.queue?.queue||[];
  const live=Boolean(radio.active);document.querySelector('#status').textContent=live?'ON AIR':'CONNECTED';document.querySelector('#status').className='pill '+(live?'live':'');document.querySelector('#radioLabel').textContent=live?'LIVE':'OFF AIR';document.querySelector('#connection').textContent=radio.connectionStatus||'ready';
  document.querySelector('#now').textContent=p.currentItem?.title||'Nothing playing';document.querySelector('#artist').textContent=p.currentItem?.artist||'Load a track on Spider';document.querySelector('#volume').value=p.volumePercent??82;document.querySelector('#volumeOut').textContent=(p.volumePercent??82)+'%';document.querySelector('#crossfade').value=p.crossfade??4;document.querySelector('#crossfadeOut').textContent=(p.crossfade??4)+'s';document.querySelector('#listeners').textContent=radio.listenerCount??0;document.querySelector('#queueCount').textContent=items.length;document.querySelector('#recording').textContent=p.recording?'ON':'OFF';
  document.querySelector('#queue').innerHTML=items.map((x,i)=>'<button onclick="command(\\'playQueueIndex\\','+i+')">'+(i+1)+'. '+esc(x.title||'Unknown')+' <span class="muted">'+esc(x.artist||'')+'</span></button>').join('')||'<span class="muted">Queue is empty.</span>';document.querySelector('#error').textContent='';}catch(error){document.querySelector('#status').textContent='OFFLINE';document.querySelector('#status').className='pill live';document.querySelector('#error').textContent=error.message;}}
  refresh();setInterval(refresh,1000);
  </script></body></html>`;
}

async function startRemoteServer() {
  if (remoteServer && remoteSession) return remoteSession.info;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  remoteServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (Date.now() >= expiresAt || url.searchParams.get('token') !== token) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('This Spider Remote session is expired or invalid.');
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(remoteHtml());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        sendJson(response, 200, remoteSnapshot);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/command') {
        const body = await readJson(request, 16 * 1024);
        const allowed = new Set(['togglePlay', 'previous', 'next', 'setVolume', 'setCrossfade', 'playQueueIndex', 'startRadio', 'stopRadio', 'startRecording', 'stopRecording', 'stopAllBuffers', 'panicMute', 'clearPanicMute']);
        const command = String(body.command || '');
        if (!allowed.has(command) || !Array.isArray(body.args) || body.args.length > 1) {
          sendJson(response, 400, { ok: false, message: 'Unsupported remote command.' });
          return;
        }
        if (!sendRemoteCommand(command, body.args)) {
          sendJson(response, 503, { ok: false, message: 'Spider is not ready.' });
          return;
        }
        sendJson(response, 202, { ok: true });
        return;
      }
      response.writeHead(404);
      response.end();
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { ok: false, message: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    remoteServer.once('error', reject);
    remoteServer.listen(0, '0.0.0.0', resolve);
  });
  const address = remoteServer.address();
  const url = `http://${localAddress()}:${address.port}/?token=${token}`;
  remoteSession = {
    token,
    info: {
      active: true,
      url,
      expiresAt,
      qrDataUrl: await QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#13091c', light: '#f4eaff' } })
    }
  };
  return remoteSession.info;
}

async function stopRemoteServer() {
  if (remoteServer) await new Promise((resolve) => remoteServer.close(() => resolve()));
  remoteServer = undefined;
  remoteSession = undefined;
  return { active: false };
}

function writeDiagnostic(kind, value) {
  try {
    const directory = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(directory, { recursive: true });
    const line = `${new Date().toISOString()} [${kind}] ${value && value.stack ? value.stack : String(value)}\n`;
    fs.appendFileSync(path.join(directory, 'spider.log'), line, 'utf8');
  } catch { }
}

process.on('uncaughtException', (error) => writeDiagnostic('uncaughtException', error));
process.on('unhandledRejection', (error) => writeDiagnostic('unhandledRejection', error));

async function safeMediaEntries(paths) {
  let parseFile;
  try {
    ({ parseFile } = await import('music-metadata'));
  } catch {
    parseFile = null;
  }

  const entries = paths
    .filter((filePath) => typeof filePath === 'string' && fs.existsSync(filePath))
    .filter((filePath) => MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => {
      const stats = fs.statSync(filePath);
      return {
        id: crypto.randomUUID(),
        name: path.basename(filePath),
        path: filePath,
        url: pathToFileURL(filePath).href,
        size: stats.size,
        extension: path.extname(filePath).slice(1).toUpperCase()
      };
    });

  if (!parseFile) return entries;
  const concurrency = 6;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const entry = entries[index];
      try {
        const metadata = await parseFile(entry.path, { duration: true });
        entry.title = metadata.common.title || path.parse(entry.name).name;
        entry.artist = metadata.common.artist || '';
        entry.album = metadata.common.album || '';
        entry.duration = Number.isFinite(metadata.format.duration) ? metadata.format.duration : null;
        const picture = metadata.common.picture && metadata.common.picture[0];
        if (picture && picture.data && picture.data.length) {
          const artworkDirectory = path.join(app.getPath('userData'), 'artwork-cache');
          fs.mkdirSync(artworkDirectory, { recursive: true });
          const extension = picture.format === 'image/png' ? '.png' : '.jpg';
          const artworkPath = path.join(artworkDirectory, `${crypto.createHash('sha1').update(picture.data).digest('hex')}${extension}`);
          if (!fs.existsSync(artworkPath)) fs.writeFileSync(artworkPath, picture.data);
          entry.artwork = pathToFileURL(artworkPath).href;
        }
      } catch {
        entry.title = path.parse(entry.name).name;
      }
    }
  });
  await Promise.all(workers);
  return entries;
}

function mediaFilesInFolder(directory, maximum = 5000) {
  const files = [];
  const pending = [directory];
  while (pending.length && files.length < maximum) {
    const current = pending.pop();
    let children = [];
    try { children = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const fullPath = path.join(current, child.name);
      if (child.isDirectory()) pending.push(fullPath);
      else if (child.isFile() && MEDIA_EXTENSIONS.has(path.extname(child.name).toLowerCase())) files.push(fullPath);
      if (files.length >= maximum) break;
    }
  }
  return files;
}

function createMainWindow() {
  const smokeTest = process.env.SPIDER_SMOKE_TEST === '1';
  const hiddenIntegrationTest = process.env.SPIDER_TEST_HIDDEN === '1';
  mainWindow = new BrowserWindow({
    title: 'Spider Media Center',
    width: 1460,
    height: 900,
    minWidth: 1060,
    minHeight: 690,
    backgroundColor: '#08050d',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    autoHideMenuBar: true,
    show: !smokeTest && !hiddenIntegrationTest,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) writeDiagnostic('renderer-console', JSON.stringify({ level, message, line, sourceId }));
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeDiagnostic('did-fail-load', JSON.stringify({ errorCode, errorDescription, validatedURL }));
    if (!mainWindow.isDestroyed()) {
      dialog.showErrorBox('Spider Media Center could not start', `${errorDescription} (${errorCode})`);
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!smokeTest && !hiddenIntegrationTest) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeDiagnostic('render-process-gone', JSON.stringify(details));
    if (!mainWindow.isDestroyed()) void mainWindow.loadFile(PLAYER_FILE);
  });
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    if (destination !== pathToFileURL(PLAYER_FILE).href) event.preventDefault();
  });
  if (smokeTest) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const required = ['deckA', 'deckB', 'playButton', 'visualizerCanvas', 'visualizerModeButton', 'eqBands', 'stereoWidth', 'outputDevice', 'partyToggle', 'partyPin', 'queueSearch', 'qrImage', 'radioPanel', 'broadcastName', 'micInputDevice', 'micToggleButton', 'pushToTalkButton', 'micMeter', 'addFolderNav', 'miniPlayerButton'];
          const missing = required.filter((id) => !document.getElementById(id));
          const info = await window.spider.appInfo();
          document.querySelector('[data-panel="sound"]').click();
          const eqReady = document.querySelectorAll('#eqBands input').length === 31;
          const soundVisible = !document.getElementById('soundPanel').classList.contains('hidden');
          return { missing, eqReady, soundVisible, version: info.version };
        })()`);
        const ok = result.missing.length === 0 && result.eqReady && result.soundVisible;
        console.log(`SPIDER_SMOKE_TEST ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`);
        app.exit(ok ? 0 : 2);
      } catch (error) {
        console.error('SPIDER_SMOKE_TEST FAIL', error);
        app.exit(2);
      }
    });
  }
  mainWindow.webContents.once('did-finish-load', () => {
    if (!pendingOpenPaths.length) return;
    const paths = pendingOpenPaths;
    pendingOpenPaths = [];
    void safeMediaEntries(paths).then((entries) => mainWindow.webContents.send('media:open', entries));
  });
  void mainWindow.loadFile(PLAYER_FILE);
}

function openService(serviceKey, query = '') {
  const service = SERVICES[serviceKey];
  if (!service) throw new Error('Unknown service');

  const search = String(query || '').trim();
  const destination = search && serviceKey === 'spotify'
    ? `https://open.spotify.com/search/${encodeURIComponent(search)}`
    : search && serviceKey === 'appleMusic'
      ? `https://music.apple.com/us/search?term=${encodeURIComponent(search)}`
      : service.url;
  const existing = serviceWindows.get(serviceKey);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    if (search) void existing.loadURL(destination);
    return;
  }

  const serviceWindow = new BrowserWindow({
    title: `${service.title} · Spider Media Center`,
    width: 1240,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#08050d',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: `persist:spider-${serviceKey}`
    }
  });

  serviceWindow.setMenu(null);
  serviceWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  serviceWindow.on('closed', () => serviceWindows.delete(serviceKey));
  serviceWindows.set(serviceKey, serviceWindow);
  void serviceWindow.loadURL(destination);
}

function localAddress() {
  const candidates = [];
  for (const records of Object.values(os.networkInterfaces())) {
    for (const record of records || []) {
      if (record.family === 'IPv4' && !record.internal) candidates.push(record.address);
    }
  }
  return candidates.find((value) => value.startsWith('192.168.')) ||
    candidates.find((value) => value.startsWith('10.')) ||
    candidates[0] || '127.0.0.1';
}

function cleanFilename(value) {
  return path.basename(String(value || 'shared-file'))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 180) || 'shared-file';
}

function uniqueDestination(directory, name) {
  const parsed = path.parse(name);
  let destination = path.join(directory, name);
  let counter = 2;
  while (fs.existsSync(destination)) {
    destination = path.join(directory, `${parsed.name} (${counter})${parsed.ext}`);
    counter += 1;
  }
  return destination;
}

function readJson(request, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        reject(new Error('Request too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function portalHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spider Nearby</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;--p:#a855f7;--b:#09060f;--card:#181020}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#321050 0,transparent 38rem),var(--b);color:#fff;min-height:100vh;padding:22px}
main{max-width:680px;margin:auto}.brand{display:flex;gap:14px;align-items:center;margin:10px 0 24px}.mark{width:48px;height:48px;border:1px solid #a855f7;border-radius:16px;display:grid;place-items:center;font-size:26px;background:#260c3d;box-shadow:0 0 30px #7e22ce66}
h1{font-size:21px;margin:0;letter-spacing:.08em}small,p{color:#bcaec9}.card{background:#181020e8;border:1px solid #a855f744;border-radius:18px;padding:18px;margin:13px 0;box-shadow:0 14px 50px #0007}
h2{font-size:16px;margin:0 0 13px}input,button{font:inherit;border-radius:11px;padding:11px 13px}input{width:100%;color:#fff;background:#0e0913;border:1px solid #a855f755;margin:6px 0}button{border:0;color:white;background:linear-gradient(135deg,#a855f7,#6d28d9);font-weight:700;margin-top:8px}.row{display:flex;gap:8px}.row input{flex:1}.row button{white-space:nowrap}ul{list-style:none;padding:0;margin:0}li{padding:10px 0;border-bottom:1px solid #ffffff12}a{color:#d8b4fe}.status{min-height:22px;color:#c4b5fd;font-size:13px}.tag{font-size:11px;background:#6d28d955;border:1px solid #a855f755;padding:3px 7px;border-radius:99px}
</style></head><body><main><div class="brand"><div class="mark">🕷</div><div><h1>SPIDER NEARBY</h1><small>Private transfer & party requests</small></div></div>
<section class="card"><h2>Send a file to this PC</h2><input id="upload" type="file" multiple><div class="row"><button id="send">Send securely</button><button id="cancel" style="display:none;background:#352a3a">Cancel</button></div><p class="status" id="uploadStatus"></p></section>
<section class="card"><h2>Request a song</h2><input id="guest" maxlength="40" placeholder="Your name (optional)"><input id="pin" maxlength="8" inputmode="numeric" placeholder="Party PIN (if required)"><div class="row"><input id="song" maxlength="100" placeholder="Song"><input id="artist" maxlength="100" placeholder="Artist"></div><button id="request">Send request</button><p class="status" id="requestStatus"></p></section>
<section class="card"><h2>Live party queue <span class="tag" id="partyTag">OFF</span></h2><ul id="queue"><li>Waiting for the host…</li></ul></section>
<section class="card"><h2>Files shared by the host</h2><ul id="files"><li>No shared files yet.</li></ul></section>
</main><script>
const token=new URLSearchParams(location.search).get('token')||'';const api=(path,options={})=>fetch(path+(path.includes('?')?'&':'?')+'token='+encodeURIComponent(token),options);
const esc=(v)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function refresh(){try{const state=await api('/api/state').then(r=>r.json());document.querySelector('#partyTag').textContent=state.party.enabled?'LIVE':'OFF';document.querySelector('#pin').style.display=state.requiresPin?'block':'none';document.querySelector('#queue').innerHTML=state.party.queue.length?state.party.queue.map((x,i)=>'<li><b>'+(i+1)+'. '+esc(x.title)+'</b>'+(x.artist?' · '+esc(x.artist):'')+(state.voting?'<button onclick="vote(\''+encodeURIComponent(x.id)+'\')">▲ '+(x.votes||0)+'</button>':'')+'</li>').join(''):'<li>Queue is empty.</li>';document.querySelector('#files').innerHTML=state.files.length?state.files.map(x=>'<li><a href="/file/'+encodeURIComponent(x.id)+'?token='+encodeURIComponent(token)+'">'+esc(x.name)+'</a> · '+Math.ceil(x.size/1024/1024)+' MB</li>').join(''):'<li>No shared files yet.</li>'}catch{}}
async function vote(id){await api('/api/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:decodeURIComponent(id),pin:document.querySelector('#pin').value.trim()})});refresh()}
document.querySelector('#request').onclick=async()=>{const song=document.querySelector('#song').value.trim();if(!song)return;const body={guest:document.querySelector('#guest').value.trim(),pin:document.querySelector('#pin').value.trim(),song,artist:document.querySelector('#artist').value.trim()};const result=await api('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data={};try{data=await result.json()}catch{}document.querySelector('#requestStatus').textContent=result.ok?'Request sent to the DJ.':(data.message||'Could not send request.');if(result.ok)document.querySelector('#song').value=''};
let activeUpload=null;function sendFile(file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();activeUpload=xhr;xhr.open('POST','/api/upload?name='+encodeURIComponent(file.name)+'&token='+encodeURIComponent(token));xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');xhr.setRequestHeader('X-File-Size',String(file.size));xhr.upload.onprogress=e=>{if(e.lengthComputable)document.querySelector('#uploadStatus').textContent='Sending '+file.name+' · '+Math.round(e.loaded/e.total*100)+'%'};xhr.onload=()=>xhr.status<300?resolve():reject(new Error('Transfer failed'));xhr.onerror=()=>reject(new Error('Transfer failed'));xhr.onabort=()=>reject(new Error('Transfer canceled'));xhr.send(file)})}
document.querySelector('#cancel').onclick=()=>activeUpload&&activeUpload.abort();document.querySelector('#send').onclick=async()=>{const files=[...document.querySelector('#upload').files];document.querySelector('#cancel').style.display='block';try{for(const file of files)await sendFile(file);document.querySelector('#uploadStatus').textContent=files.length+' file(s) sent.';document.querySelector('#upload').value=''}catch(error){document.querySelector('#uploadStatus').textContent=error.message}finally{activeUpload=null;document.querySelector('#cancel').style.display='none'}};
refresh();setInterval(refresh,2000);
</script></body></html>`;
}

async function startNearbyServer() {
  if (nearbyServer && nearbyInfo) return nearbyInfo;

  const token = crypto.randomBytes(18).toString('hex');
  nearbyServer = http.createServer(async (request, response) => {
    try {
      const base = `http://${request.headers.host || 'localhost'}`;
      const url = new URL(request.url, base);
      if (url.searchParams.get('token') !== token) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('This Spider Nearby link is not active.');
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(portalHtml());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/state') {
        sendJson(response, 200, {
          party: {
            ...partySnapshot,
            queue: partySnapshot.queue.map((item) => ({ ...item, votes: partyVotes.get(item.id)?.size || 0 }))
          },
          requiresPin: Boolean(partyConfig.pin),
          voting: partyConfig.voting,
          files: [...sharedFiles.values()].map(({ id, name, size }) => ({ id, name, size }))
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/request') {
        const body = await readJson(request);
        const song = String(body.song || '').trim().slice(0, 100);
        const artist = String(body.artist || '').trim().slice(0, 100);
        if (partyConfig.pin && String(body.pin || '') !== partyConfig.pin) {
          sendJson(response, 403, { ok: false, message: 'The Party PIN is incorrect.' });
          return;
        }
        if (!partySnapshot.enabled || !song) {
          sendJson(response, 409, { ok: false, message: 'Party DJ Mode is not accepting requests.' });
          return;
        }
        if (guestRequests.length >= partyConfig.requestLimit) {
          sendJson(response, 429, { ok: false, message: 'The request list is full.' });
          return;
        }
        const requestKey = `${song}|${artist}`.toLocaleLowerCase();
        const duplicate = guestRequests.some((item) => `${item.song}|${item.artist}`.toLocaleLowerCase() === requestKey) ||
          partySnapshot.queue.some((item) => `${item.title}|${item.artist || ''}`.toLocaleLowerCase() === requestKey);
        if (duplicate) {
          sendJson(response, 409, { ok: false, message: 'That song is already requested or queued.' });
          return;
        }
        const item = {
          id: crypto.randomUUID(),
          guest: String(body.guest || 'Guest').trim().slice(0, 40) || 'Guest',
          song,
          artist,
          createdAt: Date.now()
        };
        guestRequests.push(item);
        sendNearbyEvent({ type: 'guest-request', item });
        sendJson(response, 201, { ok: true, id: item.id });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/vote') {
        const body = await readJson(request);
        if (!partyConfig.voting) {
          sendJson(response, 409, { ok: false, message: 'Voting is off.' });
          return;
        }
        if (partyConfig.pin && String(body.pin || '') !== partyConfig.pin) {
          sendJson(response, 403, { ok: false, message: 'The Party PIN is incorrect.' });
          return;
        }
        const id = String(body.id || '');
        if (!partySnapshot.queue.some((item) => item.id === id)) {
          sendJson(response, 404, { ok: false });
          return;
        }
        if (!partyVotes.has(id)) partyVotes.set(id, new Set());
        partyVotes.get(id).add(request.socket.remoteAddress || 'guest');
        sendNearbyEvent({ type: 'party-vote', id, votes: partyVotes.get(id).size });
        sendJson(response, 200, { ok: true, votes: partyVotes.get(id).size });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/upload') {
        const declaredSize = Number(request.headers['x-file-size'] || request.headers['content-length'] || 0);
        if (declaredSize > MAX_UPLOAD_BYTES) {
          sendJson(response, 413, { ok: false, message: 'File is larger than 2 GB.' });
          return;
        }
        const receivedDirectory = path.join(app.getPath('downloads'), 'Spider Received');
        fs.mkdirSync(receivedDirectory, { recursive: true });
        const name = cleanFilename(url.searchParams.get('name'));
        const destination = uniqueDestination(receivedDirectory, name);
        const output = fs.createWriteStream(destination, { flags: 'wx' });
        const transferId = crypto.randomUUID();
        sendNearbyEvent({ type: 'transfer-start', id: transferId, name, size: declaredSize, device: request.socket.remoteAddress || 'Nearby device' });
        let received = 0;
        let lastProgress = -1;
        request.on('data', (chunk) => {
          received += chunk.length;
          const progress = declaredSize ? Math.floor(received / declaredSize * 20) * 5 : 0;
          if (progress !== lastProgress) {
            lastProgress = progress;
            sendNearbyEvent({ type: 'transfer-progress', id: transferId, name, received, size: declaredSize, progress });
          }
          if (received > MAX_UPLOAD_BYTES) request.destroy(new Error('File is larger than 2 GB.'));
        });
        request.pipe(output);
        output.on('finish', async () => {
          const [entry] = await safeMediaEntries([destination]);
          sendNearbyEvent({ type: 'transfer-complete', id: transferId, name: path.basename(destination) });
          sendNearbyEvent({ type: 'file-received', name: path.basename(destination), path: destination, media: entry || null });
          sendJson(response, 201, { ok: true, name: path.basename(destination) });
        });
        output.on('error', (error) => {
          sendNearbyEvent({ type: 'transfer-error', id: transferId, name, message: error.message });
          if (!response.headersSent) sendJson(response, 500, { ok: false, message: error.message });
        });
        request.on('aborted', () => {
          output.destroy();
          try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch { }
          sendNearbyEvent({ type: 'transfer-error', id: transferId, name, message: 'Canceled by sender' });
        });
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/file/')) {
        const id = decodeURIComponent(url.pathname.slice('/file/'.length));
        const item = sharedFiles.get(id);
        if (!item || !fs.existsSync(item.path)) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': item.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`
        });
        fs.createReadStream(item.path).pipe(response);
        return;
      }

      response.writeHead(404);
      response.end();
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { ok: false, message: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    nearbyServer.once('error', reject);
    nearbyServer.listen(0, '0.0.0.0', resolve);
  });

  const address = nearbyServer.address();
  const url = `http://${localAddress()}:${address.port}/?token=${token}`;
  nearbyInfo = {
    active: true,
    url,
    code: token.slice(0, 6).toUpperCase(),
    qrDataUrl: await QRCode.toDataURL(url, {
      width: 360,
      margin: 2,
      color: { dark: '#13091cff', light: '#f4eaffff' }
    })
  };
  return nearbyInfo;
}

// IPC: save recording bytes to a user-accessible folder
ipcMain.handle('recording:save', async (_event, name, bytes) => {
  try {
    const recordingsDir = path.join(app.getPath('music') || app.getPath('userData'), 'Spider Recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });
    const destination = uniqueDestination(recordingsDir, cleanFilename(name));
    await fs.promises.writeFile(destination, Buffer.from(bytes));
    return { ok: true, path: destination };
  } catch (error) {
    writeDiagnostic('recordingSaveError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

// Streaming recording: start/append/finish
const activeRecordingStreams = new Map();
ipcMain.handle('recording:start', async (_event, tempName) => {
  try {
    const recordingsTemp = path.join(app.getPath('temp') || app.getPath('userData'), 'spider-recordings');
    fs.mkdirSync(recordingsTemp, { recursive: true });
    const id = crypto.randomUUID();
    const tempFile = path.join(recordingsTemp, `${id}.part`);
    const stream = fs.createWriteStream(tempFile, { flags: 'wx' });
    activeRecordingStreams.set(id, { stream, tempFile });
    return { ok: true, id };
  } catch (error) {
    writeDiagnostic('recordingStartError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('recording:append', async (_event, id, bytes) => {
  try {
    const rec = activeRecordingStreams.get(id);
    if (!rec) return { ok: false, error: 'unknown id' };
    await new Promise((resolve, reject) => {
      rec.stream.write(Buffer.from(bytes), (err) => err ? reject(err) : resolve());
    });
    return { ok: true };
  } catch (error) {
    writeDiagnostic('recordingAppendError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('recording:finish', async (_event, id, finalName) => {
  try {
    const rec = activeRecordingStreams.get(id);
    if (!rec) return { ok: false, error: 'unknown id' };
    await new Promise((resolve) => rec.stream.end(resolve));
    activeRecordingStreams.delete(id);
    const recordingsDir = path.join(app.getPath('music') || app.getPath('userData'), 'Spider Recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });
    const destination = uniqueDestination(recordingsDir, cleanFilename(finalName));
    await fs.promises.rename(rec.tempFile, destination);
    return { ok: true, path: destination };
  } catch (error) {
    writeDiagnostic('recordingFinishError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

// Reveal a recording in the platform file manager
ipcMain.handle('recording:show', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'file-not-found' };
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (error) {
    writeDiagnostic('recordingShowError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

// Get recording metadata (size and duration when possible)
ipcMain.handle('recording:info', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'file-not-found' };
    const stats = await fs.promises.stat(filePath);
    const result = { ok: true, size: Number(stats.size || 0) };
    try {
      let parseFile;
      try { ({ parseFile } = await import('music-metadata')); } catch { parseFile = null; }
      if (parseFile) {
        try {
          const meta = await parseFile(filePath, { duration: true });
          if (meta && meta.format && Number.isFinite(meta.format.duration)) result.duration = Number(meta.format.duration);
        } catch { }
      }
    } catch { }
    return result;
  } catch (error) {
    writeDiagnostic('recordingInfoError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

// Open a recording with the system default application
ipcMain.handle('recording:open', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'file-not-found' };
    const res = await shell.openPath(filePath);
    if (res) return { ok: false, error: res };
    return { ok: true };
  } catch (error) {
    writeDiagnostic('recordingOpenError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

// Delete a recording file
ipcMain.handle('recording:delete', async (_event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'file-not-found' };
    await fs.promises.unlink(filePath);
    return { ok: true };
  } catch (error) {
    writeDiagnostic('recordingDeleteError', error);
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('speech:synthesize', async (_event, text) => {
  const phrase = String(text || '').trim().slice(0, 240);
  if (!phrase) return { ok: false, error: 'Speech text is empty' };

  const outputPath = path.join(
    app.getPath('temp'),
    `spider-speech-${crypto.randomUUID()}.wav`
  );

  try {
    if (process.platform === 'linux') {
      const ttsBinary = fs.existsSync('/usr/bin/espeak-ng')
        ? '/usr/bin/espeak-ng'
        : 'espeak-ng';

      await new Promise((resolve, reject) => {
        const child = spawn(
          ttsBinary,
          ['-w', outputPath, phrase],
          { stdio: ['ignore', 'ignore', 'pipe'] }
        );

        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          code === 0
            ? resolve()
            : reject(new Error(stderr || `Speech synthesis exited with code ${code}`));
        });
      });
    } else if (process.platform === 'win32') {
      const script = `
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $synth.Rate = 0
        $synth.Volume = 100
        $synth.SetOutputToWaveFile('${outputPath.replace(/'/g, "''")}')
        $synth.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(phrase, 'utf8').toString('base64')}')))
        $synth.Dispose()
      `;

      const encoded = Buffer.from(script, 'utf16le').toString('base64');

      await new Promise((resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
          { windowsHide: true }
        );

        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
          code === 0
            ? resolve()
            : reject(new Error(stderr || `Speech synthesis exited with code ${code}`));
        });
      });
    } else {
      throw new Error('Speech synthesis is not configured for this platform.');
    }

    const bytes = await fs.promises.readFile(outputPath);
    return {
      ok: true,
      dataUrl: `data:audio/wav;base64,${bytes.toString('base64')}`
    };
  } finally {
    await fs.promises.rm(outputPath, { force: true });
  }
});

async function stopNearbyServer() {
  if (!nearbyServer) return { active: false };
  await new Promise((resolve) => nearbyServer.close(resolve));
  nearbyServer = undefined;
  nearbyInfo = undefined;
  sharedFiles.clear();
  return { active: false };
}

function sendRadioEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('radio:event', payload);
}

function radioListenerHtml(token) {
  const title = String(radioState.name || 'Spider Radio').replace(/[&<>"']/g, (value) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[value]);
  const dj = String(radioState.dj || '').replace(/[&<>"']/g, (value) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[value]);
  const description = String(radioState.description || '').replace(/[&<>"']/g, (value) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[value]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#120a19"><title>${title}</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));color:#fff;background:radial-gradient(circle at 50% 15%,#51127d 0,transparent 34rem),#07040b}.station{width:min(540px,100%);padding:28px;border:1px solid #b45cff55;border-radius:26px;background:#120a19e8;box-shadow:0 30px 100px #000b;text-align:center}.logo{width:130px;height:130px;border-radius:32px;object-fit:cover;filter:drop-shadow(0 0 35px #a855f766)}.live{display:inline-flex;align-items:center;gap:7px;margin:15px 0 8px;padding:6px 10px;border:1px solid #54e18155;border-radius:99px;color:#7cf2a2;font-size:10px;font-weight:800;letter-spacing:.14em}.live i{width:7px;height:7px;border-radius:50%;background:#50e983;box-shadow:0 0 10px #50e983}h1{margin:3px 0;font-size:clamp(24px,8vw,34px);letter-spacing:.04em;overflow-wrap:anywhere}.dj,.description{color:#ad9ab8}.dj{margin:7px 0;font-size:12px}.description{line-height:1.6;font-size:13px}.now{margin:22px 0 16px;padding:16px;border:1px solid #ffffff12;border-radius:15px;background:#09050d}.now small{display:block;color:#866e94;font-size:9px;letter-spacing:.18em}.now b{display:block;margin-top:7px;font-size:16px}.listen{width:100%;min-height:56px;border:1px solid #c979ff;border-radius:14px;color:#fff;background:linear-gradient(135deg,#a93ef3,#64139b);box-shadow:0 10px 35px #8f27d744;font-size:15px;font-weight:900;letter-spacing:.09em;cursor:pointer}.listen:disabled{opacity:.72;cursor:wait}audio{display:none;width:100%;margin-top:13px;accent-color:#aa4df0}.connection{min-height:18px;margin:11px 0 0;color:#ac91ba;font-size:11px}.listeners{margin-top:12px;color:#74667c;font-size:10px}.legal{margin-top:18px;color:#594e5f;font-size:9px}@media(max-width:480px){.station{padding:22px 18px;border-radius:22px}.logo{width:108px;height:108px;border-radius:26px}.now{margin-top:17px}}</style></head><body><main class="station"><img class="logo" src="/logo/${token}" alt="Spider Media Center"><div><span class="live"><i></i> LIVE ON SPIDER RADIO</span></div><h1>${title}</h1><p class="dj">${dj ? `with ${dj}` : 'Live broadcast'}</p><p class="description">${description}</p><section class="now"><small>NOW PLAYING</small><b id="nowPlaying">Waiting for the DJ…</b></section><button class="listen" id="listenButton" type="button">▶ TAP TO LISTEN</button><audio id="player" controls playsinline preload="none"></audio><p class="connection" id="connection">Ready on iPhone and Android</p><p class="listeners" id="listeners">Station is live</p><p class="legal">Listen only where permitted. Broadcasters are responsible for music and performance rights.</p></main><script>
  const player=document.querySelector('#player'),button=document.querySelector('#listenButton'),connection=document.querySelector('#connection');button.addEventListener('click',async()=>{button.disabled=true;button.textContent='CONNECTING…';connection.textContent='Connecting to the live broadcast…';player.src='/stream/${token}?t='+Date.now();player.load();try{await player.play()}catch(error){button.disabled=false;button.textContent='▶ TRY AGAIN';connection.textContent='Tap again to allow audio on this device.'}});player.addEventListener('playing',()=>{button.style.display='none';player.style.display='block';connection.textContent='Live audio connected'});player.addEventListener('waiting',()=>{connection.textContent='Buffering live audio…'});player.addEventListener('stalled',()=>{connection.textContent='The signal paused. Tap Try Again if it does not resume.'});player.addEventListener('error',()=>{button.style.display='block';button.disabled=false;button.textContent='↻ TRY AGAIN';player.style.display='none';connection.textContent='Could not connect. Ask the DJ for a fresh broadcast link.'});
  async function update(){try{const state=await fetch('/state/${token}',{cache:'no-store'}).then(r=>r.json());document.querySelector('#nowPlaying').textContent=state.nowPlaying?(state.nowPlaying.title+(state.nowPlaying.artist?' · '+state.nowPlaying.artist:'')):'Waiting for the DJ…';document.querySelector('#listeners').textContent=state.listenerCount+' listener'+(state.listenerCount===1?'':'s')+' connected'}catch{}}update();setInterval(update,2500);
  </script></body></html>`;
}

async function stopRadioServer() {
  for (const [id, response] of radioListeners) {
    sendRadioEvent({ type: 'listener-disconnected', id });
    try { response.end(); } catch { }
  }
  radioListeners.clear();
  if (radioTunnel) {
    radioTunnel.kill();
    radioTunnel = undefined;
  }
  if (radioServer) {
    const server = radioServer;
    radioServer = undefined;
    await new Promise((resolve) => server.close(resolve));
  }
  radioState = { active: false, listenerCount: 0 };
  sendRadioEvent({ type: 'stopped' });
  return radioState;
}

async function startRadioServer(profile) {
  await stopRadioServer();
  if (!fs.existsSync(CLOUDFLARED_PATH)) throw new Error('The Spider public relay is not installed.');
  const token = crypto.randomBytes(20).toString('hex');
  radioState = {
    active: true,
    name: String(profile && profile.name || 'Spider Radio').trim().slice(0, 80) || 'Spider Radio',
    dj: String(profile && profile.dj || '').trim().slice(0, 60),
    description: String(profile && profile.description || '').trim().slice(0, 220),
    token,
    listenerCount: 0,
    nowPlaying: null,
    startedAt: Date.now(),
    publicUrl: null,
    mimeType: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      .includes(profile && profile.mimeType) ? profile.mimeType : 'audio/mp4;codecs=mp4a.40.2',
    qrDataUrl: ''
  };

  radioServer = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === `/${token}`) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(radioListenerHtml(token));
      return;
    }
    if (request.method === 'GET' && url.pathname === `/logo/${token}`) {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      fs.createReadStream(ICON_PATH).pipe(response);
      return;
    }
    if (request.method === 'GET' && url.pathname === `/state/${token}`) {
      sendJson(response, 200, {
        name: radioState.name,
        dj: radioState.dj,
        description: radioState.description,
        listenerCount: radioListeners.size,
        nowPlaying: radioState.nowPlaying
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === `/stream/${token}`) {
      if (radioListeners.size >= 30) {
        response.writeHead(503, { 'Content-Type': 'text/plain' });
        response.end('This station is at its listener limit.');
        return;
      }
      const id = crypto.randomUUID();
      const contentType = radioState.mimeType.startsWith('audio/mp4')
        ? 'audio/mp4; codecs="mp4a.40.2"'
        : 'audio/webm; codecs=opus';
      response.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Connection': 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no',
        'Content-Encoding': 'identity',
        'Accept-Ranges': 'none'
      });
      if (response.socket) response.socket.setNoDelay(true);
      response.flushHeaders();
      radioListeners.set(id, response);
      radioState.listenerCount = radioListeners.size;
      sendRadioEvent({ type: 'listener-connected', id, listenerCount: radioListeners.size });
      request.on('close', () => {
        if (!radioListeners.delete(id)) return;
        radioState.listenerCount = radioListeners.size;
        sendRadioEvent({ type: 'listener-disconnected', id, listenerCount: radioListeners.size });
      });
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Spider Radio broadcast not found.');
  });

  await new Promise((resolve, reject) => {
    radioServer.once('error', reject);
    radioServer.listen(0, '127.0.0.1', resolve);
  });
  const port = radioServer.address().port;
  if (process.env.SPIDER_RADIO_TEST_LOCAL === '1') {
    radioState.publicUrl = `http://127.0.0.1:${port}/${token}`;
    radioState.qrDataUrl = await QRCode.toDataURL(radioState.publicUrl, { width: 360, margin: 1, color: { dark: '#261033', light: '#f2e5ff' } });
    sendRadioEvent({ type: 'live', state: { ...radioState, token: undefined } });
    return { ...radioState, token: undefined };
  }
  radioTunnel = spawn(CLOUDFLARED_PATH, [
    'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

  const publicBase = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The public relay timed out. Check the internet connection.'));
    }, 45000);
    const inspect = (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(match[0]);
    };
    radioTunnel.stdout.on('data', inspect);
    radioTunnel.stderr.on('data', inspect);
    radioTunnel.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    radioTunnel.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`The public relay stopped with code ${code}.`));
    });
  }).catch(async (error) => {
    await stopRadioServer();
    throw error;
  });

  radioState.publicUrl = `${publicBase}/${token}`;
  radioState.qrDataUrl = await QRCode.toDataURL(radioState.publicUrl, { width: 360, margin: 1, color: { dark: '#261033', light: '#f2e5ff' } });
  sendRadioEvent({ type: 'live', state: { ...radioState, token: undefined } });
  return { ...radioState, token: undefined };
}

ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('media:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add media to Spider',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio and video', extensions: [...MEDIA_EXTENSIONS].map((item) => item.slice(1)) },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : await safeMediaEntries(result.filePaths);
});
ipcMain.handle('media:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add a media folder to Spider',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return [];
  return await safeMediaEntries(mediaFilesInFolder(result.filePaths[0]));
});
ipcMain.handle('media:from-paths', async (_event, paths) => await safeMediaEntries(Array.isArray(paths) ? paths : []));
ipcMain.handle('service:open', (_event, service, query) => {
  openService(service, query);
  return { ok: true };
});
ipcMain.handle('devices:open-bluetooth', async () => {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:bluetooth');
    return { ok: true };
  }

  if (process.platform === 'linux') {
    const launchers = [
      ['/usr/bin/systemsettings', ['kcm_bluetooth']],
      ['/usr/bin/systemsettings5', ['kcm_bluetooth']],
      ['/usr/bin/bluedevil-wizard', []],
      ['/usr/bin/blueman-manager', []]
    ];

    const launcher = launchers.find(([binary]) => fs.existsSync(binary));

    if (!launcher) {
      return {
        ok: false,
        error: 'No Linux Bluetooth settings application was found.'
      };
    }

    const child = spawn(
      launcher[0],
      launcher[1],
      { detached: true, stdio: 'ignore' }
    );

    child.unref();
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Bluetooth settings are not configured for this platform.'
  };
});
ipcMain.handle('nearby:start', () => startNearbyServer());
ipcMain.handle('nearby:stop', () => stopNearbyServer());
ipcMain.handle('nearby:info', () => nearbyInfo || { active: false });
ipcMain.handle('nearby:choose-files', async () => {
  await startNearbyServer();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Share files from this PC',
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled) return [];
  const added = result.filePaths.map((filePath) => {
    const stats = fs.statSync(filePath);
    const item = { id: crypto.randomUUID(), path: filePath, name: path.basename(filePath), size: stats.size };
    sharedFiles.set(item.id, item);
    return { id: item.id, name: item.name, size: item.size };
  });
  sendNearbyEvent({ type: 'shares-updated', files: added });
  return added;
});
ipcMain.handle('nearby:remove-file', (_event, id) => ({ removed: sharedFiles.delete(id) }));
ipcMain.handle('remote:start', () => startRemoteServer());
ipcMain.handle('remote:stop', () => stopRemoteServer());
ipcMain.handle('remote:info', () => remoteSession ? remoteSession.info : { active: false });
ipcMain.handle('remote:revoke', () => stopRemoteServer());
ipcMain.on('remote:state', (_event, snapshot) => {
  remoteSnapshot = {
    player: snapshot && snapshot.player ? snapshot.player : null,
    queue: snapshot && snapshot.queue ? snapshot.queue : null,
    radio: snapshot && snapshot.radio ? snapshot.radio : null,
    updatedAt: Date.now()
  };
});
ipcMain.on('remote:command-result', () => { });
ipcMain.handle('party:set-state', (_event, state) => {
  partySnapshot = {
    enabled: Boolean(state && state.enabled),
    queue: Array.isArray(state && state.queue) ? state.queue.slice(0, 200) : [],
    nowPlaying: state && state.nowPlaying ? state.nowPlaying : null
  };
  partyConfig = {
    pin: String(state && state.pin || '').replace(/\D/g, '').slice(0, 8),
    requestLimit: Math.max(5, Math.min(100, Number(state && state.requestLimit) || 40)),
    voting: state && state.voting !== false
  };
  return { ok: true };
});
ipcMain.handle('party:resolve-request', (_event, id, resolution) => {
  const index = guestRequests.findIndex((item) => item.id === id);
  if (index === -1) return { ok: false };
  const [item] = guestRequests.splice(index, 1);
  return { ok: true, item, resolution };
});
ipcMain.handle('radio:start', (_event, profile) => startRadioServer(profile));
ipcMain.handle('radio:stop', () => stopRadioServer());
ipcMain.handle('radio:update', (_event, metadata) => {
  if (!radioState.active) return { ok: false };
  radioState.nowPlaying = metadata && metadata.title ? {
    title: String(metadata.title).slice(0, 140),
    artist: String(metadata.artist || '').slice(0, 140)
  } : null;
  return { ok: true };
});
ipcMain.on('radio:chunk', (_event, listenerId, bytes) => {
  const response = radioListeners.get(listenerId);
  if (!response || response.destroyed || response.writableEnded) return;
  try { response.write(Buffer.from(bytes)); } catch { }
});
ipcMain.handle('window:set-mini', (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (enabled) {
    regularWindowBounds = mainWindow.getBounds();
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setBounds({ width: 430, height: 700 });
    mainWindow.setMinimumSize(390, 560);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(1060, 690);
    if (regularWindowBounds) mainWindow.setBounds(regularWindowBounds);
  }
  return { ok: true, enabled: Boolean(enabled) };
});
const LINUX_AUTOSTART_FILE = path.join(
  os.homedir(),
  '.config',
  'autostart',
  'spider-media-center.desktop'
);

function linuxAutostartContents() {
  const executable = process.execPath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Spider Media Center',
    'Comment=Start Spider Media Center at login',
    `Exec="${executable}"`,
    `Icon=${ICON_PATH}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n');
}

ipcMain.handle('app:get-startup', () => {
  if (process.platform === 'linux') {
    return fs.existsSync(LINUX_AUTOSTART_FILE);
  }

  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:set-startup', async (_event, enabled) => {
  if (process.platform === 'linux') {
    if (enabled) {
      await fs.promises.mkdir(
        path.dirname(LINUX_AUTOSTART_FILE),
        { recursive: true }
      );

      await fs.promises.writeFile(
        LINUX_AUTOSTART_FILE,
        linuxAutostartContents(),
        { mode: 0o644 }
      );
    } else {
      await fs.promises.rm(
        LINUX_AUTOSTART_FILE,
        { force: true }
      );
    }

    return fs.existsSync(LINUX_AUTOSTART_FILE);
  }

  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath
  });

  return app.getLoginItemSettings().openAtLogin;
});

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    const trustedWindow = Boolean(mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents);
    return trustedWindow && ['fullscreen', 'pointerLock', 'speaker-selection', 'media'].includes(permission);
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const trustedWindow = Boolean(mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents);
    callback(trustedWindow && ['fullscreen', 'pointerLock', 'speaker-selection', 'media'].includes(permission));
  });
  createMainWindow();
  // Register desktop media keys when supported by Electron.
  // Wayland/compositor policy may still restrict global shortcuts.
  try {
    if (process.platform === 'win32' || process.platform === 'linux') {
      const register = (accelerator, action) => {
        try {
          globalShortcut.register(accelerator, () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:key', action);
          });
        } catch {
          // best-effort
        }
      };

      register('MediaPlayPause', 'playpause');
      register('MediaNextTrack', 'next');
      register('MediaPreviousTrack', 'previous');
      register('MediaStop', 'stop');
    }
  } catch (e) { }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  if (nearbyServer) nearbyServer.close();
  if (radioTunnel) radioTunnel.kill();
  if (radioServer) radioServer.close();
  try { globalShortcut.unregisterAll(); } catch { }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
