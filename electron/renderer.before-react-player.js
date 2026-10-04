const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const decks = [$('#deckA'), $('#deckB')];
const state = {
  library: [],
  queue: [],
  currentIndex: -1,
  activeDeck: 0,
  transitioning: false,
  crossfadeTriggered: false,
  shuffle: false,
  repeat: 'off',
  masterVolume: 0.82,
  muted: false,
  partyEnabled: false,
  partyPin: '',
  partyRequestLimit: 40,
  partyVoting: true,
  guestRequests: [],
  nearby: { active: false },
  sharedFiles: [],
  audioContext: null,
  audioGraphs: [],
  eqEnabled: true,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  stereoWidth: 1,
  stereoBalance: 0,
  outputDeviceId: 'default',
  visualizerMode: 'web',
  queueSearch: '',
  miniPlayer: false,
  radio: { active: false, listenerCount: 0, publicUrl: '', profiles: [], recorders: new Map() },
  broadcastDestination: null,
  djMic: {
    stream: null,
    source: null,
    gainNode: null,
    analyser: null,
    levelData: null,
    inputDeviceId: 'default',
    gain: 1,
    duckDb: 14,
    ducking: true,
    duckingActive: false,
    pushToTalk: false,
    enabled: false,
    live: false,
    monitor: false
  },
  transfers: new Map()
};

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const IDLE_FREQUENCY_DATA = new Uint8Array(1024);
const IDLE_WAVE_DATA = new Uint8Array(2048).fill(128);
const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 1, 0, 0, 1, 1, 1],
  vocal: [-2, -1, 0, 1, 3, 4, 3, 2, 1, 0],
  rock: [4, 3, 1, -1, -2, 1, 3, 4, 4, 3],
  night: [2, 2, 1, 0, -1, -1, 0, 1, 1, 1]
};
const PERSISTENCE_KEY = 'spider-player-state-v2';
let saveTimer;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(PERSISTENCE_KEY, JSON.stringify({
        library: state.library,
        queue: state.queue,
        shuffle: state.shuffle,
        repeat: state.repeat,
        masterVolume: state.masterVolume,
        crossfade: Number($('#crossfade').value),
        eqEnabled: state.eqEnabled,
        eqGains: state.eqGains,
        stereoWidth: state.stereoWidth,
        stereoBalance: state.stereoBalance,
        outputDeviceId: state.outputDeviceId,
        visualizerMode: state.visualizerMode,
        partyPin: state.partyPin,
        partyRequestLimit: state.partyRequestLimit,
        partyVoting: state.partyVoting,
        micInputDeviceId: state.djMic.inputDeviceId,
        micGain: state.djMic.gain,
        micDuckDb: state.djMic.duckDb,
        micDucking: state.djMic.ducking,
        micPushToTalk: state.djMic.pushToTalk,
        radioProfiles: state.radio.profiles,
        broadcastDraft: {
          name: $('#broadcastName')?.value || '',
          dj: $('#broadcastDj')?.value || '',
          description: $('#broadcastDescription')?.value || ''
        }
      }));
    } catch {}
  }, 180);
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERSISTENCE_KEY) || '{}');
    state.library = Array.isArray(saved.library) ? saved.library : [];
    state.queue = Array.isArray(saved.queue) ? saved.queue : [];
    state.shuffle = Boolean(saved.shuffle);
    state.repeat = ['off', 'one', 'all'].includes(saved.repeat) ? saved.repeat : 'off';
    state.masterVolume = Number.isFinite(saved.masterVolume) ? saved.masterVolume : .82;
    state.eqEnabled = saved.eqEnabled !== false;
    state.eqGains = Array.isArray(saved.eqGains) && saved.eqGains.length === 10 ? saved.eqGains : [...EQ_PRESETS.flat];
    state.stereoWidth = Number.isFinite(saved.stereoWidth) ? saved.stereoWidth : 1;
    state.stereoBalance = Number.isFinite(saved.stereoBalance) ? saved.stereoBalance : 0;
    state.outputDeviceId = saved.outputDeviceId || 'default';
    state.visualizerMode = ['web', 'bars', 'wave', 'off'].includes(saved.visualizerMode) ? saved.visualizerMode : 'web';
    state.partyPin = String(saved.partyPin || '');
    state.partyRequestLimit = Number(saved.partyRequestLimit) || 40;
    state.partyVoting = saved.partyVoting !== false;
    state.djMic.inputDeviceId = saved.micInputDeviceId || 'default';
    state.djMic.gain = Number.isFinite(saved.micGain) ? Math.max(0, Math.min(2, saved.micGain)) : 1;
    state.djMic.duckDb = Number.isFinite(saved.micDuckDb) ? Math.max(0, Math.min(24, saved.micDuckDb)) : 14;
    state.djMic.ducking = saved.micDucking !== false;
    state.djMic.pushToTalk = Boolean(saved.micPushToTalk);
    state.radio.profiles = Array.isArray(saved.radioProfiles) ? saved.radioProfiles : [];
    const draft = saved.broadcastDraft || {};
    $('#broadcastName').value = draft.name || '';
    $('#broadcastDj').value = draft.dj || '';
    $('#broadcastDescription').value = draft.description || '';
    $('#crossfade').value = String(Number.isFinite(saved.crossfade) ? saved.crossfade : 4);
    $('#crossfadeValue').textContent = `${$('#crossfade').value}s`;
    $('#volume').value = String(Math.round(state.masterVolume * 100));
    $('#stereoWidth').value = String(Math.round(state.stereoWidth * 100));
    $('#stereoBalance').value = String(Math.round(state.stereoBalance * 100));
    $('#partyPin').value = state.partyPin;
    $('#partyRequestLimit').value = String(state.partyRequestLimit);
    $('#partyVoting').checked = state.partyVoting;
    $('#micGain').value = String(Math.round(state.djMic.gain * 100));
    $('#micGainValue').textContent = `${Math.round(state.djMic.gain * 100)}%`;
    $('#micDuckAmount').value = String(state.djMic.duckDb);
    $('#micDuckValue').textContent = `-${state.djMic.duckDb} dB`;
    $('#micDucking').checked = state.djMic.ducking;
    $('#micPushToTalk').checked = state.djMic.pushToTalk;
    $('#micMonitor').checked = false;
    $('#shuffleButton').classList.toggle('active', state.shuffle);
    $('#repeatButton').classList.toggle('active', state.repeat !== 'off');
    $('#repeatButton small').textContent = state.repeat === 'one' ? 'ONE' : state.repeat === 'all' ? 'ALL' : 'OFF';
    $('#visualizerModeButton').textContent = `VISUALIZER · ${state.visualizerMode.toUpperCase()}`;
  } catch {}
}

let toastTimer;
let dragDepth = 0;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}

