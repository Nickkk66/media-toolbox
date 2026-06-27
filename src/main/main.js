'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const ffmpegPath = require('./ffmpeg/ffmpegPath');
const { registerIpc } = require('./ipc');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return mainWindow;
}

// Verify the bundled ffmpeg actually runs before showing the UI.
function selfCheck() {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath.ffmpeg,
      ['-hide_banner', '-version'],
      { windowsHide: true },
      (err, stdout) => {
        resolve({ ok: !err, version: (stdout || '').split('\n')[0] || '', error: err ? String(err.message) : null });
      }
    );
  });
}

app.whenReady().then(async () => {
  const check = await selfCheck();
  if (!check.ok) {
    dialog.showErrorBox(
      'ffmpeg not found',
      'The bundled video engine (ffmpeg) could not be started.\n\n' +
        'If you are running from source, place ffmpeg.exe and ffprobe.exe in the ' +
        'vendor/bin folder.\n\nDetails: ' +
        (check.error || 'unknown error')
    );
  }

  registerIpc(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
