const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('spider', {
  appInfo: () => invoke('app:info'),
  chooseMedia: () => invoke('media:choose'),
  prepareMovie: (url) => invoke('media:prepare-compatibility', url),
  cancelMoviePreparation: () => invoke('media:cancel-compatibility'),
  onMoviePreparation: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('media:compatibility-progress', listener);
    return () => ipcRenderer.removeListener('media:compatibility-progress', listener);
  },
  chooseFolder: () => invoke('media:choose-folder'),
  droppedMedia: (files) => invoke(
    'media:from-paths',
    [...files].map((file) => webUtils.getPathForFile(file)).filter(Boolean)
  ),
  openService: (service, query) => invoke('service:open', service, query),
  openWebPage: (url) => invoke('web:open', url),
  loadIptvPlaylist: (url) => invoke('iptv:load', url),
  searchRadioDirectory: (options) => invoke('radio:directory-search', options || {}),
  openBluetooth: () => invoke('devices:open-bluetooth'),
  startNearby: () => invoke('nearby:start'),
  stopNearby: () => invoke('nearby:stop'),
  nearbyInfo: () => invoke('nearby:info'),
  chooseShareFiles: () => invoke('nearby:choose-files'),
  removeShareFile: (id) => invoke('nearby:remove-file', id),
  partyState: (state) => invoke('party:set-state', state),
  resolveRequest: (id, resolution) => invoke('party:resolve-request', id, resolution),
  startRadio: (profile) => invoke('radio:start', profile),
  stopRadio: () => invoke('radio:stop'),
  updateRadio: (metadata) => invoke('radio:update', metadata),
  radioChunk: (listenerId, bytes) => ipcRenderer.send('radio:chunk', listenerId, bytes),
  setMiniPlayer: (enabled) => invoke('window:set-mini', enabled),
  getStartup: () => invoke('app:get-startup'),
  setStartup: (enabled) => invoke('app:set-startup', enabled),
  onNearbyEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('nearby:event', listener);
    return () => ipcRenderer.removeListener('nearby:event', listener);
  },
  onRadioEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('radio:event', listener);
    return () => ipcRenderer.removeListener('radio:event', listener);
  },
  onMediaKey: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('media:key', listener);
    return () => ipcRenderer.removeListener('media:key', listener);
  },
  onRemoteCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('remote:command', listener);
    return () => ipcRenderer.removeListener('remote:command', listener);
  },
  publishRemoteState: (snapshot) => ipcRenderer.send('remote:state', snapshot),
  remoteStart: () => invoke('remote:start'),
  remoteStop: () => invoke('remote:stop'),
  remoteInfo: () => invoke('remote:info'),
  remoteRevoke: () => invoke('remote:revoke'),
  onOpenMedia: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('media:open', listener);
    return () => ipcRenderer.removeListener('media:open', listener);
  }
  ,
  // Recording helpers: save a finished recording blob to disk
  saveRecording: (name, bytes) => invoke('recording:save', name, bytes)
  ,
  recordingStart: (tempName) => invoke('recording:start', tempName),
  recordingAppend: (id, bytes) => invoke('recording:append', id, bytes),
  recordingFinish: (id, finalName) => invoke('recording:finish', id, finalName)
  ,
  showRecording: (filePath) => invoke('recording:show', filePath)
  ,
  getRecordingInfo: (filePath) => invoke('recording:info', filePath),
  openRecording: (filePath) => invoke('recording:open', filePath),
  deleteRecording: (filePath) => invoke('recording:delete', filePath)
  ,
  synthesizeSpeech: (text) => invoke('speech:synthesize', text)
});
