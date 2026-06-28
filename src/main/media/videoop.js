'use strict';

// Video tools: trim (cut a time range), crop (numeric rectangle), speed
// (PTS/atempo), fps (frame-rate change w/ optional interpolation) and stabilize
// (two-pass vidstab) via ffmpeg.

const os = require('os');
const path = require('path');
const { probe } = require('../ffmpeg/probe');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'mpg', 'ts'];
const outputFormats = [{ value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }, { value: 'webm', label: 'WEBM' }];

function defaultSettings() {
  return { op: 'trim', outputFormat: 'mp4', start: '00:00:00', end: '', cropW: 0, cropH: 0, cropX: 0, cropY: 0, stretchW: 1080, stretchH: 1920, speed: 1, fps: 30, interpolate: false, smoothing: 10, mblur: 4, regionXPct: 25, regionYPct: 25, regionWPct: 50, regionHPct: 50 };
}
function outExt(settings, inputPath) {
  // Speed/fps/stabilize/motionblur/delogo keep the source container by default
  // so users don't get a surprise re-mux to mp4 (the option still lets them pick).
  if (settings && ['speed', 'fps', 'stabilize', 'motionblur', 'delogo'].includes(settings.op) && !settings.outputFormat) {
    const e = ((inputPath || '').split('.').pop() || 'mp4').toLowerCase();
    return e || 'mp4';
  }
  return (settings && settings.outputFormat) || 'mp4';
}

// Convert a percentage-based region (regionXPct/Y/W/H, 0–100, relative to the
// source frame) into integer pixel x/y/w/h, clamped inside the frame. Used by
// the region tools (delogo) so the renderer can keep coordinates resolution-
// independent and the box stays valid regardless of source dimensions.
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
  return { x, y, w, h };
}

// Build the audio `atempo` chain. atempo only accepts 0.5–2.0, so a factor
// outside that range is decomposed into a product of in-range steps.
function atempoChain(factor) {
  let f = factor; const parts = [];
  while (f > 2.0) { parts.push('atempo=2.0'); f /= 2.0; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  parts.push(`atempo=${f.toFixed(6)}`);
  return parts.join(',');
}

async function probeMedia(inputPath) { const m = await probe(inputPath); m.type = 'videoop'; return m; }

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

function build({ settings, meta, inputPath, outputPath, passlogPrefix }) {
  if (settings.op === 'speed') {
    // setpts=PTS/factor speeds video up (factor>1) or slows it (factor<1).
    const factor = Math.min(8, Math.max(0.1, Number(settings.speed) || 1));
    const vf = `setpts=PTS/${factor}`;
    const args = [...GLOBALS, '-i', inputPath, '-filter:v', vf];
    // Pitch-preserving audio tempo change (skip when there is no audio).
    if (meta && meta.hasAudio) {
      args.push('-filter:a', atempoChain(factor));
    } else {
      args.push('-an');
    }
    args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', outputPath);
    // Output duration changes with speed → keep progress responsive but bounded.
    const dur = (meta.durationSec || 0) / factor;
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: dur };
  }
  if (settings.op === 'fps') {
    const fps = Math.min(240, Math.max(1, Number(settings.fps) || 30));
    const args = [...GLOBALS, '-i', inputPath];
    if (settings.interpolate) {
      // Motion-interpolated (smooth) frame synthesis to the target fps.
      args.push('-filter:v', `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir`);
    } else {
      args.push('-r', String(fps));
    }
    args.push('-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath);
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  if (settings.op === 'stabilize') {
    // Two-pass vidstab. Pass 1 (vidstabdetect) analyses motion and writes a
    // transforms file; pass 2 (vidstabtransform) applies the smoothing.
    const smoothing = Math.min(100, Math.max(1, Number(settings.smoothing) || 10));
    const trf = `${passlogPrefix || path.join(os.tmpdir(), 'vc_stab')}.trf`;
    // Escape the path for use inside a filtergraph option value: backslash and
    // colon are filtergraph metacharacters (Windows paths contain both).
    const trfEsc = trf.replace(/\\/g, '/').replace(/:/g, '\\:');
    const pass1 = [...GLOBALS, '-i', inputPath, '-vf', `vidstabdetect=shakiness=8:accuracy=15:result=${trfEsc}`, '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'];
    const pass2 = [...GLOBALS, '-i', inputPath, '-vf', `vidstabtransform=input=${trfEsc}:smoothing=${smoothing}:zoom=0:optzoom=1,unsharp=5:5:0.8:3:3:0.4`, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [pass1, pass2], twoPass: true, durationSec: meta.durationSec };
  }
  if (settings.op === 'stretch') {
    // Force exact dimensions (squeeze/stretch) — aspect ratio NOT preserved.
    const w = Math.max(2, Number(settings.stretchW) || meta.video.width || 1080);
    const h = Math.max(2, Number(settings.stretchH) || meta.video.height || 1920);
    const vf = `scale=${w}:${h},setsar=1`;
    const args = [...GLOBALS, '-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  if (settings.op === 'motionblur') {
    // Blend adjacent frames for a motion-blur / long-exposure look. tmix mixes
    // the last N frames with equal weights — higher N = stronger smear.
    const n = Math.min(16, Math.max(2, Number(settings.mblur) || 4));
    const weights = Array(n).fill('1').join(' ');
    const vf = `tmix=frames=${n}:weights=${weights}`;
    const args = [...GLOBALS, '-i', inputPath, '-filter:v', vf, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  if (settings.op === 'delogo') {
    // Remove a watermark/logo inside a rectangular region by interpolating from
    // the surrounding pixels. Works best on small, semi-opaque logos.
    const fw = (meta.video && meta.video.width) || 0, fh = (meta.video && meta.video.height) || 0;
    const r = regionPx(settings, fw, fh);
    // delogo needs the box strictly inside the frame (it samples a 1px border).
    const x = Math.min(Math.max(1, r.x), Math.max(1, fw - r.w - 1));
    const y = Math.min(Math.max(1, r.y), Math.max(1, fh - r.h - 1));
    const w = Math.max(1, Math.min(r.w, fw - x - 1));
    const h = Math.max(1, Math.min(r.h, fh - y - 1));
    const vf = `delogo=x=${x}:y=${y}:w=${w}:h=${h}`;
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
