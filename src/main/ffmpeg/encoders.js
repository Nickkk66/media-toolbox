'use strict';

// Detects which encoders the bundled ffmpeg actually exposes so the UI can
// gray out unavailable GPU options.

const { execFile } = require('child_process');
const ffmpegPath = require('./ffmpegPath');

const ENCODER_NAMES = {
  h264: { cpu: 'libx264', nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
  hevc: { cpu: 'libx265', nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
};

let _cache = null;

function detect() {
  if (_cache) return Promise.resolve(_cache);
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

module.exports = { detect, resolveEncoder, ENCODER_NAMES };
