'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const fs = require('fs');
const ffmpegPath = require('./ffmpeg/ffmpegPath');
const { registerIpc, cleanupFpsTemp, cleanupTtsTemp } = require('./ipc');
const aiModels = require('./aiModels');

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

// ---- First-run AI model setup --------------------------------------------
// The NSIS installer writes the user's optional-model choices to
// `$INSTDIR\ai-setup.json` (see build/installer.nsh). At runtime, $INSTDIR is
// the directory containing the app exe, so we look there via
// `path.dirname(app.getPath('exe'))`. If the file exists we download each
// chosen model once (sequentially), notify the renderer, then delete the file
// so this only ever runs on the first launch after install.
//
// Dev/testing note: in `npm start` app.getPath('exe') is electron.exe, so the
// file is looked for next to electron.exe. To simulate first-run in dev, set
// the env var AI_SETUP_DIR to a folder containing an ai-setup.json (e.g. the
// project root); it takes precedence over the exe dir when present.
function setupFilePath() {
  const overrideDir = process.env.AI_SETUP_DIR;
  const baseDir = overrideDir || path.dirname(app.getPath('exe'));
  return path.join(baseDir, 'ai-setup.json');
}

async function maybeRunFirstRunSetup(win) {
  let file;
  try {
    file = setupFilePath();
    if (!fs.existsSync(file)) return; // no setup recorded — nothing to do

    const raw = fs.readFileSync(file, 'utf8');
    const choices = JSON.parse(raw) || {};

    // Build the list of { feature, id } selections, ignoring empty/None values.
    const items = [];
    if (choices.whisper) items.push({ feature: 'whisper', id: String(choices.whisper) });
    if (choices.bgremoval) items.push({ feature: 'bgremoval', id: String(choices.bgremoval) });

    if (!items.length) { try { fs.unlinkSync(file); } catch { /* */ } return; }

    const send = (channel, payload) => {
      try { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); } catch { /* */ }
    };

    send('firstrun:start', { items });

    for (const it of items) {
      try {
        // Reuse the same progress channel the model-manager UI listens on.
        await aiModels.download(it.feature, it.id, (p) => send('aimodel:progress', p));
      } catch (err) {
        // One model failing shouldn't block the others; the user can retry in
        // Settings → Local AI. Just log and continue.
        console.error('[first-run] model download failed:', it.feature, it.id, err && err.message);
      }
    }

    send('firstrun:done', { items });
  } catch (err) {
    console.error('[first-run] setup error:', err && err.message);
  } finally {
    // Always remove the setup file so first-run never repeats.
    try { if (file) fs.unlinkSync(file); } catch { /* */ }
  }
}

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
    const win = createWindow();
    // Kick off first-run AI model setup asynchronously once the window is shown
    // so it never blocks startup. Fire-and-forget: maybeRunFirstRunSetup is
    // fully wrapped in try/catch and does nothing if no setup file exists.
    win.webContents.once('did-finish-load', () => { maybeRunFirstRunSetup(win); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

// Delete the FPS-changer and TTS preview temp caches on quit so previews never linger.
app.on('before-quit', () => { try { cleanupFpsTemp(); } catch { /* */ } try { cleanupTtsTemp(); } catch { /* */ } });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

module.exports = { createWindow };