function displayName(name) {
  return String(name || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
}

function sourceLabel(item) {
  if (!item) return 'LOCAL';
  if (item.source === 'network') return 'NETWORK STREAM';
  if (item.source === 'guest') return 'GUEST REQUEST';
  return item.extension ? `LOCAL · ${item.extension}` : 'LOCAL MEDIA';
}

function currentItem() {
  return state.queue[state.currentIndex] || null;
}

function activeMedia() {
  return decks[state.activeDeck];
}

function playable(item) {
  return Boolean(item && item.url);
}

function applyDeckVolume(deck, gain = Number(deck.dataset.gain || 1)) {
  deck.dataset.gain = String(gain);
  const duckFactor = state.djMic.duckingActive ? 10 ** (-state.djMic.duckDb / 20) : 1;
  deck.volume = Math.max(0, Math.min(1, state.masterVolume * gain * duckFactor));
  deck.muted = state.muted;
}

function ensureAudioEngine() {
  if (state.audioContext) {
    if (state.audioContext.state === 'suspended') void state.audioContext.resume();
    return state.audioContext;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const context = new AudioContext();
  state.audioContext = context;
  state.broadcastDestination = context.createMediaStreamDestination();
  state.audioGraphs = decks.map((deck) => {
    const source = context.createMediaElementSource(deck);
    const filters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      return filter;
    });
    source.connect(filters[0]);
    for (let index = 0; index < filters.length - 1; index += 1) filters[index].connect(filters[index + 1]);

    const splitter = context.createChannelSplitter(2);
    const merger = context.createChannelMerger(2);
    const matrix = {
      leftLeft: context.createGain(),
      leftRight: context.createGain(),
      rightLeft: context.createGain(),
      rightRight: context.createGain()
    };
    const panner = context.createStereoPanner();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.84;
    filters.at(-1).connect(splitter);
    splitter.connect(matrix.leftLeft, 0);
    splitter.connect(matrix.leftRight, 0);
    splitter.connect(matrix.rightLeft, 1);
    splitter.connect(matrix.rightRight, 1);
    matrix.leftLeft.connect(merger, 0, 0);
    matrix.rightLeft.connect(merger, 0, 0);
    matrix.leftRight.connect(merger, 0, 1);
    matrix.rightRight.connect(merger, 0, 1);
    merger.connect(panner);
    panner.connect(analyser);
    analyser.connect(context.destination);
    analyser.connect(state.broadcastDestination);
    return {
      filters,
      matrix,
      panner,
      analyser,
      frequencyData: new Uint8Array(analyser.frequencyBinCount),
      waveData: new Uint8Array(analyser.fftSize)
    };
  });
  applySoundSettings();
  if (state.outputDeviceId && typeof context.setSinkId === 'function') {
    void context.setSinkId(state.outputDeviceId).catch(() => {});
  }
  void context.resume();
  return context;
}

function applySoundSettings() {
  for (const graph of state.audioGraphs) {
    graph.filters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(state.eqEnabled ? state.eqGains[index] : 0, state.audioContext.currentTime, 0.015);
    });
    const direct = (1 + state.stereoWidth) / 2;
    const cross = (1 - state.stereoWidth) / 2;
    graph.matrix.leftLeft.gain.setTargetAtTime(direct, state.audioContext.currentTime, 0.015);
    graph.matrix.rightRight.gain.setTargetAtTime(direct, state.audioContext.currentTime, 0.015);
    graph.matrix.leftRight.gain.setTargetAtTime(cross, state.audioContext.currentTime, 0.015);
    graph.matrix.rightLeft.gain.setTargetAtTime(cross, state.audioContext.currentTime, 0.015);
    graph.panner.pan.setTargetAtTime(state.stereoBalance, state.audioContext.currentTime, 0.015);
  }
}

function renderEqualizer() {
  const bands = $('#eqBands');
  if (!bands.children.length) {
    bands.replaceChildren(...EQ_FREQUENCIES.map((frequency, index) => {
      const band = document.createElement('div');
      band.className = 'eq-band';
      const output = document.createElement('output');
      output.textContent = '0';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '-12';
      input.max = '12';
      input.step = '0.5';
      input.value = '0';
      input.dataset.band = String(index);
      input.setAttribute('aria-label', `${frequency} hertz`);
      const label = document.createElement('label');
      label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
      band.append(output, input, label);
      return band;
    }));
  }
  $$('#eqBands input').forEach((input, index) => {
    input.value = String(state.eqGains[index]);
    input.previousElementSibling.textContent = state.eqGains[index] > 0 ? `+${state.eqGains[index]}` : String(state.eqGains[index]);
    input.disabled = !state.eqEnabled;
  });
  $('#eqEnabled').checked = state.eqEnabled;
}

function setMicDuckingActive(active) {
  const next = Boolean(active && state.djMic.ducking && state.djMic.live);
  if (state.djMic.duckingActive === next) return;
  state.djMic.duckingActive = next;
  decks.forEach((deck) => applyDeckVolume(deck));
}

function updateDjMicMeter() {
  const bar = $('#micMeter i');
  if (!state.djMic.analyser || !state.djMic.levelData) {
    bar.style.width = '0%';
    setMicDuckingActive(false);
    return;
  }
  state.djMic.analyser.getByteTimeDomainData(state.djMic.levelData);
  let energy = 0;
  for (const value of state.djMic.levelData) {
    const sample = (value - 128) / 128;
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / state.djMic.levelData.length);
  const level = Math.min(1, rms * 4.8);
  bar.style.width = `${Math.round(level * 100)}%`;
  setMicDuckingActive(rms > .032);
}

