'use strict';

const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
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

// Resolve the output directory from the per-job choice or the saved default.
function resolveOutputDir(spec, parsedDir) {
  if (spec.outputDir) return spec.outputDir;
  const s = settings.load();
  if (s.downloadLocation === 'downloads') { try { return app.getPath('downloads'); } catch { return parsedDir; } }
  if (s.downloadLocation === 'custom' && s.customDownloadDir) return s.customDownloadDir;
  return parsedDir; // 'source'
}

function registerIpc(getWindow) {
  // Broadcast to every open window (supports multiple instances/windows).
  const send = (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(channel, payload); });
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
    appVersion: (() => { try { return app.getVersion(); } catch { return '1.0.0'; } })(),
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
    const outputDir = resolveOutputDir(spec, parsed.dir);
    try { fs.mkdirSync(outputDir, { recursive: true }); } catch { /* */ }
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
  ipcMain.handle('job:pause', (_e, jobId) => queue.pause(jobId));
  ipcMain.handle('job:resume', (_e, jobId) => queue.resume(jobId));

  // Delete a produced file (or folder) — for the post-job delete button.
  ipcMain.handle('fs:delete', (_e, p) => {
    try {
      if (!p) return false;
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
      return true;
    } catch { return false; }
  });

  // Open another window (from the "already running" prompt).
  ipcMain.handle('win:new', () => { require('./main').createWindow(); return true; });

  // ---- Metadata editor ----
  const { execFile } = require('child_process');
  const META_KEYS = ['title', 'artist', 'album', 'album_artist', 'composer', 'genre', 'date', 'track', 'comment', 'description'];
  ipcMain.handle('meta:read', (_e, inputPath) => new Promise((resolve, reject) => {
    execFile(ffmpegPath.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', inputPath],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error('Could not read this file.'));
        let tags = {};
        try { tags = (JSON.parse(stdout).format || {}).tags || {}; } catch { /* */ }
        // Normalize keys to lowercase.
        const norm = {}; for (const k of Object.keys(tags)) norm[k.toLowerCase()] = tags[k];
        // Surface every standard key plus any extra tag the file already carries.
        const keys = [...META_KEYS];
        for (const k of Object.keys(norm)) if (!keys.includes(k)) keys.push(k);
        resolve({ tags: norm, keys });
      });
  }));
  ipcMain.handle('meta:write', async (_e, { inputPath, tags, scrub, outputDir }) => {
    const parsed = path.parse(inputPath);
    const dir = resolveOutputDir({ outputDir }, parsed.dir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    const out = uniqueOutput(dir, parsed.name, parsed.ext.replace('.', '') || 'mp4', true);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath, '-map', '0', '-c', 'copy'];
    if (scrub) args.push('-map_metadata', '-1');
    if (tags) for (const [k, v] of Object.entries(tags)) { if (v != null && String(v).length) args.push('-metadata', `${k}=${v}`); }
    args.push(out);
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath.ffmpeg, args, { windowsHide: true }, (err, _o, stderr) => err ? reject(new Error((stderr || err.message).split('\n')[0])) : resolve());
    });
    let outSize = 0; try { outSize = fs.statSync(out).size; } catch { /* */ }
    return { outputPath: out, outSize };
  });

  ipcMain.handle('shell:showItem', (_e, filePath) => { shell.showItemInFolder(filePath); return true; });
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });

  // Window controls (custom titlebar)
  ipcMain.handle('win:minimize', () => { const w = getWindow(); if (w) w.minimize(); });
  ipcMain.handle('win:maximize', () => { const w = getWindow(); if (!w) return; if (w.isMaximized()) w.unmaximize(); else w.maximize(); });
  ipcMain.handle('win:close', () => { const w = getWindow(); if (w) w.close(); });

  // Settings
  ipcMain.handle('settings:get', () => ({ ...settings.load(), cores: settings.cores }));
  ipcMain.handle('settings:set', (_e, patch) => settings.save(patch));
  ipcMain.handle('settings:reset', () => ({ ...settings.reset(), cores: settings.cores }));

  // Export current settings to a JSON file the user picks.
  ipcMain.handle('settings:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export settings',
      defaultPath: path.join(app.getPath('downloads'), 'media-toolbox-settings.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false };
    const data = { ...settings.load() };
    delete data.cores; // runtime-only
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); return { ok: true, filePath }; }
    catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  // Import settings from a JSON file the user picks; merges via save().
  ipcMain.handle('settings:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid file' };
      delete parsed.cores;
      return { ok: true, settings: { ...settings.save(parsed), cores: settings.cores } };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  // Clear locally cached/temp data. We only remove our own scratch caches.
  ipcMain.handle('settings:clearCache', () => {
    let removed = 0;
    try {
      const dirs = [path.join(app.getPath('userData'), 'Cache'), path.join(app.getPath('userData'), 'GPUCache')];
      for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); removed++; } catch { /* */ } }
    } catch { /* */ }
    return { ok: true, removed };
  });
}

module.exports = { registerIpc };
