'use strict';

// Detects which encoders the bundled ffmpeg actually exposes so the UI can
// gray out unavailable GPU options.

const { execFile } = require('child_process');
const ffmpegPath = require('./ffmpegPath');
const engines = require('../engines');

const ENCODER_NAMES = {
  h264: { cpu: 'libx264', nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
  hevc: { cpu: 'libx265', nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
};

let _cache = null;

// A conservative software-only result used before ffmpeg has been downloaded
// (on-demand). NOT cached, so a real detection runs once ffmpeg is present.
function softwareDefault() {
  const result = { h264: {}, hevc: {} };
  for (const codec of Object.keys(ENCODER_NAMES)) {
    for (const vendor of Object.keys(ENCODER_NAMES[codec])) {
      result[codec][vendor] = vendor === 'cpu' ? ENCODER_NAMES[codec].cpu : null;
    }
  }
  result.vendors = { cpu: true, nvenc: false, amf: false, qsv: false };
  result.error = null;
  result.pending = true; // ffmpeg not installed yet; GPU options unknown
  return result;
}

function detect() {
  if (_cache) return Promise.resolve(_cache);
  // ffmpeg isn't here yet — don't spawn a missing binary; report CPU-only for
  // now. It downloads on first real use and detection re-runs after that.
  if (!engines.isInstalled('ffmpeg')) return Promise.resolve(softwareDefault());
  return new Promise((resolve) => {
    execFile(
      ffmpegPath.ffmpeg,
      ['-hide_banner', '-encoders'],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        const text = stdout || '';
        const has = (name) => new RegExp(`\\b${name}\\b`).test(text);

        const result = { h264: {}, hevc: {} };
        for (const codec of Object.keys(ENCODER_NAMES)) {
          for (const [vendor, encName] of Object.entries(ENCODER_NAMES[codec])) {
            result[codec][vendor] = has(encName) ? encName : null;
          }
        }
        // Which GPU vendors are available for at least one codec.
        result.vendors = {
          cpu: true,
          nvenc: !!(result.h264.nvenc || result.hevc.nvenc),
          amf: !!(result.h264.amf || result.hevc.amf),
          qsv: !!(result.h264.qsv || result.hevc.qsv),
        };
        result.error = err ? String(err.message || err) : null;
        _cache = result;
        resolve(result);
      }
    );
  });
}

// Resolve the encoder name for a given codec ('h264'|'hevc') and
// vendor ('cpu'|'nvenc'|'amf'|'qsv'|'auto'). Falls back to CPU if missing.
function resolveEncoder(detected, codec, vendor) {
  const map = detected[codec] || ENCODER_NAMES[codec];
  if (vendor === 'auto') {
    // Prefer NVENC > QSV > AMF > CPU for speed, but only if present.
    return map.nvenc || map.qsv || map.amf || map.cpu;
  }
  return map[vendor] || map.cpu;
}

// Drop the cached detection so the next detect() re-probes (called after ffmpeg
// is downloaded on demand, replacing the CPU-only default with real results).
function reset() { _cache = null; }

module.exports = { detect, resolveEncoder, reset, ENCODER_NAMES };
