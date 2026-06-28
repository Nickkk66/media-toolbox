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

// Temp dir for FPS-changer preview renders. Lives under the OS temp folder and
// is wiped on app quit (see main.js) so previews never linger.
function fpsTempDir() {
  return path.join(app.getPath('temp'), 'mtb-fps-preview');
}

// Remove the FPS preview cache dir (called on quit and before each new render).
function cleanupFpsTemp() {
  try { fs.rmSync(fpsTempDir(), { recursive: true, force: true }); } catch { /* */ }
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
    hasExiftool: ffmpegPath.hasExiftool(),
    appVersion: (() => { try { return app.getVersion(); } catch { return '1.0.0'; } })(),
  }));

  // ---- YouTube / yt-dlp ----
  let ytController = null;
  ipcMain.handle('yt:info', (_e, url) => youtube.info(url));
  ipcMain.handle('yt:download', async (_e, opts) => {
    // Resolve the output dir the same way conversions do (resolveOutputDir):
    // honor a per-session folder, else the saved default download location,
    // else the real Downloads folder (falling back to homedir if unavailable).
    let outputDir = opts.outputDir;
    if (!outputDir) {
      const s = settings.load();
      if (s.downloadLocation === 'custom' && s.customDownloadDir) {
        outputDir = s.customDownloadDir;
      } else {
        try { outputDir = app.getPath('downloads'); }
        catch { outputDir = require('os').homedir(); }
      }
    }
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

  // Batch rename: rename a set of files on disk. Each item is { from, to }
  // where `to` is a NEW basename (kept in the same directory as `from`).
  // Safe: skips when source is missing or the target already exists; never
  // overwrites, never escapes the source directory.
  ipcMain.handle('files:rename', async (_e, renames) => {
    const results = [];
    const claimed = new Set(); // targets produced earlier in this batch
    for (const r of (renames || [])) {
      const from = r && r.from;
      let to = r && r.to;
      try {
        if (!from || !to) throw new Error('bad input');
        const dir = path.dirname(from);
        // Force same-directory, name-only (strip any path separators in `to`).
        to = path.basename(String(to)).replace(/[\\/:*?"<>|]/g, '_');
        if (!to) throw new Error('empty name');
        const target = path.join(dir, to);
        if (target === from) { results.push({ ok: true, from, to: target, skipped: true }); continue; }
        if (!fs.existsSync(from)) throw new Error('missing source');
        if (fs.existsSync(target) || claimed.has(target.toLowerCase())) throw new Error('name exists');
        fs.renameSync(from, target);
        claimed.add(target.toLowerCase());
        results.push({ ok: true, from, to: target });
      } catch (err) {
        results.push({ ok: false, from, to, error: String(err && err.message || err) });
      }
    }
    return { results };
  });

  // ---- FPS Changer preview workflow ----
  // Render to a TEMP cache file so the user can preview before exporting. We
  // spawn ffmpeg directly (rather than going through the queue) so the renderer
  // gets a dedicated 'fps:progress' stream and a temp path it can play inline.
  const { spawn } = require('child_process');
  let fpsProc = null;

  ipcMain.handle('fps:render', async (_e, { inputPath, fps, interpolate }) => {
    if (!inputPath) throw new Error('No input file.');
    const target = Math.min(240, Math.max(1, Number(fps) || 30));
    const dir = fpsTempDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }

    // Probe duration up front so we can report determinate progress.
    let durationSec = 0;
    try {
      durationSec = await new Promise((resolve) => {
        execFile(ffmpegPath.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inputPath],
          { windowsHide: true }, (err, stdout) => resolve(err ? 0 : parseFloat(String(stdout).trim()) || 0));
      });
    } catch { durationSec = 0; }

    // One temp file per render; the previous one is removed first.
    cleanupFpsTemp();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    const tempPath = path.join(dir, `preview_${Date.now()}.mp4`);

    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-i', inputPath];
    if (interpolate) {
      args.push('-filter:v', `minterpolate=fps=${target}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir`);
    } else {
      args.push('-r', String(target));
    }
    args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', tempPath);

    // Kill any in-flight preview render before starting a new one.
    if (fpsProc) { try { fpsProc.kill('SIGKILL'); } catch { /* */ } fpsProc = null; }

    return await new Promise((resolve, reject) => {
      let stderrTail = '';
      const proc = spawn(ffmpegPath.ffmpeg, args, { windowsHide: true });
      fpsProc = proc;

      // Parse '-progress' key=value output for out_time/percent.
      proc.stdout.on('data', (buf) => {
        const text = buf.toString();
        const m = /out_time_ms=(\d+)/.exec(text);
        if (m && durationSec > 0) {
          const sec = Number(m[1]) / 1e6;
          const percent = Math.max(0, Math.min(99.5, (sec / durationSec) * 100));
          send('fps:progress', { percent });
        } else {
          send('fps:progress', { indeterminate: true });
        }
      });
      proc.stderr.on('data', (b) => { stderrTail = (stderrTail + b.toString()).slice(-2000); });
      proc.on('error', (err) => { fpsProc = null; reject(new Error(err.message)); });
      proc.on('close', (code) => {
        fpsProc = null;
        if (code === 0 && fs.existsSync(tempPath)) {
          send('fps:progress', { percent: 100 });
          resolve({ tempPath });
        } else {
          try { fs.unlinkSync(tempPath); } catch { /* */ }
          reject(new Error((stderrTail || 'ffmpeg failed').split('\n').filter(Boolean).pop() || 'Render failed.'));
        }
      });
    });
  });

  // Copy the previewed temp file to the chosen output dir as a unique MTB_ file.
  ipcMain.handle('fps:export', async (_e, { tempPath, outputDir }) => {
    if (!tempPath || !fs.existsSync(tempPath)) throw new Error('No preview to export.');
    const dir = resolveOutputDir({ outputDir }, path.dirname(tempPath));
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    const out = uniqueOutput(dir, 'fps', 'mp4', true);
    fs.copyFileSync(tempPath, out);
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

  // Image extensions exiftool handles for the rich EXIF/IPTC/XMP/ICC editor.
  const IMAGE_META_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'jfif', 'heic', 'heif', 'gif', 'avif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
  // Groups whose tags are computed/derived from the file — show but don't edit.
  const READONLY_META_GROUPS = new Set(['File', 'Composite', 'ExifTool']);

  function prettifyTag(tag) {
    // 'GPSLatitudeRef' -> 'GPS Latitude Ref', 'ImageWidth' -> 'Image Width'.
    return String(tag)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim();
  }

  // File-system info shared by both the ffprobe and exiftool read paths.
  function readFileInfo(inputPath) {
    try {
      const st = fs.statSync(inputPath);
      return {
        sizeBytes: st.size,
        sizeOnDisk: Math.ceil(st.size / 4096) * 4096,
        createdMs: st.birthtimeMs,
        modifiedMs: st.mtimeMs,
        accessedMs: st.atimeMs,
        readOnly: !(st.mode & 0o200),
      };
    } catch { return null; }
  }

  // Image metadata via exiftool: every grouped tag (incl. unknown/dup), split
  // into an editable list (EXIF/IPTC/XMP/ICC/GPS/JFIF/MakerNotes/...) and a
  // read-only list (File/Composite/ExifTool — computed/file fields).
  function readImageMeta(inputPath) {
    return new Promise((resolve, reject) => {
      execFile(ffmpegPath.exiftool, ['-json', '-G', '-a', '-u', inputPath],
        { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
          if (err && !stdout) return reject(new Error('Could not read image metadata.'));
          let arr = [];
          try { arr = JSON.parse(stdout) || []; } catch { /* */ }
          const obj = arr[0] || {};
          const editable = [];
          const readonly = [];
          for (const fullKey of Object.keys(obj)) {
            if (fullKey === 'SourceFile') continue;
            const sep = fullKey.indexOf(':');
            const group = sep > 0 ? fullKey.slice(0, sep) : 'Other';
            const tag = sep > 0 ? fullKey.slice(sep + 1) : fullKey;
            let value = obj[fullKey];
            // exiftool can return objects/arrays for structured tags — flatten.
            if (value != null && typeof value === 'object') value = JSON.stringify(value);
            value = value == null ? '' : String(value);
            const label = prettifyTag(tag);
            if (READONLY_META_GROUPS.has(group)) {
              readonly.push({ label: `${group} · ${label}`, value });
            } else {
              editable.push({ key: fullKey, label, group, value });
            }
          }
          resolve({ kind: 'image', editable, readonly, hasExiftool: true, fileInfo: readFileInfo(inputPath) });
        });
    });
  }

  ipcMain.handle('meta:read', (_e, inputPath) => {
    const ext = (path.extname(inputPath || '').replace('.', '') || '').toLowerCase();
    if (IMAGE_META_EXTS.includes(ext) && ffmpegPath.hasExiftool()) {
      return readImageMeta(inputPath);
    }
    return readAvMeta(inputPath);
  });

  // Audio/video metadata via ffprobe (unchanged behavior).
  const readAvMeta = (inputPath) => new Promise((resolve, reject) => {
    // Read BOTH container-level (format) and per-stream tags. For MP4/MKV the
    // real tags (creation_time, encoder, handler_name, language, title…) often
    // live on the streams, not the container, so we must merge them.
    execFile(ffmpegPath.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error('Could not read this file.'));
        let parsed = {};
        try { parsed = JSON.parse(stdout) || {}; } catch { /* */ }
        // Merge every tag source into one lowercased object. Streams are merged
        // first (first-seen value kept for stream-only keys), then format-level
        // tags are applied last so they win on conflict.
        const norm = {};
        const mergeFirst = (tags) => { if (!tags) return; for (const k of Object.keys(tags)) { const lk = k.toLowerCase(); if (!(lk in norm)) norm[lk] = tags[k]; } };
        for (const s of (parsed.streams || [])) mergeFirst(s.tags);
        const fmtTags = (parsed.format || {}).tags || {};
        for (const k of Object.keys(fmtTags)) norm[k.toLowerCase()] = fmtTags[k];
        // Union of the standard keys plus every merged key the file carries.
        const keys = [...META_KEYS];
        for (const k of Object.keys(norm)) if (!keys.includes(k)) keys.push(k);
        // Detect the media kind from the first ffprobe stream codec_type.
        let codecType = null;
        for (const s of (parsed.streams || [])) { if (s.codec_type === 'video') { codecType = 'video'; break; } if (s.codec_type === 'audio') codecType = codecType || 'audio'; }
        const hasAudio = (parsed.streams || []).some((s) => s.codec_type === 'audio');
        const kind = codecType === 'video' ? 'video' : 'audio';
        resolve({ kind, tags: norm, keys, codecType, hasAudio, fileInfo: readFileInfo(inputPath) });
      });
  });
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'jfif', 'gif'];

  // Image metadata write via exiftool: produces a NEW MTB_ copy and never
  // touches the original. Only changed group-qualified tags are written; scrub
  // / clearGps map to exiftool's -all= / -gps:all= deletions.
  async function writeImageMeta({ inputPath, tags, scrub, clearGps, dir }) {
    const parsed = path.parse(inputPath);
    const ext = (parsed.ext.replace('.', '') || 'jpg').toLowerCase();
    const out = uniqueOutput(dir, parsed.name, ext, true);
    const args = [];
    if (scrub) {
      // Strip everything.
      args.push('-all=');
    } else {
      if (clearGps) { args.push('-gps:all='); args.push('-xmp:geotag='); }
      // Each changed editable tag is 'Group:Tag' -> value.
      if (tags) for (const [k, v] of Object.entries(tags)) { args.push(`-${k}=${v == null ? '' : v}`); }
    }
    // -o writes a new file (the original stays untouched). uniqueOutput already
    // guarantees `out` does not exist, so -o will create it.
    args.push('-o', out, inputPath);
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath.exiftool, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, _o, stderr) => {
        // exiftool exits non-zero on warnings even when the copy succeeded —
        // treat the call as failed only if the output file was not produced.
        if (!fs.existsSync(out)) return reject(new Error((stderr || (err && err.message) || 'exiftool failed').split('\n')[0]));
        resolve();
      });
    });
    let outSize = 0; try { outSize = fs.statSync(out).size; } catch { /* */ }
    return { outputPath: out, outSize };
  }

  ipcMain.handle('meta:write', async (_e, { inputPath, kind, tags, scrub, outputDir, clearGps, clearCreation, removeAudio }) => {
    const parsed = path.parse(inputPath);
    const dir = resolveOutputDir({ outputDir }, parsed.dir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
    const ext = (parsed.ext.replace('.', '') || 'mp4').toLowerCase();
    const isImage = IMAGE_EXTS.includes(ext);
    // Images go through exiftool when available (rich EXIF/IPTC/XMP/ICC editing).
    if ((kind === 'image' || isImage) && ffmpegPath.hasExiftool()) {
      return writeImageMeta({ inputPath, tags, scrub, clearGps, dir });
    }
    const out = uniqueOutput(dir, parsed.name, ext, true);
    // Images: -map 0 + -c copy isn't meaningful; encode the single still and let
    // -map_metadata -1 strip everything when scrubbing GPS/creation/metadata.
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath];
    if (!isImage) args.push('-map', '0');
    if (removeAudio) args.push('-an');
    args.push('-c', 'copy');
    if (scrub || (isImage && (clearGps || clearCreation))) {
      args.push('-map_metadata', '-1');
    }
    // Keys to clear (set to empty value so ffmpeg drops them on the copy).
    const clearKeys = [];
    if (clearGps) clearKeys.push(
      'location', 'location-eng', 'com.apple.quicktime.location.ISO6709',
      'com.apple.quicktime.location.accuracy.horizontal', 'GPS', 'GPSLatitude',
      'GPSLongitude', 'GPSAltitude', 'GPSCoordinates'
    );
    if (clearCreation) clearKeys.push(
      'encoder', 'creation_time', 'com.apple.quicktime.make',
      'com.apple.quicktime.model', 'com.apple.quicktime.software',
      'handler_name', 'vendor_id'
    );
    for (const k of clearKeys) args.push('-metadata', `${k}=`);
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

  // Debug: open Chromium DevTools in a detached window for troubleshooting.
  ipcMain.handle('app:openDevTools', () => { const w = getWindow(); if (w) w.webContents.openDevTools({ mode: 'detach' }); });

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

module.exports = { registerIpc, cleanupFpsTemp };
