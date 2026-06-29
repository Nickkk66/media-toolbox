'use strict';

// Resolves the bundled ffmpeg / ffprobe binaries.
//
// In a packaged app electron-builder copies vendor/bin -> <resources>/bin
// (see electron-builder.yml extraResources). In development we look in the
// local vendor/bin folder, and finally fall back to whatever is on PATH so the
// app still runs from source even before binaries are vendored.

const path = require('path');
const fs = require('fs');

let electronApp = null;
try {
  // Available in the main process only.
  electronApp = require('electron').app;
} catch {
  electronApp = null;
}

const EXE = process.platform === 'win32' ? '.exe' : '';

// `subdir` is the folder under resources/ (packaged) or vendor/ (dev) that holds
// the binary: 'bin' for ffmpeg/ffprobe, 'gs' for ghostscript.
function candidates(name, subdir) {
  const bin = `${name}${EXE}`;
  const list = [];

  // 0. On-demand cache: <userData>/engines/<subdir>/<bin> (downloaded at runtime
  //    by engines.js). Checked FIRST so a fetched engine always wins.
  if (electronApp && typeof electronApp.getPath === 'function') {
    try { list.push(path.join(electronApp.getPath('userData'), 'engines', subdir, bin)); } catch { /* */ }
  }

  // 1. Packaged: resources/<subdir>/<bin>
  if (process.resourcesPath) {
    list.push(path.join(process.resourcesPath, subdir, bin));
  }

  // 2. Dev: <projectRoot>/vendor/<subdir>/<bin>
  //    __dirname = src/main/ffmpeg -> up 3 = project root
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  list.push(path.join(projectRoot, 'vendor', subdir, bin));

  // 3. App path (when running unpackaged via electron .)
  if (electronApp && typeof electronApp.getAppPath === 'function') {
    list.push(path.join(electronApp.getAppPath(), 'vendor', subdir, bin));
  }

  return list;
}

function resolve(name, subdir) {
  for (const c of candidates(name, subdir)) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  // 4. Fall back to PATH lookup (bare command name).
  return `${name}${EXE}`;
}

// Resolve + cache. We only cache a REAL absolute hit — if the engine isn't
// present yet (on-demand download still pending) we keep re-resolving so the
// freshly unpacked binary is picked up on the next access instead of being
// stuck on the bare-name PATH fallback.
const _cache = {};
function locate(slot, name, subdir) {
  const cur = _cache[slot];
  if (cur && path.isAbsolute(cur) && fs.existsSync(cur)) return cur;
  const r = resolve(name, subdir);
  if (path.isAbsolute(r) && fs.existsSync(r)) _cache[slot] = r;
  return r;
}

module.exports = {
  get ffmpeg() { return locate('ffmpeg', 'ffmpeg', 'bin'); },
  get ffprobe() { return locate('ffprobe', 'ffprobe', 'bin'); },
  // Ghostscript's CLI is gswin64c on Windows, plain `gs` on macOS/Linux.
  get ghostscript() { return locate('gs', process.platform === 'win32' ? 'gswin64c' : 'gs', 'gs'); },
  get ytdlp() { return locate('ytdlp', 'yt-dlp', 'bin'); },
  get sevenzip() { return locate('sevenzip', '7za', 'bin'); },
  get qpdf() { return locate('qpdf', 'qpdf', 'qpdf'); },
  // exiftool.exe needs its 'exiftool_files/' folder sitting beside it.
  get exiftool() { return locate('exiftool', 'exiftool', 'exiftool'); },
  // realesrgan-ncnn-vulkan.exe + vcomp140.dll + a models/ folder beside it.
  get realesrgan() { return locate('realesrgan', 'realesrgan-ncnn-vulkan', 'realesrgan'); },
  // whisper-cli.exe (whisper.cpp) + its ggml/openblas DLLs beside it.
  get whisper() { return locate('whisper', 'whisper-cli', 'whisper'); },
  // piper.exe (Piper TTS) + its DLLs + espeak-ng-data/ beside it; voices downloaded.
  get piper() { return locate('piper', 'piper', 'piper'); },
  // True only when a real bundled/vendored binary was found (not a PATH fallback).
  isBundled() {
    return path.isAbsolute(this.ffmpeg) && fs.existsSync(this.ffmpeg);
  },
  hasGhostscript() {
    return path.isAbsolute(this.ghostscript) && fs.existsSync(this.ghostscript);
  },
  hasYtdlp() {
    return path.isAbsolute(this.ytdlp) && fs.existsSync(this.ytdlp);
  },
  hasSevenzip() {
    return path.isAbsolute(this.sevenzip) && fs.existsSync(this.sevenzip);
  },
  hasQpdf() {
    return path.isAbsolute(this.qpdf) && fs.existsSync(this.qpdf);
  },
  hasExiftool() {
    return path.isAbsolute(this.exiftool) && fs.existsSync(this.exiftool);
  },
  hasRealesrgan() {
    return path.isAbsolute(this.realesrgan) && fs.existsSync(this.realesrgan);
  },
  hasWhisper() {
    return path.isAbsolute(this.whisper) && fs.existsSync(this.whisper);
  },
  hasPiper() {
    return path.isAbsolute(this.piper) && fs.existsSync(this.piper);
  },
};