function visualizerFrame(time) {
  updateDjMicMeter();
  const canvas = $('#visualizerCanvas');
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(bounds.width * scale));
  const height = Math.max(1, Math.floor(bounds.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  if (state.visualizerMode === 'off') {
    requestAnimationFrame(visualizerFrame);
    return;
  }

  const graph = state.audioGraphs[state.activeDeck];
  const live = graph && !activeMedia().paused;
  const frequencyData = graph ? graph.frequencyData : IDLE_FREQUENCY_DATA;
  const waveData = graph ? graph.waveData : IDLE_WAVE_DATA;
  if (graph) {
    graph.analyser.getByteFrequencyData(frequencyData);
    graph.analyser.getByteTimeDomainData(waveData);
  }

  context.save();
  context.scale(scale, scale);
  const w = bounds.width;
  const h = bounds.height;
  const pulse = live ? 1 : 0.04 + Math.sin(time / 1100) * 0.015;
  context.globalCompositeOperation = 'lighter';

  if (state.visualizerMode === 'bars') {
    const count = Math.min(72, Math.floor(w / 8));
    const gap = 3;
    const barWidth = Math.max(2, (w - gap * (count - 1)) / count);
    const gradient = context.createLinearGradient(0, h, 0, h * .18);
    gradient.addColorStop(0, 'rgba(95, 24, 166, .42)');
    gradient.addColorStop(.55, 'rgba(175, 71, 255, .82)');
    gradient.addColorStop(1, 'rgba(232, 185, 255, .95)');
    context.fillStyle = gradient;
    context.shadowColor = '#a855f7';
    context.shadowBlur = 12;
    for (let index = 0; index < count; index += 1) {
      const bin = Math.floor((index / count) ** 1.65 * Math.min(520, frequencyData.length - 1));
      const strength = live ? frequencyData[bin] / 255 : pulse;
      const barHeight = Math.max(2, strength * h * .62);
      const x = index * (barWidth + gap);
      context.fillRect(x, h - barHeight, barWidth, barHeight);
    }
  } else if (state.visualizerMode === 'wave') {
    const gradient = context.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(92, 28, 164, .18)');
    gradient.addColorStop(.5, 'rgba(220, 150, 255, .96)');
    gradient.addColorStop(1, 'rgba(92, 28, 164, .18)');
    context.strokeStyle = gradient;
    context.lineWidth = 2;
    context.shadowColor = '#b15cff';
    context.shadowBlur = 16;
    context.beginPath();
    for (let index = 0; index < waveData.length; index += 1) {
      const x = (index / (waveData.length - 1)) * w;
      const sample = live ? (waveData[index] - 128) / 128 : Math.sin(index / 22 + time / 550) * pulse;
      const y = h * .52 + sample * h * .31;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  } else {
    const centerX = w / 2;
    const centerY = h * .51;
    const spokes = 48;
    const baseRadius = Math.min(w, h) * .31;
    const points = [];
    for (let index = 0; index < spokes; index += 1) {
      const angle = (index / spokes) * Math.PI * 2 - Math.PI / 2;
      const bin = Math.floor((index / spokes) ** 1.5 * Math.min(600, frequencyData.length - 1));
      const strength = live ? frequencyData[bin] / 255 : pulse;
      const radius = baseRadius * (.62 + strength * .7);
      points.push({ x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius, angle, radius });
    }

    context.strokeStyle = 'rgba(181, 94, 255, .17)';
    context.lineWidth = 1;
    for (let index = 0; index < spokes; index += 4) {
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(points[index].x, points[index].y);
      context.stroke();
    }
    for (let ring = 1; ring <= 5; ring += 1) {
      context.beginPath();
      points.forEach((point, index) => {
        const ratio = ring / 5;
        const x = centerX + (point.x - centerX) * ratio;
        const y = centerY + (point.y - centerY) * ratio;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
      context.stroke();
    }

    const fill = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * 1.4);
    fill.addColorStop(0, 'rgba(222, 158, 255, .28)');
    fill.addColorStop(.55, 'rgba(160, 51, 238, .16)');
    fill.addColorStop(1, 'rgba(74, 16, 128, 0)');
    context.fillStyle = fill;
    context.strokeStyle = live ? 'rgba(210, 133, 255, .82)' : 'rgba(168, 85, 247, .2)';
    context.lineWidth = live ? 1.6 : 1;
    context.shadowColor = '#a855f7';
    context.shadowBlur = live ? 20 : 7;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.fill();
    context.stroke();

    let bass = pulse;
    if (live) {
      bass = 0;
      for (let index = 1; index < 22; index += 1) bass += frequencyData[index];
      bass /= 21 * 255;
    }
    const coreRadius = baseRadius * (.055 + bass * .13);
    const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius * 2.8);
    core.addColorStop(0, 'rgba(255, 235, 255, .98)');
    core.addColorStop(.2, 'rgba(211, 123, 255, .92)');
    core.addColorStop(.55, 'rgba(135, 37, 218, .45)');
    core.addColorStop(1, 'rgba(95, 21, 166, 0)');
    context.fillStyle = core;
    context.shadowBlur = 30 + bass * 38;
    context.beginPath();
    context.arc(centerX, centerY, coreRadius * 2.8, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
  requestAnimationFrame(visualizerFrame);
}

function syncPartyState() {
  void window.spider.partyState({
    enabled: state.partyEnabled,
    nowPlaying: currentItem() ? {
      title: currentItem().title,
      artist: currentItem().artist || ''
    } : null,
    queue: state.queue.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist || '',
      source: item.source || 'local'
    })),
    pin: state.partyPin,
    requestLimit: state.partyRequestLimit,
    voting: state.partyVoting
  });
}

function renderQueue() {
  $('#libraryCount').textContent = `${state.library.length} ${state.library.length === 1 ? 'track' : 'tracks'}`;
  const list = $('#queueList');
  if (!state.queue.length) {
    list.innerHTML = '<div class="empty-list">Your queue is empty.<br>Add media to begin.</div>';
    syncPartyState();
    return;
  }

  const visibleItems = state.queue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !state.queueSearch || `${item.title} ${item.artist || ''} ${item.album || ''}`.toLocaleLowerCase().includes(state.queueSearch));
  if (!visibleItems.length) {
    list.innerHTML = '<div class="empty-list">No queue items match your search.</div>';
    syncPartyState();
    saveState();
    return;
  }

  list.replaceChildren(...visibleItems.map(({ item, index }) => {
    const row = document.createElement('div');
    row.className = `queue-item${index === state.currentIndex ? ' current' : ''}`;
    row.dataset.index = String(index);
    row.draggable = true;

    const cover = document.createElement('div');
    cover.className = 'queue-cover';
    cover.textContent = item.source === 'guest' ? '?' : item.source === 'network' ? '≋' : '♪';
    if (item.artwork) {
      cover.style.backgroundImage = `url("${String(item.artwork).replace(/"/g, '%22')}")`;
      cover.style.backgroundSize = 'cover';
      cover.textContent = '';
    }

    const name = document.createElement('div');
    name.className = 'queue-name';
    const title = document.createElement('b');
    title.textContent = item.title;
    const meta = document.createElement('small');
    meta.textContent = `${item.artist || sourceLabel(item)}${item.votes ? ` · ▲ ${item.votes}` : ''}`;
    name.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    for (const [label, action, titleText] of [['↑', 'up', 'Move up'], ['↓', 'down', 'Move down'], ['×', 'remove', 'Remove']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.action = action;
      button.title = titleText;
      actions.append(button);
    }

    row.append(cover, name, actions);
    row.addEventListener('dblclick', () => {
      if (playable(item)) playAt(index, false);
      else {
        void window.spider.openService('spotify', `${item.title} ${item.artist || ''}`);
        toast(`Find “${item.title}” in your connected service`);
      }
    });
    row.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/x-spider-queue-index', String(index)));
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/x-spider-queue-index'));
      if (!Number.isInteger(from) || from === index || from < 0 || from >= state.queue.length) return;
      const [moved] = state.queue.splice(from, 1);
      state.queue.splice(index, 0, moved);
      if (state.currentIndex === from) state.currentIndex = index;
      else if (from < state.currentIndex && index >= state.currentIndex) state.currentIndex -= 1;
      else if (from > state.currentIndex && index <= state.currentIndex) state.currentIndex += 1;
      renderQueue();
    });
    return row;
  }));
  syncPartyState();
  saveState();
}

function updateNowPlaying() {
  const item = currentItem();
  if (!item) {
    $('#trackTitle').textContent = 'Nothing playing';
    $('#trackMeta').textContent = 'Add local media or a network stream';
    $('#sourceBadge').style.display = 'none';
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    if (state.radio.active) void window.spider.updateRadio(null);
    return;
  }
  $('#trackTitle').textContent = item.title;
  $('#trackMeta').textContent = item.artist || sourceLabel(item);
  $('#sourceBadge').textContent = sourceLabel(item);
  $('#sourceBadge').style.display = 'block';
  $('#emptyState').classList.add('hidden');
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist || 'Spider Media Center',
      album: item.album || sourceLabel(item),
      artwork: [{ src: item.artwork || new URL('../assets/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }]
    });
  }
  if (state.radio.active) void window.spider.updateRadio({ title: item.title, artist: item.artist || '' });
}

function indicesOfPlayable() {
  return state.queue.map((item, index) => playable(item) ? index : -1).filter((index) => index >= 0);
}

function nextIndex(direction = 1, from = state.currentIndex) {
  const valid = indicesOfPlayable();
  if (!valid.length) return -1;
  if (state.shuffle && direction > 0 && valid.length > 1) {
    const alternatives = valid.filter((index) => index !== state.currentIndex);
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }

  let cursor = from;
  for (let checked = 0; checked < state.queue.length; checked += 1) {
    cursor += direction;
    if (cursor >= state.queue.length || cursor < 0) {
      if (state.repeat === 'all' || direction < 0) cursor = direction > 0 ? 0 : state.queue.length - 1;
      else return -1;
    }
    if (playable(state.queue[cursor])) return cursor;
  }
  return -1;
}

function prepareDeck(deck, item) {
  if (deck.dataset.itemId === item.id) return;
  deck.pause();
  deck.removeAttribute('src');
  deck.load();
  deck.src = item.url;
  deck.dataset.itemId = item.id;
  deck.preload = 'auto';
  deck.load();
}

function primeNextDeck() {
  if (state.transitioning) return;
  const index = nextIndex(1);
  if (index < 0 || index === state.currentIndex) return;
  const standby = decks[1 - state.activeDeck];
  prepareDeck(standby, state.queue[index]);
  standby.classList.remove('active');
  applyDeckVolume(standby, 0);
}

