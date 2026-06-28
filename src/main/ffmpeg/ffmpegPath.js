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

// Cache so we only hit the filesystem once.
let _ffmpeg = null;
let _ffprobe = null;
let _gs = null;
let _ytdlp = null;
let _sevenzip = null;
let _qpdf = null;
let _exiftool = null;
let _realesrgan = null;
let _whisper = null;

module.exports = {
  get ffmpeg() {
    if (_ffmpeg === null) _ffmpeg = resolve('ffmpeg', 'bin');
    return _ffmpeg;
  },
  get ffprobe() {
    if (_ffprobe === null) _ffprobe = resolve('ffprobe', 'bin');
    return _ffprobe;
  },
  get ghostscript() {
    if (_gs === null) _gs = resolve('gswin64c', 'gs');
    return _gs;
  },
  get ytdlp() {
    if (_ytdlp === null) _ytdlp = resolve('yt-dlp', 'bin');
    return _ytdlp;
  },
  get sevenzip() {
    if (_sevenzip === null) _sevenzip = resolve('7za', 'bin');
    return _sevenzip;
  },
  get qpdf() {
    if (_qpdf === null) _qpdf = resolve('qpdf', 'qpdf');
    return _qpdf;
  },
  get exiftool() {
    // exiftool.exe needs its 'exiftool_files/' folder sitting beside it; both
    // are packaged into resources/exiftool (see electron-builder.yml).
    if (_exiftool === null) _exiftool = resolve('exiftool', 'exiftool');
    return _exiftool;
  },
  get realesrgan() {
    // realesrgan-ncnn-vulkan.exe + vcomp140.dll + a models/ folder beside it.
    if (_realesrgan === null) _realesrgan = resolve('realesrgan-ncnn-vulkan', 'realesrgan');
    return _realesrgan;
  },
  get whisper() {
    // whisper-cli.exe (whisper.cpp) + its ggml/openblas DLLs beside it.
    if (_whisper === null) _whisper = resolve('whisper-cli', 'whisper');
    return _whisper;
  },
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
};
