'use strict';

// Video tools: trim (cut a time range) and crop (numeric rectangle) via ffmpeg.

const { probe } = require('../ffmpeg/probe');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'mpg', 'ts'];
const outputFormats = [{ value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }, { value: 'webm', label: 'WEBM' }];

function defaultSettings() {
  return { op: 'trim', outputFormat: 'mp4', start: '00:00:00', end: '', cropW: 0, cropH: 0, cropX: 0, cropY: 0, stretchW: 1080, stretchH: 1920 };
}
function outExt(settings) { return settings.outputFormat || 'mp4'; }

async function probeMedia(inputPath) { const m = await probe(inputPath); m.type = 'videoop'; return m; }

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

function build({ settings, meta, inputPath, outputPath }) {
  if (settings.op === 'stretch') {
    // Force exact dimensions (squeeze/stretch) — aspect ratio NOT preserved.
    const w = Math.max(2, Number(settings.stretchW) || meta.video.width || 1080);
    const h = Math.max(2, Number(settings.stretchH) || meta.video.height || 1920);
    const vf = `scale=${w}:${h},setsar=1`;
    const args = [...GLOBALS, '-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  if (settings.op === 'crop') {
    const w = Number(settings.cropW) || 0, h = Number(settings.cropH) || 0;
    const x = Number(settings.cropX) || 0, y = Number(settings.cropY) || 0;
    const vf = `crop=${w > 0 ? w : 'iw'}:${h > 0 ? h : 'ih'}:${x}:${y}`;
    const args = [...GLOBALS, '-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  // trim
  const args = [...GLOBALS];
  if (settings.start) args.push('-ss', String(settings.start));
  if (settings.end) args.push('-to', String(settings.end));
  args.push('-i', inputPath, '-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath);
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
}

module.exports = { type: 'videoop', extensions, outputFormats, defaultSettings, outExt, probe: probeMedia, build };