function animateCrossfade(oldDeck, newDeck, seconds) {
  const started = performance.now();
  const duration = Math.max(250, seconds * 1000);
  state.transitioning = true;

  function frame(now) {
    const progress = Math.min(1, (now - started) / duration);
    applyDeckVolume(oldDeck, 1 - progress);
    applyDeckVolume(newDeck, progress);
    if (progress < 1 && !newDeck.paused) {
      requestAnimationFrame(frame);
      return;
    }
    oldDeck.pause();
    oldDeck.classList.remove('active');
    newDeck.classList.add('active');
    applyDeckVolume(oldDeck, 0);
    applyDeckVolume(newDeck, 1);
    state.transitioning = false;
    primeNextDeck();
  }
  requestAnimationFrame(frame);
}

async function playAt(index, blend = false) {
  const item = state.queue[index];
  if (!playable(item)) return;

  ensureAudioEngine();
  const oldDeck = activeMedia();
  const firstPlay = state.currentIndex < 0 || !oldDeck.src;
  const newDeckIndex = firstPlay ? state.activeDeck : 1 - state.activeDeck;
  const newDeck = decks[newDeckIndex];
  prepareDeck(newDeck, item);
  applyDeckVolume(newDeck, blend && !firstPlay ? 0 : 1);

  try {
    await newDeck.play();
  } catch (error) {
    toast(`Could not play ${item.title}`);
    return;
  }

  state.currentIndex = index;
  state.activeDeck = newDeckIndex;
  state.crossfadeTriggered = false;
  newDeck.classList.add('active');
  updateNowPlaying();
  renderQueue();
  $('#playButton').textContent = '❚❚';

  const seconds = Number($('#crossfade').value);
  if (!firstPlay && blend && seconds > 0 && !oldDeck.paused) {
    animateCrossfade(oldDeck, newDeck, seconds);
  } else {
    oldDeck.classList.toggle('active', oldDeck === newDeck);
    if (oldDeck !== newDeck) oldDeck.pause();
    state.transitioning = false;
    primeNextDeck();
  }
}

function togglePlay() {
  if (state.currentIndex < 0) {
    const first = indicesOfPlayable()[0];
    if (first >= 0) void playAt(first, false);
    else void addMedia();
    return;
  }
  const deck = activeMedia();
  if (deck.paused) void deck.play().catch(() => toast('Playback could not resume'));
  else deck.pause();
}

function advance(direction = 1, automatic = false) {
  if (automatic && state.repeat === 'one') {
    const deck = activeMedia();
    deck.currentTime = 0;
    void deck.play();
    return;
  }
  const target = nextIndex(direction);
  if (target >= 0) void playAt(target, direction > 0 && Number($('#crossfade').value) > 0);
  else {
    $('#playButton').textContent = '▶';
    activeMedia().pause();
  }
}

function addEntries(entries, playFirst = true) {
  const normalized = entries.map((entry) => ({
    ...entry,
    title: entry.title || displayName(entry.name),
    artist: entry.artist || '',
    source: entry.source || 'local'
  }));
  if (!normalized.length) return;
  const start = state.queue.length;
  state.library.push(...normalized.filter((item) => item.source === 'local'));
  state.queue.push(...normalized);
  renderQueue();
  if (playFirst && state.currentIndex < 0) void playAt(start, false);
  toast(`${normalized.length} item${normalized.length === 1 ? '' : 's'} added`);
}

async function addMedia() {
  const entries = await window.spider.chooseMedia();
  addEntries(entries);
}

async function addFolder() {
  toast('Scanning folder and reading track metadata…');
  const entries = await window.spider.chooseFolder();
  addEntries(entries);
  if (entries.length) toast(`${entries.length} media files indexed and saved`);
}

function renderRadioProfiles() {
  const select = $('#broadcastProfiles');
  select.replaceChildren(new Option('New broadcast', ''), ...state.radio.profiles.map((profile, index) => new Option(profile.name, String(index))));
}

function renderRadio() {
  const live = state.radio.active;
  $('#radioIndicator').classList.toggle('on', live);
  $('#radioIndicator').innerHTML = live ? '<i></i> RADIO LIVE' : '<i></i> RADIO OFF';
  $('.radio-status-card').classList.toggle('live', live);
  $('#radioStatusTitle').textContent = live ? $('#broadcastName').value || 'Spider Radio' : 'Ready to broadcast';
  $('#radioStatusCopy').textContent = live ? 'Your processed Spider audio is live on the public internet.' : 'Your processed Spider audio—EQ, stereo image, crossfades and all—streams to listeners through a public link.';
  $('#listenerCount').textContent = `${state.radio.listenerCount || 0} LISTENER${state.radio.listenerCount === 1 ? '' : 'S'}`;
  $('#broadcastUrl').textContent = live ? state.radio.publicUrl : 'Link appears when live';
  $('#broadcastQr').src = live ? state.radio.qrDataUrl || '' : '';
  $('#broadcastQr').classList.toggle('hidden', !live || !state.radio.qrDataUrl);
  $('#broadcastQrPlaceholder').classList.toggle('hidden', live && Boolean(state.radio.qrDataUrl));
  $('#startBroadcastButton').classList.toggle('hidden', live);
  $('#stopBroadcastButton').classList.toggle('hidden', !live);
  $('#openBroadcastButton').disabled = !live;
  $('#listenerPreviewName').textContent = $('#broadcastName').value.trim() || 'Your station name';
  const item = currentItem();
  $('#listenerPreviewNow').textContent = item ? `${item.title}${item.artist ? ` · ${item.artist}` : ''}` : 'Nothing playing';
}

function stopListenerRecorder(id) {
  const recorder = state.radio.recorders.get(id);
  if (!recorder) return;
  clearInterval(recorder.spiderFlushTimer);
  if (recorder.state !== 'inactive') recorder.stop();
  state.radio.recorders.delete(id);
}

function startListenerRecorder(id) {
  ensureAudioEngine();
  if (!state.broadcastDestination || state.radio.recorders.has(id)) return;
  if (state.audioContext?.state === 'suspended') void state.audioContext.resume();
  const candidates = [
    state.radio.mimeType,
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm'
  ].filter(Boolean);
  const mimeType = candidates.find((value) => MediaRecorder.isTypeSupported(value)) || '';
  const recorder = new MediaRecorder(
    state.broadcastDestination.stream,
    mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 }
  );
  let sending = Promise.resolve();
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    sending = sending.then(async () => {
      const bytes = new Uint8Array(await event.data.arrayBuffer());
      window.spider.radioChunk(id, bytes);
    });
  };
  recorder.onerror = () => stopListenerRecorder(id);
  state.radio.recorders.set(id, recorder);
  recorder.start(400);
  recorder.spiderFlushTimer = setInterval(() => {
    if (recorder.state === 'recording') {
      try { recorder.requestData(); } catch {}
    }
  }, 500);
}

function preferredBroadcastMimeType() {
  return [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm'
  ].find((value) => MediaRecorder.isTypeSupported(value)) || '';
}

