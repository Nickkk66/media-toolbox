'use strict';

// Image media module — JPEG / PNG / WebP compression via ffmpeg.

const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'];

const outputFormats = [
  { value: 'keep', label: 'Same as input' },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
];

function defaultSettings() {
  return {
    outputFormat: 'keep',
    quality: 75, // 1-100 (higher = better quality, bigger file)
    scalePercent: 100, // resize as % of original
  };
}

function outExt(settings, inputPath) {
  if (settings.outputFormat && settings.outputFormat !== 'keep') return settings.outputFormat;
  const ext = (inputPath.split('.').pop() || 'jpg').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

function probe(inputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', inputPath],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const fs = require('fs');
        let sizeBytes = 0;
        try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
        let width = 0, height = 0;
        try {
          const data = JSON.parse(stdout || '{}');
          const v = (data.streams || []).find((s) => s.codec_type === 'video');
          if (v) { width = v.width || 0; height = v.height || 0; }
        } catch { /* ignore */ }
        if (err && !width) return reject(new Error('Not a readable image.'));
        resolve({ type: 'image', sizeBytes, width, height, durationSec: 0 });
      }
    );
  });
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error'];

function build({ settings, inputPath, outputPath }) {
  const q = Math.max(1, Math.min(100, Number(settings.quality) || 75));
  const fmt = outExt(settings, inputPath);

  // Build the filter chain once (resize first, optional palette for low-q PNG).
  const vf = [];
  const pct = Number(settings.scalePercent) || 100;
  if (pct > 0 && pct < 100) {
    vf.push(`scale=trunc(iw*${pct / 100}/2)*2:trunc(ih*${pct / 100}/2)*2`);
  }
  if (fmt === 'png' && q < 80) {
    // Quantize colors for real PNG savings: q 1..79 -> ~32..256 colors.
    const colors = Math.max(16, Math.min(256, Math.round((q / 80) * 256)));
    vf.push(`split[a][b];[a]palettegen=max_colors=${colors}[p];[b][p]paletteuse`);
  }

  const args = [...GLOBALS, '-i', inputPath];
  if (vf.length) args.push('-vf', vf.join(','));

  if (fmt === 'jpg' || fmt === 'jpeg') {
    // mjpeg -q:v is 2 (best) .. 31 (worst). Map quality 1-100 -> 31..2.
    const qscale = Math.round(31 - (q / 100) * 29);
    args.push('-c:v', 'mjpeg', '-q:v', String(Math.max(2, qscale)));
  } else if (fmt === 'webp') {
    args.push('-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6');
  } else if (fmt === 'png') {
    args.push('-c:v', 'png', '-compression_level', '9');
  } else {
    // bmp/tiff fallback -> generic quality
    args.push('-q:v', String(Math.max(2, Math.round(31 - (q / 100) * 29))));
  }
  args.push(outputPath);

  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: 0 };
}

module.exports = { type: 'image', extensions, outputFormats, defaultSettings, outExt, probe, build };
