'use strict';

// Audio media module — MP3 / AAC / OGG / Opus / WAV compression via ffmpeg.

const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'ac3'];

const outputFormats = [
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC (M4A)' },
  { value: 'ogg', label: 'OGG' },
  { value: 'opus', label: 'OPUS' },
  { value: 'wav', label: 'WAV' },
];

function defaultSettings() {
  return {
    outputFormat: 'mp3',
    method: 'bitrate', // 'bitrate' | 'percent' | 'mb'
    audioKbps: 192,
    percent: 60,
    targetMB: 5,
    sampleRate: 0, // 0 = keep
  };
}

function outExt(settings) {
  const f = settings.outputFormat || 'mp3';
  return f === 'aac' ? 'm4a' : f;
}

function probeMedia(inputPath) {
  // Reuse the JSON probe but don't require a video stream.
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error('Not a readable audio file.'));
        let data;
        try { data = JSON.parse(stdout); } catch { return reject(new Error('Could not parse audio metadata.')); }
        const fmt = data.format || {};
        const a = (data.streams || []).find((s) => s.codec_type === 'audio') || {};
        resolve({
          type: 'audio',
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

const CODEC = {
  mp3: 'libmp3lame',
  aac: 'aac',
  ogg: 'libvorbis',
  opus: 'libopus',
  wav: 'pcm_s16le',
};

function build({ settings, meta, inputPath, outputPath }) {
  const fmt = settings.outputFormat || 'mp3';
  const codec = CODEC[fmt] || 'libmp3lame';

  // Resolve target bitrate (kbps).
  let kbps = Number(settings.audioKbps) || 192;
  if (settings.method === 'percent' && meta.durationSec > 0 && meta.sizeBytes > 0) {
    const targetBytes = meta.sizeBytes * (Number(settings.percent) / 100);
    kbps = Math.max(32, Math.round((targetBytes * 8) / meta.durationSec / 1000));
  } else if (settings.method === 'mb' && meta.durationSec > 0) {
    const targetBytes = Number(settings.targetMB) * 1024 * 1024;
    kbps = Math.max(32, Math.round((targetBytes * 8) / meta.durationSec / 1000));
  }

  const args = [...GLOBALS, '-i', inputPath, '-vn'];
  if (Number(settings.sampleRate) > 0) args.push('-ar', String(settings.sampleRate));

  if (fmt === 'wav') {
    args.push('-c:a', 'pcm_s16le');
  } else {
    args.push('-c:a', codec, '-b:a', `${kbps}k`);
  }
  args.push(outputPath);

  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: meta.durationSec };
}

module.exports = { type: 'audio', extensions, outputFormats, defaultSettings, outExt, probe: probeMedia, build };