async function startBroadcast() {
  const name = $('#broadcastName').value.trim();
  if (!name) {
    toast('Name this broadcast first');
    $('#broadcastName').focus();
    return;
  }
  if (!$('#broadcastRights').checked) {
    toast('Confirm that you have permission to broadcast this content');
    return;
  }
  ensureAudioEngine();
  $('#startBroadcastButton').disabled = true;
  $('#startBroadcastButton').textContent = 'Opening public relay…';
  try {
    const profile = {
      name,
      dj: $('#broadcastDj').value.trim(),
      description: $('#broadcastDescription').value.trim(),
      mimeType: preferredBroadcastMimeType()
    };
    const liveState = await window.spider.startRadio(profile);
    Object.assign(state.radio, liveState, { active: true });
    const existing = state.radio.profiles.findIndex((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing >= 0) state.radio.profiles[existing] = profile;
    else state.radio.profiles.unshift(profile);
    state.radio.profiles = state.radio.profiles.slice(0, 30);
    renderRadioProfiles();
    renderRadio();
    updateNowPlaying();
    saveState();
    toast(`${name} is live on the internet`);
  } catch (error) {
    toast(error.message || 'The public broadcast could not start');
  } finally {
    $('#startBroadcastButton').disabled = false;
    $('#startBroadcastButton').textContent = 'Start public broadcast';
  }
}

async function stopBroadcast() {
  for (const id of state.radio.recorders.keys()) stopListenerRecorder(id);
  await window.spider.stopRadio();
  Object.assign(state.radio, { active: false, publicUrl: '', listenerCount: 0 });
  renderRadio();
  toast('Broadcast stopped');
}

function renderRequests() {
  const area = $('#requestsArea');
  area.classList.toggle('hidden', !state.partyEnabled);
  $('#requestCount').textContent = String(state.guestRequests.length);
  const list = $('#requestList');
  if (!state.guestRequests.length) {
    list.innerHTML = '<p class="empty-list">Waiting for requests…</p>';
    return;
  }
  list.replaceChildren(...state.guestRequests.map((item) => {
    const card = document.createElement('div');
    card.className = 'request-card';
    card.dataset.id = item.id;
    const title = document.createElement('b');
    title.textContent = item.artist ? `${item.song} · ${item.artist}` : item.song;
    const guest = document.createElement('small');
    guest.textContent = `Requested by ${item.guest}`;
    const actions = document.createElement('div');
    actions.className = 'request-actions';
    for (const [label, action] of [['ADD TO QUEUE', 'accept'], ['SKIP', 'reject']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.requestAction = action;
      actions.append(button);
    }
    card.append(title, guest, actions);
    return card;
  }));
}

async function setPartyEnabled(enabled) {
  state.partyEnabled = enabled;
  $('#partyToggle').checked = enabled;
  $('#partyIndicator').classList.toggle('on', enabled);
  $('#partyIndicator').innerHTML = enabled ? '<i></i> PARTY LIVE' : '<i></i> PARTY OFF';
  $('#partyCopy').textContent = enabled ? 'Guests can scan Nearby Share to request songs and watch the queue.' : 'Turn on guest requests and a live shared queue.';
  $('#partySettings').classList.toggle('hidden', !enabled);
  renderRequests();
  syncPartyState();
  if (enabled && !state.nearby.active) {
    try {
      await startNearby();
      toast('Party DJ Mode is live');
    } catch (error) {
      state.partyEnabled = false;
      $('#partyToggle').checked = false;
      renderRequests();
      syncPartyState();
      toast('Could not start the guest portal');
    }
  }
}

function renderNearby() {
  const active = Boolean(state.nearby.active);
  $('#toggleNearbyButton').textContent = active ? 'Stop Nearby Share' : 'Start Nearby Share';
  $('#shareFilesButton').disabled = !active;
  $('#nearbyUrl').textContent = active ? state.nearby.url : 'Nearby Share is off';
  $('#qrImage').style.display = active ? 'block' : 'none';
  $('#qrPlaceholder').style.display = active ? 'none' : 'grid';
  if (active) $('#qrImage').src = state.nearby.qrDataUrl;

  const files = $('#sharedFiles');
  if (!state.sharedFiles.length) {
    files.innerHTML = '<span>No files shared from this PC.</span>';
    return;
  }
  files.replaceChildren(...state.sharedFiles.map((item) => {
    const row = document.createElement('div');
    row.className = 'shared-file';
    const label = document.createElement('span');
    label.textContent = `${item.name} · ${Math.max(1, Math.ceil(item.size / 1024 / 1024))} MB`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.onclick = async () => {
      await window.spider.removeShareFile(item.id);
      state.sharedFiles = state.sharedFiles.filter((file) => file.id !== item.id);
      renderNearby();
    };
    row.append(label, remove);
    return row;
  }));
}

function renderTransfers() {
  const area = $('#transferActivity');
  const items = [...state.transfers.values()];
  area.replaceChildren(...items.map((item) => {
    const row = document.createElement('div');
    row.className = 'transfer-row';
    const name = document.createElement('span');
    name.textContent = item.name;
    const status = document.createElement('span');
    status.textContent = item.error || `${item.progress || 0}%`;
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = item.progress || 0;
    row.append(name, status, progress);
    return row;
  }));
}

async function startNearby() {
  state.nearby = await window.spider.startNearby();
  renderNearby();
  return state.nearby;
}

async function stopNearby() {
  state.nearby = await window.spider.stopNearby();
  state.sharedFiles = [];
  if (state.partyEnabled) await setPartyEnabled(false);
  renderNearby();
  toast('Nearby Share stopped');
}

function renderDjMic() {
  const mic = state.djMic;
  const status = $('#micStatus');
  status.textContent = mic.live ? 'MIC LIVE' : mic.enabled ? 'MIC ARMED' : 'MIC OFF';
  status.classList.toggle('live', mic.live);
  $('#micToggleButton').textContent = !mic.enabled ? 'Enable microphone' : mic.live ? 'Mute microphone' : 'Go live on mic';
  $('#pushToTalkButton').disabled = !mic.enabled;
  $('#pushToTalkButton').classList.toggle('talking', mic.live && mic.pttPressed);
  $('#releaseMicButton').classList.toggle('hidden', !mic.enabled);
}

function applyDjMicGain() {
  if (!state.djMic.gainNode || !state.audioContext) return;
  const value = state.djMic.live ? state.djMic.gain : 0;
  state.djMic.gainNode.gain.setTargetAtTime(value, state.audioContext.currentTime, .012);
}

function setDjMicLive(live) {
  if (!state.djMic.enabled) return;
  state.djMic.live = Boolean(live);
  applyDjMicGain();
  if (!state.djMic.live) setMicDuckingActive(false);
  renderDjMic();
}

function setDjMicMonitor(enabled) {
  const mic = state.djMic;
  if (!mic.gainNode || !state.audioContext) return;
  if (enabled && !mic.monitor) mic.gainNode.connect(state.audioContext.destination);
  if (!enabled && mic.monitor) {
    try { mic.gainNode.disconnect(state.audioContext.destination); } catch {}
  }
  mic.monitor = Boolean(enabled);
}

async function refreshMicrophones() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'audioinput');
    const select = $('#micInputDevice');
    const wanted = state.djMic.inputDeviceId || select.value || 'default';
    select.replaceChildren(...devices.map((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || (index === 0 ? 'System default microphone' : `Microphone ${index + 1}`);
      return option;
    }));
    if (!devices.length) select.append(new Option('System default microphone', 'default'));
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
    else select.value = select.options[0]?.value || 'default';
  } catch {
    toast('Windows did not return microphone devices');
  }
}

function stopDjMicrophone() {
  const mic = state.djMic;
  setDjMicLive(false);
  setDjMicMonitor(false);
  for (const track of mic.stream?.getTracks() || []) track.stop();
  try { mic.source?.disconnect(); } catch {}
  try { mic.gainNode?.disconnect(); } catch {}
  try { mic.analyser?.disconnect(); } catch {}
  Object.assign(mic, {
    stream: null,
    source: null,
    gainNode: null,
    analyser: null,
    levelData: null,
    enabled: false,
    live: false,
    monitor: false,
    pttPressed: false
  });
  setMicDuckingActive(false);
  $('#micMonitor').checked = false;
  renderDjMic();
}

