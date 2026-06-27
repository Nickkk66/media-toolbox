'use strict';

// Generic single-image operations (resize / rotate / flip / enlarge / crop)
// via ffmpeg. Driven by settings.op.

const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'];
const outputFormats = [{ value: 'keep', label: 'Same as input' }, { value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }];

function defaultSettings() {
  return { op: 'resize', outputFormat: 'keep', width: 1280, height: 0, angle: 90, flip: 'h', factor: 2, cropW: 0, cropH: 0, cropX: 0, cropY: 0 };
}
function outExt(settings, inputPath) {
  if (settings.outputFormat && settings.outputFormat !== 'keep') return settings.outputFormat;
  const e = (inputPath.split('.').pop() || 'png').toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}
function probe(inputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        let w = 0, h = 0, sizeBytes = 0;
        try { sizeBytes = fs.statSync(inputPath).size; } catch { /* */ }
        try { const v = (JSON.parse(stdout || '{}').streams || []).find((s) => s.codec_type === 'video'); if (v) { w = v.width; h = v.height; } } catch { /* */ }
        resolve({ type: 'imageop', sizeBytes, width: w, height: h, durationSec: 0 });
      });
  });
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error'];

function vfFor(settings) {
  switch (settings.op) {
    case 'resize': {
      const w = Number(settings.width) || -1, h = Number(settings.height) || -1;
      return `scale=${w <= 0 ? -1 : w}:${h <= 0 ? -1 : h}`;
    }
    case 'enlarge': {
      const f = Number(settings.factor) || 2;
      return `scale=iw*${f}:ih*${f}:flags=lanczos`;
    }
    case 'rotate': {
      const a = Number(settings.angle) || 90;
      if (a === 180) return 'transpose=2,transpose=2';
      if (a === 270) return 'transpose=2';
      return 'transpose=1';
    }
    case 'flip':
      return settings.flip === 'v' ? 'vflip' : 'hflip';
    case 'crop': {
      const w = Number(settings.cropW) || 0, h = Number(settings.cropH) || 0;
      const x = Number(settings.cropX) || 0, y = Number(settings.cropY) || 0;
      return `crop=${w > 0 ? w : 'iw'}:${h > 0 ? h : 'ih'}:${x}:${y}`;
    }
    default: return null;
  }
}

function build({ settings, inputPath, outputPath }) {
  const vf = vfFor(settings);
  const args = [...GLOBALS, '-i', inputPath];
  if (vf) args.push('-vf', vf);
  args.push(outputPath);
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: 0 };
}

module.exports = { type: 'imageop', extensions, outputFormats, defaultSettings, outExt, probe, build };
