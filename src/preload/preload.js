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

  // Window controls (custom frameless titlebar)
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winClose: () => ipcRenderer.invoke('win:close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  clearCache: () => ipcRenderer.invoke('settings:clearCache'),

  onJobProgress: (cb) => ipcRenderer.on('job:progress', (_e, d) => cb(d)),
  onJobDone: (cb) => ipcRenderer.on('job:done', (_e, d) => cb(d)),
  onJobError: (cb) => ipcRenderer.on('job:error', (_e, d) => cb(d)),
});