async function startDjMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Microphone capture is not available on this PC');
    return false;
  }
  const mic = state.djMic;
  const selected = $('#micInputDevice').value || mic.inputDeviceId || 'default';
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1
  };
  if (selected !== 'default') audio.deviceId = { exact: selected };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
  } catch (error) {
    if (selected !== 'default' && ['NotFoundError', 'OverconstrainedError'].includes(error.name)) {
      mic.inputDeviceId = 'default';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }, video: false });
      } catch {
        toast('No available microphone could be opened');
        return false;
      }
    } else {
      toast(error.name === 'NotAllowedError' ? 'Allow microphone access in Windows to use the DJ mic' : 'The selected microphone could not be opened');
      return false;
    }
  }
  const context = ensureAudioEngine();
  await context.resume();
  mic.stream = stream;
  mic.source = context.createMediaStreamSource(stream);
  mic.gainNode = context.createGain();
  mic.analyser = context.createAnalyser();
  mic.analyser.fftSize = 512;
  mic.analyser.smoothingTimeConstant = .72;
  mic.levelData = new Uint8Array(mic.analyser.fftSize);
  mic.source.connect(mic.gainNode);
  mic.gainNode.connect(mic.analyser);
  mic.analyser.connect(state.broadcastDestination);
  mic.enabled = true;
  mic.live = !mic.pushToTalk;
  applyDjMicGain();
  if ($('#micMonitor').checked) setDjMicMonitor(true);
  const track = stream.getAudioTracks()[0];
  if (track) {
    mic.inputDeviceId = track.getSettings().deviceId || selected;
    track.addEventListener('ended', () => stopDjMicrophone(), { once: true });
  }
  await refreshMicrophones();
  renderDjMic();
  toast(mic.live ? 'DJ microphone is live in the broadcast mix' : 'DJ microphone armed—hold Space to talk');
  saveState();
  return true;
}

function beginPushToTalk() {
  if (!state.djMic.enabled || state.djMic.pttPressed) return;
  state.djMic.pttPressed = true;
  state.djMic.pttReturnLive = state.djMic.live;
  setDjMicLive(true);
}

function endPushToTalk() {
  if (!state.djMic.pttPressed) return;
  state.djMic.pttPressed = false;
  setDjMicLive(Boolean(state.djMic.pttReturnLive));
}

async function refreshAudioDevices(prompt = false) {
  try {
    let selected;
    if (prompt && navigator.mediaDevices.selectAudioOutput) {
      selected = await navigator.mediaDevices.selectAudioOutput();
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === 'audiooutput');
    const select = $('#outputDevice');
    const existing = select.value;
    select.replaceChildren(...devices.map((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || (index === 0 ? 'System default' : `Audio output ${index + 1}`);
      return option;
    }));
    if (!devices.length) {
      const option = document.createElement('option');
      option.value = 'default';
      option.textContent = 'System default';
      select.append(option);
    }
    const wanted = selected ? selected.deviceId : existing;
    if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
  } catch (error) {
    if (prompt && error.name !== 'NotAllowedError') toast('Windows did not return an output device');
  }
}

async function applyOutputDevice(deviceId) {
  try {
    state.outputDeviceId = deviceId;
    const context = ensureAudioEngine();
    await Promise.all(decks.map((deck) => typeof deck.setSinkId === 'function' ? deck.setSinkId(deviceId) : Promise.resolve()));
    if (context && typeof context.setSinkId === 'function') await context.setSinkId(deviceId);
    const name = $('#outputDevice').selectedOptions[0]?.textContent || 'selected device';
    toast(`Output switched to ${name}`);
  } catch {
    toast('This device could not be selected. Check Windows sound settings.');
  }
}

function showPanel(name) {
  $$('.feature-panel').forEach((panel) => panel.classList.add('hidden'));
  $('.hero-player').classList.add('hidden');
  const panel = $(`#${name}Panel`);
  if (panel) panel.classList.remove('hidden');
  else $('.hero-player').classList.remove('hidden');
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
}

$('#openMediaButton').onclick = addMedia;
$('#addMediaNav').onclick = addMedia;
$('#addMediaQueue').onclick = addMedia;
$('#addFolderNav').onclick = addFolder;
$('#playButton').onclick = togglePlay;
$('#previousButton').onclick = () => advance(-1);
$('#nextButton').onclick = () => advance(1);
$('#backButton').onclick = () => { activeMedia().currentTime = Math.max(0, activeMedia().currentTime - 10); };
$('#forwardButton').onclick = () => { activeMedia().currentTime = Math.min(activeMedia().duration || Infinity, activeMedia().currentTime + 10); };

$('#shuffleButton').onclick = () => {
  state.shuffle = !state.shuffle;
  $('#shuffleButton').classList.toggle('active', state.shuffle);
  toast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
  saveState();
};

$('#repeatButton').onclick = () => {
  state.repeat = state.repeat === 'off' ? 'one' : state.repeat === 'one' ? 'all' : 'off';
  $('#repeatButton').classList.toggle('active', state.repeat !== 'off');
  $('#repeatButton small').textContent = state.repeat === 'one' ? 'ONE' : state.repeat === 'all' ? 'ALL' : 'OFF';
  toast(state.repeat === 'one' ? 'Repeat one' : state.repeat === 'all' ? 'Repeat all' : 'Repeat off');
  saveState();
};

$('#seek').oninput = (event) => {
  const deck = activeMedia();
  if (Number.isFinite(deck.duration)) deck.currentTime = (Number(event.target.value) / 1000) * deck.duration;
};
$('#volume').oninput = (event) => {
  state.masterVolume = Number(event.target.value) / 100;
  decks.forEach((deck) => applyDeckVolume(deck));
  saveState();
};
$('#muteButton').onclick = () => {
  state.muted = !state.muted;
  decks.forEach((deck) => applyDeckVolume(deck));
  $('#muteButton').textContent = state.muted ? '×' : '◖';
};
$('#crossfade').oninput = (event) => {
  const seconds = Number(event.target.value);
  $('#crossfadeValue').textContent = `${seconds}s`;
  $('#gaplessChip').textContent = seconds ? 'CROSSFADE ON' : 'GAPLESS ON';
  saveState();
};

$('#visualizerModeButton').onclick = () => {
  const modes = ['web', 'bars', 'wave', 'off'];
  state.visualizerMode = modes[(modes.indexOf(state.visualizerMode) + 1) % modes.length];
  $('#visualizerModeButton').textContent = `VISUALIZER · ${state.visualizerMode.toUpperCase()}`;
  toast(state.visualizerMode === 'off' ? 'Visualizer off' : `${state.visualizerMode} visualizer`);
  saveState();
};

$('#eqBands').oninput = (event) => {
  const input = event.target.closest('input[data-band]');
  if (!input) return;
  const index = Number(input.dataset.band);
  state.eqGains[index] = Number(input.value);
  input.previousElementSibling.textContent = Number(input.value) > 0 ? `+${input.value}` : input.value;
  $('#eqPreset').value = 'custom';
  ensureAudioEngine();
  applySoundSettings();
  saveState();
};
$('#eqPreset').onchange = (event) => {
  if (!EQ_PRESETS[event.target.value]) return;
  state.eqGains = [...EQ_PRESETS[event.target.value]];
  state.eqEnabled = true;
  ensureAudioEngine();
  applySoundSettings();
  renderEqualizer();
  saveState();
};
$('#eqEnabled').onchange = (event) => {
  state.eqEnabled = event.target.checked;
  ensureAudioEngine();
  applySoundSettings();
  renderEqualizer();
  toast(state.eqEnabled ? 'Equalizer enabled' : 'Equalizer bypassed');
  saveState();
};
$('#stereoWidth').oninput = (event) => {
  const value = Number(event.target.value);
  state.stereoWidth = value / 100;
  $('#stereoWidthValue').textContent = value === 0 ? 'MONO' : `${value}%`;
  ensureAudioEngine();
  applySoundSettings();
  saveState();
};
$('#stereoBalance').oninput = (event) => {
  const value = Number(event.target.value);
  state.stereoBalance = value / 100;
  $('#stereoBalanceValue').textContent = value === 0 ? 'CENTER' : value < 0 ? `L ${Math.abs(value)}%` : `R ${value}%`;
  ensureAudioEngine();
  applySoundSettings();
  saveState();
};
$('#resetSoundButton').onclick = () => {
  state.eqEnabled = true;
  state.eqGains = [...EQ_PRESETS.flat];
  state.stereoWidth = 1;
  state.stereoBalance = 0;
  $('#eqPreset').value = 'flat';
  $('#stereoWidth').value = '100';
  $('#stereoWidthValue').textContent = '100%';
  $('#stereoBalance').value = '0';
  $('#stereoBalanceValue').textContent = 'CENTER';
  ensureAudioEngine();
  applySoundSettings();
  renderEqualizer();
  toast('Sound settings reset');
  saveState();
};

