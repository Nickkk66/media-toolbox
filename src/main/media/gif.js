'use strict';

// GIF media module — optimize GIFs (palette + scale + fps) or convert to
// MP4/WebM for much smaller files.

const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['gif'];

const outputFormats = [
  { value: 'gif', label: 'GIF (optimized)' },
  { value: 'mp4', label: 'MP4 (much smaller)' },
  { value: 'webm', label: 'WEBM' },
  { value: 'apng', label: 'APNG' },
];

function defaultSettings() {
  return {
    outputFormat: 'gif',
    scalePercent: 100,
    fps: 0, // 0 = keep
    colors: 256, // 2-256 (gif only)
  };
}

function outExt(settings) {
  return settings.outputFormat || 'gif';
}

function probe(inputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const fs = require('fs');
        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
        let width = 0, height = 0, durationSec = 0;
        try {
          const data = JSON.parse(stdout || '{}');
          const v = (data.streams || []).find((s) => s.codec_type === 'video');
          if (v) { width = v.width || 0; height = v.height || 0; }
          durationSec = parseFloat((data.format || {}).duration) || 0;
        } catch { /* ignore */ }
        if (err && !width) return reject(new Error('Not a readable GIF.'));
        resolve({ type: 'gif', sizeBytes, width, height, durationSec });
      }
    );
  });
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

function filterChain(settings, extra) {
  const parts = [];
  const fps = Number(settings.fps) || 0;
  if (fps > 0) parts.push(`fps=${fps}`);
  const pct = Number(settings.scalePercent) || 100;
  if (pct > 0 && pct < 100) parts.push(`scale=trunc(iw*${pct / 100}/2)*2:-2:flags=lanczos`);
  if (extra) parts.push(extra);
  return parts.join(',');
}

function build({ settings, meta, inputPath, outputPath }) {
  const fmt = settings.outputFormat || 'gif';

  if (fmt === 'gif') {
    // Single-command palette optimization via split.
    const colors = Math.max(2, Math.min(256, Number(settings.colors) || 256));
    const base = filterChain(settings, null);
    const pre = base ? base + ',' : '';
    const vf = `${pre}split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer`;
    const args = [...GLOBALS, '-i', inputPath, '-vf', vf, outputPath];
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }

  if (fmt === 'apng') {
    // Animated PNG output (lossless, larger but higher quality than GIF).
    const vf = filterChain(settings, null);
    const args = [...GLOBALS, '-i', inputPath];
    if (vf) args.push('-vf', vf);
    args.push('-f', 'apng', '-plays', '0', outputPath);
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }

  // Convert to video.
  const vf = filterChain(settings, 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  const args = [...GLOBALS, '-i', inputPath];
  if (vf) args.push('-vf', vf);
  if (fmt === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-an');
  } else {
    args.push('-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an');
  }
  args.push(outputPath);
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
}

module.exports = { type: 'gif', extensions, outputFormats, defaultSettings, outExt, probe, build };
