'use strict';

// On-demand engine binaries.
//
// To keep the installer tiny (~15 MB) we DON'T bundle the heavy native engines
// (ffmpeg, yt-dlp, Ghostscript, Real-ESRGAN, …). Instead each one is published
// as a zip on the GitHub "engines-v1" release and downloaded the first time a
// tool that needs it is used, then cached under <userData>/engines/<subdir>/.
//
// ffmpegPath.js looks in that cache first, so once an engine is unpacked the
// rest of the app finds it exactly as if it had been bundled. In dev the
// binaries already live in vendor/, so isInstalled() is true and nothing is
// downloaded.

const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let app = null;
try { app = require('electron').app; } catch { app = null; }

// Bump the tag (and re-upload assets) when an engine binary needs updating.
const BASE_URL = 'https://github.com/pipelinear/media-toolbox/releases/download/engines-v1/';

// Per-OS bits. On Windows binaries carry .exe; Ghostscript's CLI is gswin64c on
// Windows but gs everywhere else. Mac/Linux binaries need the executable bit set
// after extraction.
const EXE = process.platform === 'win32' ? '.exe' : '';
const GS_BIN = process.platform === 'win32' ? 'gswin64c' : 'gs';

// os-arch slug used in the asset names, e.g. ffmpeg-mac-arm64.zip.
function platformKey() {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

// key -> bundle metadata. `subdir` matches the folders ffmpegPath resolves.
// `name` builds the asset name (`<name>-<os>-<arch>.zip`). `verify` lists the
// files that must exist for the engine to count as installed (platform-aware).
const ENGINES = {
  ffmpeg:      { subdir: 'bin',        name: 'ffmpeg',      verify: [`ffmpeg${EXE}`, `ffprobe${EXE}`],     label: 'media engine (FFmpeg)',  bytes: 63 * 1024 * 1024 },
  ytdlp:       { subdir: 'bin',        name: 'ytdlp',       verify: [`yt-dlp${EXE}`],                      label: 'downloader (yt-dlp)',    bytes: 18 * 1024 * 1024 },
  sevenzip:    { subdir: 'bin',        name: 'sevenzip',    verify: [`7za${EXE}`],                         label: 'archiver (7-Zip)',       bytes: 1 * 1024 * 1024 },
  ghostscript: { subdir: 'gs',         name: 'ghostscript', verify: [`${GS_BIN}${EXE}`],                   label: 'PDF engine (Ghostscript)', bytes: 13 * 1024 * 1024 },
  qpdf:        { subdir: 'qpdf',       name: 'qpdf',        verify: [`qpdf${EXE}`],                        label: 'PDF tool (qpdf)',        bytes: 4 * 1024 * 1024 },
  exiftool:    { subdir: 'exiftool',   name: 'exiftool',    verify: [`exiftool${EXE}`],                    label: 'metadata (ExifTool)',    bytes: 11 * 1024 * 1024 },
  realesrgan:  { subdir: 'realesrgan', name: 'realesrgan',  verify: [`realesrgan-ncnn-vulkan${EXE}`],      label: 'upscaler (Real-ESRGAN)', bytes: 43 * 1024 * 1024 },
  whisper:     { subdir: 'whisper',    name: 'whisper',     verify: [`whisper-cli${EXE}`],                 label: 'transcriber (Whisper)',  bytes: 16 * 1024 * 1024 },
  piper:       { subdir: 'piper',      name: 'piper',       verify: [`piper${EXE}`],                       label: 'text-to-speech (Piper)', bytes: 22 * 1024 * 1024 },
};

function assetName(key) { return `${ENGINES[key].name}-${platformKey()}.zip`; }

function cacheRoot() {
  if (app && typeof app.getPath === 'function') {
    try { return path.join(app.getPath('userData'), 'engines'); } catch { /* */ }
  }
  return path.join(os.tmpdir(), 'mtb-engines');
}

function engineDir(key) { return path.join(cacheRoot(), ENGINES[key].subdir); }

// Places an engine might already live without a download: the cache, the
// packaged resources folder, or the dev vendor/ tree.
function searchDirs(subdir) {
  const list = [path.join(cacheRoot(), subdir)];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, subdir));
  list.push(path.resolve(__dirname, '..', '..', 'vendor', subdir)); // src/main -> projectRoot/vendor
  if (app && typeof app.getAppPath === 'function') {
    try { list.push(path.join(app.getAppPath(), 'vendor', subdir)); } catch { /* */ }
  }
  return list;
}