decks.forEach((deck) => {
  applyDeckVolume(deck, deck === decks[0] ? 1 : 0);
  deck.addEventListener('timeupdate', () => {
    if (deck !== activeMedia()) return;
    $('#elapsed').textContent = formatTime(deck.currentTime);
    $('#duration').textContent = formatTime(deck.duration);
    if (Number.isFinite(deck.duration)) $('#seek').value = String((deck.currentTime / deck.duration) * 1000 || 0);
    const seconds = Number($('#crossfade').value);
    const remaining = deck.duration - deck.currentTime;
    if (seconds > 0 && remaining > 0 && remaining <= seconds && !state.crossfadeTriggered && !state.transitioning && state.repeat !== 'one') {
      const target = nextIndex(1);
      if (target >= 0 && target !== state.currentIndex) {
        state.crossfadeTriggered = true;
        void playAt(target, true);
      }
    }
  });
  deck.addEventListener('play', () => { if (deck === activeMedia()) $('#playButton').textContent = '❚❚'; });
  deck.addEventListener('pause', () => { if (deck === activeMedia() && !state.transitioning) $('#playButton').textContent = '▶'; });
  deck.addEventListener('ended', () => {
    if (deck === activeMedia() && !state.transitioning && !state.crossfadeTriggered) advance(1, true);
  });
  deck.addEventListener('error', () => {
    if (deck === activeMedia() && deck.src) toast('That media format or stream could not be played');
  });
});

$('#queueList').onclick = (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('.queue-item');
  const index = Number(row.dataset.index);
  const action = button.dataset.action;
  if (action === 'remove') {
    if (index === state.currentIndex) {
      activeMedia().pause();
      state.currentIndex = -1;
      updateNowPlaying();
    } else if (index < state.currentIndex) state.currentIndex -= 1;
    state.queue.splice(index, 1);
  } else {
    const target = action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= state.queue.length) return;
    [state.queue[index], state.queue[target]] = [state.queue[target], state.queue[index]];
    if (state.currentIndex === index) state.currentIndex = target;
    else if (state.currentIndex === target) state.currentIndex = index;
  }
  renderQueue();
};

$('#clearQueueButton').onclick = () => {
  decks.forEach((deck) => { deck.pause(); deck.removeAttribute('src'); deck.load(); deck.classList.remove('active'); });
  state.queue = [];
  state.currentIndex = -1;
  $('#emptyState').classList.remove('hidden');
  $('#seek').value = '0';
  $('#elapsed').textContent = '0:00';
  $('#duration').textContent = '0:00';
  $('#playButton').textContent = '▶';
  updateNowPlaying();
  renderQueue();
};

$('#partyToggle').onchange = (event) => { void setPartyEnabled(event.target.checked); };
for (const control of [$('#partyPin'), $('#partyRequestLimit'), $('#partyVoting')]) {
  control.oninput = () => {
    state.partyPin = $('#partyPin').value.replace(/\D/g, '').slice(0, 8);
    $('#partyPin').value = state.partyPin;
    state.partyRequestLimit = Math.max(5, Math.min(100, Number($('#partyRequestLimit').value) || 40));
    state.partyVoting = $('#partyVoting').checked;
    syncPartyState();
    saveState();
  };
}
$('#requestList').onclick = async (event) => {
  const button = event.target.closest('button[data-request-action]');
  if (!button) return;
  const card = button.closest('.request-card');
  const id = card.dataset.id;
  const index = state.guestRequests.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = state.guestRequests.splice(index, 1);
  const action = button.dataset.requestAction;
  await window.spider.resolveRequest(id, action);
  if (action === 'accept') {
    state.queue.push({ id: `guest-${item.id}`, title: item.song, artist: item.artist || `Requested by ${item.guest}`, source: 'guest', url: null });
    renderQueue();
    toast('Request added—double-click it to find in Spotify');
  }
  renderRequests();
};

$('#toggleNearbyButton').onclick = () => { if (state.nearby.active) void stopNearby(); else void startNearby().then(() => toast('Nearby Share is ready')); };
$('#miniNearbyButton').onclick = () => { showPanel('nearby'); if (!state.nearby.active) void startNearby(); };
$('#shareFilesButton').onclick = async () => {
  const files = await window.spider.chooseShareFiles();
  state.sharedFiles.push(...files);
  renderNearby();
};
$('#copyNearbyButton').onclick = async () => {
  if (!state.nearby.active) return;
  try { await navigator.clipboard.writeText(state.nearby.url); toast('Nearby link copied'); }
  catch { toast(state.nearby.url); }
};

$('#outputDevice').onchange = (event) => { void applyOutputDevice(event.target.value); };
$('#refreshDevicesButton').onclick = () => { void refreshAudioDevices(true); };
$('#bluetoothButton').onclick = () => { void window.spider.openBluetooth(); };
$('#micToggleButton').onclick = async () => {
  if (!state.djMic.enabled) await startDjMicrophone();
  else setDjMicLive(!state.djMic.live);
};
$('#releaseMicButton').onclick = () => { stopDjMicrophone(); toast('Microphone released'); };
$('#refreshMicButton').onclick = () => { void refreshMicrophones(); };
$('#micInputDevice').onchange = async (event) => {
  const wasEnabled = state.djMic.enabled;
  const wasLive = state.djMic.live;
  if (wasEnabled) stopDjMicrophone();
  state.djMic.inputDeviceId = event.target.value;
  if (wasEnabled && await startDjMicrophone()) setDjMicLive(wasLive);
  saveState();
};
$('#micGain').oninput = (event) => {
  state.djMic.gain = Number(event.target.value) / 100;
  $('#micGainValue').textContent = `${event.target.value}%`;
  applyDjMicGain();
  saveState();
};
$('#micDuckAmount').oninput = (event) => {
  state.djMic.duckDb = Number(event.target.value);
  $('#micDuckValue').textContent = `-${event.target.value} dB`;
  if (state.djMic.duckingActive) decks.forEach((deck) => applyDeckVolume(deck));
  saveState();
};
$('#micDucking').onchange = (event) => {
  state.djMic.ducking = event.target.checked;
  if (!state.djMic.ducking) setMicDuckingActive(false);
  saveState();
};
$('#micPushToTalk').onchange = (event) => {
  state.djMic.pushToTalk = event.target.checked;
  if (state.djMic.enabled && state.djMic.pushToTalk) setDjMicLive(false);
  renderDjMic();
  saveState();
};
$('#micMonitor').onchange = (event) => {
  if (!state.djMic.enabled) {
    event.target.checked = false;
    toast('Enable the microphone first. Use headphones before monitoring.');
    return;
  }
  setDjMicMonitor(event.target.checked);
  toast(event.target.checked ? 'Mic monitoring on—use headphones to prevent feedback' : 'Mic monitoring off');
};
for (const eventName of ['pointerdown', 'mousedown', 'touchstart']) {
  $('#pushToTalkButton').addEventListener(eventName, (event) => { event.preventDefault(); beginPushToTalk(); });
}
for (const eventName of ['pointerup', 'pointercancel', 'mouseleave', 'mouseup', 'touchend']) {
  $('#pushToTalkButton').addEventListener(eventName, (event) => { event.preventDefault(); endPushToTalk(); });
}
window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (event.code === 'Space' && state.djMic.pushToTalk && !typing) {
    event.preventDefault();
    beginPushToTalk();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && state.djMic.pushToTalk) {
    event.preventDefault();
    endPushToTalk();
  }
});
$('#queueSearch').oninput = (event) => { state.queueSearch = event.target.value.trim().toLocaleLowerCase(); renderQueue(); };

