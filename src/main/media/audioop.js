'use strict';

// Audio tools: trim (cut a time range) via ffmpeg. Mirrors videoop's trim but
// for audio-only files. Stream-copies when the container allows; otherwise
// re-encodes to a sane codec for the output format.

const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'ac3'];
const outputFormats = [
  { value: 'mp3', label: 'MP3' },
  { value: 'm4a', label: 'AAC (M4A)' },
  { value: 'ogg', label: 'OGG' },
  { value: 'opus', label: 'OPUS' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
];

function defaultSettings() {
  return { op: 'trim', start: '00:00:00', end: '', denoise: 12 };
}

// Keep the source extension by default so a stream-copy trim stays lossless.
function outExt(settings, inputPath) {
  if (settings && settings.outputFormat) return settings.outputFormat;
  const ext = ((inputPath || '').split('.').pop() || 'mp3').toLowerCase();
  return ext || 'mp3';
}

function probeMedia(inputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error('Not a readable audio file.'));
        let data; try { data = JSON.parse(stdout); } catch { return reject(new Error('Could not parse audio metadata.')); }
        const fmt = data.format || {};
        const a = (data.streams || []).find((s) => s.codec_type === 'audio') || {};
        resolve({
          type: 'audioop',
          durationSec: parseFloat(fmt.duration) || 0,
          sizeBytes: parseInt(fmt.size, 10) || 0,
          bitrateBps: parseInt(fmt.bit_rate, 10) || parseInt(a.bit_rate, 10) || 0,
          channels: a.channels || 2,
          sampleRate: parseInt(a.sample_rate, 10) || 0,
        });
      }
    );
  });
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

const REENCODE = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  aac: ['-c:a', 'aac', '-b:a', '192k'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-c:a', 'libopus', '-b:a', '160k'],
  wav: ['-c:a', 'pcm_s16le'],
  flac: ['-c:a', 'flac'],
};

function build({ settings, meta, inputPath, outputPath }) {
  const srcExt = ((inputPath || '').split('.').pop() || '').toLowerCase();
  const outE = outExt(settings, inputPath).toLowerCase();
  if (settings.op === 'denoise') {
    // FFT-based noise reduction (afftdn). `nf` (noise floor, dBFS) controls the
    // aggressiveness: more negative = stronger reduction. Map a 0–40 strength
    // slider onto roughly -10 (gentle) .. -50 (aggressive).
    const strength = Math.min(40, Math.max(0, Number(settings.denoise) || 12));
    const nf = -(10 + strength);
    const args = [...GLOBALS, '-i', inputPath, '-vn', '-af', `afftdn=nf=${nf}`];
    // Filtering requires a re-encode; pick a codec for the output container.
    args.push(...(REENCODE[outE] || REENCODE.mp3));
    args.push(outputPath);
    return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
  }
  const args = [...GLOBALS];
  if (settings.start) args.push('-ss', String(settings.start));
  if (settings.end) args.push('-to', String(settings.end));
  args.push('-i', inputPath, '-vn');
  // Stream-copy when the output container matches the source (lossless, fast).
  if (outE === srcExt) {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  } else {
    args.push(...(REENCODE[outE] || REENCODE.mp3));
  }
  args.push(outputPath);
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
}

module.exports = { type: 'audioop', extensions, outputFormats, defaultSettings, outExt, probe: probeMedia, build };
