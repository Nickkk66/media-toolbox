'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const encoders = require('./ffmpeg/encoders');
const ffmpegPath = require('./ffmpeg/ffmpegPath');
const media = require('./media');
const youtube = require('./youtube');
const settings = require('./settings');
const { Queue } = require('./queue');

// Pick a non-clobbering output path. Compress jobs get a "_compressed" suffix;
// convert jobs keep the base name (just a new extension).
function uniqueOutput(outputDir, baseName, ext, convert) {
  // All outputs start with "MTB_" (Media Toolbox).
  const suffix = convert ? '' : '_compressed';
  let candidate = path.join(outputDir, `MTB_${baseName}${suffix}.${ext}`);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `MTB_${baseName}${suffix} (${n}).${ext}`);
    n += 1;
  }
  return candidate;
}

function allExtensions() {
  const set = new Set();
  for (const mod of Object.values(media.MODULES)) {
    for (const e of mod.extensions) set.add(e);
  }
  return [...set];
}

function registerIpc(getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const queue = new Queue({
    onProgress: (p) => send('job:progress', p),
    onDone: (p) => send('job:done', p),
    onError: (p) => send('job:error', p),
  });

  // Capabilities the renderer needs to build the UI.
  ipcMain.handle('app:capabilities', async () => ({
    encoders: await encoders.detect(),
    media: media.describe(),
    hasGhostscript: ffmpegPath.hasGhostscript(),
    hasYtdlp: ffmpegPath.hasYtdlp(),
    hasSevenzip: ffmpegPath.hasSevenzip(),
    hasQpdf: ffmpegPath.hasQpdf(),
  }));

  // ---- YouTube / yt-dlp ----
  let ytController = null;
  ipcMain.handle('yt:info', (_e, url) => youtube.info(url));
  ipcMain.handle('yt:download', async (_e, opts) => {
    const outputDir = opts.outputDir || require('os').homedir();
    ytController = youtube.download({ ...opts, outputDir }, (p) => send('yt:progress', p));
    try {
      const res = await ytController.promise;
      return res;
    } finally {
      ytController = null;
    }
  });
  ipcMain.handle('yt:cancel', () => { if (ytController) ytController.cancel(); return true; });

  ipcMain.handle('media:typeForPath', (_e, p) => media.typeForPath(p));

  ipcMain.handle('media:probe', async (_e, { inputPath, mediaType }) => {
    const type = mediaType || media.typeForPath(inputPath);
    const mod = media.getByType(type);
    if (!mod) throw new Error('Unsupported file type.');
    const meta = await mod.probe(inputPath);
    meta.type = type;
    return meta;
  });

  ipcMain.handle('dialog:pickFiles', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Add files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported media', extensions: allExtensions() },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('dialog:pickSubtitle', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose subtitle file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa', 'vtt'] }],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  });

  ipcMain.handle('job:start', async (_e, spec) => {
    // spec: { jobId, mediaType, inputPath, settings, meta, outputDir }
    const detected = await encoders.detect();
    const mod = media.getByType(spec.mediaType);
    if (!mod) throw new Error('Unsupported media type.');
    // Apply the usage limit (ffmpeg thread cap) from settings.
    spec.settings = { ...spec.settings, threads: settings.load().threads || 0 };

    const parsed = path.parse(spec.inputPath);
    const outputDir = spec.outputDir || parsed.dir;
    const ext = mod.outExt(spec.settings, spec.inputPath);
    const outputPath = uniqueOutput(outputDir, parsed.name, ext, spec.convert);

    queue.add({
      jobId: spec.jobId,
      mediaType: spec.mediaType,
      inputPath: spec.inputPath,
      outputPath,
      settings: spec.settings,
      meta: spec.meta,
      detected,
    });
    return { jobId: spec.jobId, outputPath };
  });

  // PDF merge: combine several PDFs into one (multi-input, single output).
  ipcMain.handle('pdf:merge', async (_e, { inputs, outputDir }) => {
    if (!ffmpegPath.hasGhostscript()) throw new Error('PDF merge requires Ghostscript.');
    if (!inputs || inputs.length < 2) throw new Error('Add at least two PDFs to merge.');
    const dir = outputDir || path.dirname(inputs[0]);
    const out = uniqueOutput(dir, 'merged', 'pdf', true);
    const args = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dNOPAUSE', '-dBATCH', '-dQUIET', '-o', out, ...inputs];
    await new Promise((resolve, reject) => {
      require('child_process').execFile(ffmpegPath.ghostscript, args, { windowsHide: true }, (err, _o, stderr) => {
        if (err) return reject(new Error('Merge failed: ' + (stderr || err.message).split('\n')[0]));
        resolve();
      });
    });
    let outSize = 0; try { outSize = fs.statSync(out).size; } catch { /* */ }
    return { outputPath: out, outSize };
  });

  ipcMain.handle('job:cancel', (_e, jobId) => { queue.cancel(jobId); return true; });
  ipcMain.handle('job:cancelAll', () => { queue.cancelAll(); return true; });

  ipcMain.handle('shell:showItem', (_e, filePath) => { shell.showItemInFolder(filePath); return true; });
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });

  // Window controls (custom titlebar)
  ipcMain.handle('win:minimize', () => { const w = getWindow(); if (w) w.minimize(); });
  ipcMain.handle('win:maximize', () => { const w = getWindow(); if (!w) return; if (w.isMaximized()) w.unmaximize(); else w.maximize(); });
  ipcMain.handle('win:close', () => { const w = getWindow(); if (w) w.close(); });

  // Settings
  ipcMain.handle('settings:get', () => settings.load());
  ipcMain.handle('settings:set', (_e, patch) => settings.save(patch));
}

module.exports = { registerIpc };
