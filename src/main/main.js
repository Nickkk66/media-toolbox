'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const ffmpegPath = require('./ffmpeg/ffmpegPath');
const { registerIpc } = require('./ipc');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#f6f8f7',
    title: 'Media Toolbox',
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

function focused() { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null; }

function selfCheck() {
  return new Promise((resolve) => {
    execFile(ffmpegPath.ffmpeg, ['-hide_banner', '-version'], { windowsHide: true },
      (err, stdout) => resolve({ ok: !err, version: (stdout || '').split('\n')[0] || '', error: err ? String(err.message) : null }));
  });
}

// Single-instance: a second launch pings the running app, which asks the user
// (in-app, sleek) whether to open another window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = focused();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); w.webContents.send('app:second-instance'); }
  });

  app.whenReady().then(async () => {
    const check = await selfCheck();
    if (!check.ok) {
      dialog.showErrorBox('ffmpeg not found',
        'The bundled engine (ffmpeg) could not be started.\n\nIf running from source, place ffmpeg.exe and ffprobe.exe in vendor/bin.\n\nDetails: ' + (check.error || 'unknown error'));
    }
    registerIpc(() => focused());
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { createWindow };