function presentIn(dir, verify) {
  try { return verify.every((f) => fs.existsSync(path.join(dir, f))); } catch { return false; }
}

// True if every required file for the engine exists in some known location.
function isInstalled(key) {
  const e = ENGINES[key];
  if (!e) return false;
  return searchDirs(e.subdir).some((d) => presentIn(d, e.verify));
}

// True if the engine is installed OR can be fetched — used so the UI keeps a
// tool enabled and triggers the download on first use.
function isAvailable(key) {
  return isInstalled(key) || !!ENGINES[key];
}

// Stream a URL to disk, following GitHub's redirect to the asset CDN, reporting
// fractional progress when a content-length is known.
function downloadTo(url, dest, onFrac, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'media-toolbox' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(downloadTo(new URL(res.headers.location, url).toString(), dest, onFrac, redirects - 1));
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code} while downloading the engine.`)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let received = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { received += c.length; if (onFrac && total) onFrac(received / total); });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => out.close(() => resolve()));
      res.pipe(out);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('Engine download timed out.')));
  });
}

// Unpack a zip: Windows uses the built-in Expand-Archive; macOS/Linux use the
// standard `unzip` (no extra dependency on any platform).
function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch { /* */ }
    let proc;
    if (process.platform === 'win32') {
      const cmd = `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destDir)} -Force`;
      proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
    } else {
      proc = spawn('unzip', ['-o', zipPath, '-d', destDir]);
    }
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error('Could not unpack the engine: ' + (err.split('\n').filter(Boolean).pop() || `exit ${code}`)));
    });
  });
}

// Mac/Linux binaries lose their executable bit through zip — restore it on every
// extracted file (harmless for the odd data file).
function makeExecutable(dir) {
  if (process.platform === 'win32') return;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { fs.chmodSync(full, 0o755); } catch { /* */ } }
    }
  };
  walk(dir);
}

const _pending = new Map(); // key -> in-flight ensure() promise (dedupes parallel calls)

// Make sure an engine is available, downloading+unpacking it if needed.
// onProgress receives { key, label, phase:'download'|'extract'|'done', percent }.
// Returns the directory the engine lives in.
function ensure(key, onProgress) {
  const e = ENGINES[key];
  if (!e) return Promise.reject(new Error(`Unknown engine: ${key}`));
  if (isInstalled(key)) return Promise.resolve(engineDir(key));
  if (_pending.has(key)) return _pending.get(key);

  const task = (async () => {
    const dir = engineDir(key);
    try { fs.mkdirSync(cacheRoot(), { recursive: true }); } catch { /* */ }
    const tmpZip = path.join(cacheRoot(), `${key}.download.zip`);
    try { fs.unlinkSync(tmpZip); } catch { /* */ }

    const report = (phase, percent) => { try { onProgress && onProgress({ key, label: e.label, phase, percent }); } catch { /* */ } };
    report('download', 0);
    try {
      await downloadTo(BASE_URL + assetName(key), tmpZip, (frac) => report('download', Math.round(frac * 100)));
      report('extract', 100);
      await unzip(tmpZip, dir);
      makeExecutable(dir);
      if (!presentIn(dir, e.verify)) throw new Error(`${e.label} unpacked but is missing files; please try again.`);
      report('done', 100);
      return dir;
    } finally {
      try { fs.unlinkSync(tmpZip); } catch { /* */ }
    }
  })();

  _pending.set(key, task);
  return task.finally(() => _pending.delete(key));
}

// Ensure several engines in turn (e.g. ffmpeg + yt-dlp for a download).
async function ensureAll(keys, onProgress) {
  for (const k of keys) {
    if (!isInstalled(k)) await ensure(k, onProgress);
  }
}

module.exports = { ENGINES, ensure, ensureAll, isInstalled, isAvailable, cacheRoot, engineDir };