async function toggleMiniPlayer() {
  state.miniPlayer = !state.miniPlayer;
  document.body.classList.toggle('mini-mode', state.miniPlayer);
  await window.spider.setMiniPlayer(state.miniPlayer);
  $('#miniPlayerButton').textContent = state.miniPlayer ? 'Full Player' : 'Mini Player';
}
$('#miniPlayerButton').onclick = toggleMiniPlayer;
$('#miniPlayerSettingsButton').onclick = toggleMiniPlayer;
$('#startupToggle').onchange = async (event) => {
  event.target.checked = await window.spider.setStartup(event.target.checked);
  toast(event.target.checked ? 'Spider will start when you sign in' : 'Startup launch disabled');
};

$('#startBroadcastButton').onclick = startBroadcast;
$('#stopBroadcastButton').onclick = stopBroadcast;
$('#copyBroadcastButton').onclick = async () => {
  if (!state.radio.active) return;
  try { await navigator.clipboard.writeText(state.radio.publicUrl); toast('Broadcast link copied'); }
  catch { toast(state.radio.publicUrl); }
};
$('#openBroadcastButton').onclick = () => { if (state.radio.publicUrl) window.open(state.radio.publicUrl); };
for (const input of [$('#broadcastName'), $('#broadcastDj'), $('#broadcastDescription')]) {
  input.oninput = () => { renderRadio(); saveState(); };
}
$('#broadcastProfiles').onchange = (event) => {
  if (event.target.value === '') return;
  const profile = state.radio.profiles[Number(event.target.value)];
  if (!profile) return;
  $('#broadcastName').value = profile.name || '';
  $('#broadcastDj').value = profile.dj || '';
  $('#broadcastDescription').value = profile.description || '';
  renderRadio();
  saveState();
};

$$('[data-service]').forEach((button) => {
  button.onclick = () => {
    void window.spider.openService(button.dataset.service);
    toast(`${button.textContent.trim()} opened in a secure service window`);
  };
});

$$('.nav-button[data-panel]').forEach((button) => { button.onclick = () => showPanel(button.dataset.panel); });
$$('.close-panel').forEach((button) => { button.onclick = () => showPanel('player'); });

$('#addStreamButton').onclick = () => {
  const value = $('#streamUrl').value.trim();
  let url;
  try { url = new URL(value); } catch { toast('Enter a valid stream URL'); return; }
  if (!['http:', 'https:'].includes(url.protocol)) { toast('Streams must use HTTP or HTTPS'); return; }
  const name = $('#streamName').value.trim() || url.hostname;
  const item = { id: `stream-${Date.now()}`, title: name, name, artist: url.hostname, source: 'network', url: url.href, extension: 'STREAM' };
  addEntries([item]);
  showPanel('player');
};

$('#favoriteButton').onclick = () => {
  $('#favoriteButton').classList.toggle('active');
  $('#favoriteButton').textContent = $('#favoriteButton').classList.contains('active') ? '♥' : '♡';
};
$('#aboutButton').onclick = () => $('#aboutModal').classList.remove('hidden');
$('#closeAbout').onclick = () => $('#aboutModal').classList.add('hidden');
$('#aboutModal').onclick = (event) => { if (event.target === $('#aboutModal')) $('#aboutModal').classList.add('hidden'); };

window.addEventListener('dragenter', (event) => { event.preventDefault(); dragDepth += 1; $('#dropOverlay').classList.add('show'); });
window.addEventListener('dragover', (event) => { event.preventDefault(); });
window.addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.remove('show'); } });
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').classList.remove('show');
  const entries = await window.spider.droppedMedia(event.dataTransfer.files);
  addEntries(entries);
});

window.spider.onNearbyEvent((event) => {
  if (event.type === 'guest-request') {
    state.guestRequests.push(event.item);
    renderRequests();
    toast(`${event.item.guest} requested “${event.item.song}”`);
  } else if (event.type === 'file-received') {
    if (event.media) addEntries([event.media], false);
    toast(`${event.name} received in Downloads › Spider Received`);
  } else if (event.type === 'party-vote') {
    const item = state.queue.find((entry) => entry.id === event.id);
    if (item) {
      item.votes = event.votes;
      renderQueue();
    }
  } else if (event.type === 'transfer-start' || event.type === 'transfer-progress') {
    state.transfers.set(event.id, { ...(state.transfers.get(event.id) || {}), ...event });
    renderTransfers();
  } else if (event.type === 'transfer-complete' || event.type === 'transfer-error') {
    const item = { ...(state.transfers.get(event.id) || {}), ...event, progress: event.type === 'transfer-complete' ? 100 : 0, error: event.message || '' };
    state.transfers.set(event.id, item);
    renderTransfers();
    setTimeout(() => { state.transfers.delete(event.id); renderTransfers(); }, 4500);
  }
});

window.spider.onRadioEvent((event) => {
  if (event.type === 'listener-connected') startListenerRecorder(event.id);
  if (event.type === 'listener-disconnected') stopListenerRecorder(event.id);
  if (Number.isFinite(event.listenerCount)) state.radio.listenerCount = event.listenerCount;
  if (event.type === 'stopped') Object.assign(state.radio, { active: false, publicUrl: '', listenerCount: 0 });
  renderRadio();
});

window.spider.onOpenMedia((entries) => addEntries(entries));

async function initialize() {
  restoreState();
  const info = await window.spider.appInfo();
  $('#versionLabel').textContent = `v${info.version}`;
  $('#aboutVersion').textContent = `Version ${info.version}`;
  state.nearby = await window.spider.nearbyInfo();
  renderNearby();
  renderQueue();
  renderRequests();
  renderEqualizer();
  renderRadioProfiles();
  renderRadio();
  renderDjMic();
  $('#startupToggle').checked = await window.spider.getStartup();
  updateNowPlaying();
  void refreshAudioDevices();
  void refreshMicrophones();
  requestAnimationFrame(visualizerFrame);
  if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => {
    void refreshAudioDevices();
    void refreshMicrophones();
  });
  if ('mediaSession' in navigator) {
    for (const [action, handler] of [
      ['play', () => { if (activeMedia().paused) togglePlay(); }],
      ['pause', () => { if (!activeMedia().paused) togglePlay(); }],
      ['previoustrack', () => advance(-1)],
      ['nexttrack', () => advance(1)],
      ['seekbackward', (details) => { activeMedia().currentTime = Math.max(0, activeMedia().currentTime - (details.seekOffset || 10)); }],
      ['seekforward', (details) => { activeMedia().currentTime = Math.min(activeMedia().duration || Infinity, activeMedia().currentTime + (details.seekOffset || 10)); }]
    ]) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
  }
}

void initialize();
