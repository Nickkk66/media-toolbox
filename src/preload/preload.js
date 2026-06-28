'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  capabilities: () => ipcRenderer.invoke('app:capabilities'),
  typeForPath: (p) => ipcRenderer.invoke('media:typeForPath', p),
  probe: (inputPath, mediaType) => ipcRenderer.invoke('media:probe', { inputPath, mediaType }),

  // Electron 33 removed File.path — resolve a dropped File's real path here.
  getDroppedPath: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },

  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickSubtitle: () => ipcRenderer.invoke('dialog:pickSubtitle'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),

  startJob: (spec) => ipcRenderer.invoke('job:start', spec),
  pdfMerge: (inputs, outputDir) => ipcRenderer.invoke('pdf:merge', { inputs, outputDir }),
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  cancelAll: () => ipcRenderer.invoke('job:cancelAll'),
  pauseJob: (jobId) => ipcRenderer.invoke('job:pause', jobId),
  resumeJob: (jobId) => ipcRenderer.invoke('job:resume', jobId),
  deleteFile: (p) => ipcRenderer.invoke('fs:delete', p),
  filesRename: (renames) => ipcRenderer.invoke('files:rename', renames),

  // FPS Changer preview workflow
  fpsRender: (opts) => ipcRenderer.invoke('fps:render', opts),
  fpsExport: (opts) => ipcRenderer.invoke('fps:export', opts),
  onFpsProgress: (cb) => ipcRenderer.on('fps:progress', (_e, d) => cb(d)),
  newWindow: () => ipcRenderer.invoke('win:new'),
  onSecondInstance: (cb) => ipcRenderer.on('app:second-instance', () => cb()),
  metaRead: (inputPath) => ipcRenderer.invoke('meta:read', inputPath),
  metaWrite: (opts) => ipcRenderer.invoke('meta:write', opts),

  showItem: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  ytInfo: (url) => ipcRenderer.invoke('yt:info', url),
  ytDownload: (opts) => ipcRenderer.invoke('yt:download', opts),
  ytCancel: () => ipcRenderer.invoke('yt:cancel'),
  onYtProgress: (cb) => ipcRenderer.on('yt:progress', (_e, d) => cb(d)),

  // Spotify Downloader
  spotifyInfo: (url) => ipcRenderer.invoke('spotify:info', url),
  spotifyDownload: (opts) => ipcRenderer.invoke('spotify:download', opts),
  spotifyCancel: () => ipcRenderer.invoke('spotify:cancel'),
  onSpotifyProgress: (cb) => ipcRenderer.on('spotify:progress', (_e, d) => cb(d)),

  // About audio player: list bundled songs (with embedded metadata + cover art)
  songsList: () => ipcRenderer.invoke('songs:list'),

  // AI Model Manager (Settings → local ai)
  aimodels: {
    list: () => ipcRenderer.invoke('aimodel:list'),
    download: (feature, id) => ipcRenderer.invoke('aimodel:download', { feature, id }),
    remove: (feature, id) => ipcRenderer.invoke('aimodel:remove', { feature, id }),
    onProgress: (cb) => ipcRenderer.on('aimodel:progress', (_e, p) => cb(p)),
    // Fired after a model finishes downloading or is removed (any window).
    onAimodelChanged: (cb) => ipcRenderer.on('aimodel:changed', () => cb()),
  },

  // First-run AI model setup (installer-chosen models download on first launch)
  onFirstRunStart: (cb) => ipcRenderer.on('firstrun:start', (_e, d) => cb(d)),
  onFirstRunDone: (cb) => ipcRenderer.on('firstrun:done', (_e, d) => cb(d)),

  // Local AI tools (whisper transcription / Real-ESRGAN upscale / bg removal)
  aiTranscribe: (opts) => ipcRenderer.invoke('ai:transcribe', opts),
  aiUpscale: (opts) => ipcRenderer.invoke('ai:upscale', opts),
  aiRemoveBg: (opts) => ipcRenderer.invoke('ai:removebg', opts),
  aiTts: (opts) => ipcRenderer.invoke('ai:tts', opts),
  aiTtsSave: (opts) => ipcRenderer.invoke('ai:tts:save', opts),
  onAiTranscribeProgress: (cb) => ipcRenderer.on('ai:transcribe:progress', (_e, d) => cb(d)),
  onAiUpscaleProgress: (cb) => ipcRenderer.on('ai:upscale:progress', (_e, d) => cb(d)),
  onAiTtsProgress: (cb) => ipcRenderer.on('ai:tts:progress', (_e, d) => cb(d)),

  // Window controls (custom frameless titlebar)
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winClose: () => ipcRenderer.invoke('win:close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  clearCache: () => ipcRenderer.invoke('settings:clearCache'),
  openDevTools: () => ipcRenderer.invoke('app:openDevTools'),

  onJobProgress: (cb) => ipcRenderer.on('job:progress', (_e, d) => cb(d)),
  onJobDone: (cb) => ipcRenderer.on('job:done', (_e, d) => cb(d)),
  onJobError: (cb) => ipcRenderer.on('job:error', (_e, d) => cb(d)),
});
