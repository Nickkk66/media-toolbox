'use strict';

// Privacy Blur — blur a single rectangular REGION of an image OR a video
// (faces, license plates, personal info), done manually (no detection). The
// region is supplied as percentages (regionXPct/Y/W/H, 0–100) so it stays
// resolution-independent; here it is converted to pixels against the real
// source dimensions and the area is blurred with avgblur, then overlaid back.
// For video the region is fixed for the whole clip.

const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'mpg', 'ts'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'];
const extensions = VIDEO_EXT.concat(IMAGE_EXT);
// Output stays the same container/format by default; a couple of common picks.
const outputFormats = [{ value: 'keep', label: 'Same as input' }, { value: 'mp4', label: 'MP4' }, { value: 'png', label: 'PNG' }];

function isVideoPath(p) {
  const e = (String(p || '').split('.').pop() || '').toLowerCase();
  return VIDEO_EXT.includes(e);
}

function defaultSettings() {
  return { op: 'blur', outputFormat: 'keep', strength: 'medium', regionXPct: 25, regionYPct: 25, regionWPct: 50, regionHPct: 50 };
}

function outExt(settings, inputPath) {
  if (settings && settings.outputFormat && settings.outputFormat !== 'keep') return settings.outputFormat;
  const e = ((inputPath || '').split('.').pop() || (isVideoPath(inputPath) ? 'mp4' : 'png')).toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
}

// Probe works for both kinds: durationSec is 0 for images, >0 for video.
function probe(inputPath) {
  return new Promise((resolve) => {
    execFile(ffmpegPath.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        let w = 0, h = 0, sizeBytes = 0, durationSec = 0, hasAudio = false;
        try { sizeBytes = fs.statSync(inputPath).size; } catch { /* */ }
        try {
          const data = JSON.parse(stdout || '{}');
          const streams = data.streams || [];
          const v = streams.find((s) => s.codec_type === 'video');
          if (v) { w = v.width || 0; h = v.height || 0; }
          hasAudio = streams.some((s) => s.codec_type === 'audio');
          durationSec = parseFloat((data.format || {}).duration) || 0;
        } catch { /* */ }
        resolve({ type: 'blurop', sizeBytes, width: w, height: h, video: { width: w, height: h }, durationSec, hasAudio });
      });
  });
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

// strength preset → avgblur radius (kernel size).
const STRENGTH = { light: 10, medium: 20, strong: 35, max: 60 };

function regionPx(settings, fw, fh) {
  const W = Math.max(2, fw || 0), H = Math.max(2, fh || 0);
  const clampPct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d; };
  const xp = clampPct(settings.regionXPct, 25), yp = clampPct(settings.regionYPct, 25);
  const wp = clampPct(settings.regionWPct, 50), hp = clampPct(settings.regionHPct, 50);
  let w = Math.max(2, Math.round(W * wp / 100));
  let h = Math.max(2, Math.round(H * hp / 100));
  let x = Math.round(W * xp / 100);
  let y = Math.round(H * yp / 100);
  if (x + w > W) x = Math.max(0, W - w);
  if (y + h > H) y = Math.max(0, H - h);
  if (w > W) w = W; if (h > H) h = H;
  // avgblur radius must be smaller than the blurred plane.
  return { x, y, w: Math.max(2, w), h: Math.max(2, h) };
}

function build({ settings, meta, inputPath, outputPath }) {
  const fw = (meta && (meta.width || (meta.video && meta.video.width))) || 0;
  const fh = (meta && (meta.height || (meta.video && meta.video.height))) || 0;
  const r = regionPx(settings, fw, fh);
  let radius = STRENGTH[settings.strength] || STRENGTH.medium;
  // avgblur radius is capped at (min(w,h)/2 - 1) by ffmpeg; keep it safe.
  radius = Math.max(1, Math.min(radius, Math.floor(Math.min(r.w, r.h) / 2) - 1 || 1));
  // Crop the region, blur it, overlay it back at the same coordinates.
  const fc = `[0:v]crop=${r.w}:${r.h}:${r.x}:${r.y},avgblur=${radius}[b];[0:v][b]overlay=${r.x}:${r.y}`;
  const video = isVideoPath(inputPath);
  const args = [...GLOBALS, '-i', inputPath, '-filter_complex', fc];
  if (video) {
    args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium');
    if (meta && meta.hasAudio) args.push('-c:a', 'copy'); else args.push('-an');
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: (meta && meta.durationSec) || 0 };
}

module.exports = { type: 'blurop', extensions, outputFormats, defaultSettings, outExt, probe, build };
