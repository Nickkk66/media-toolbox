'use strict';

// PURE module (no I/O): turns an encoding plan + settings + metadata into the
// ffmpeg argument array(s). For size-target two-pass CPU encodes it returns two
// arg arrays (pass 1 + pass 2); everything else returns a single array.

const { resolveEncoder } = require('./encoders');

// Escape a subtitle file path for use *inside* an ffmpeg filtergraph value.
// Even when args are passed as an array, ffmpeg's filter parser still parses
// this string, so Windows drive-letter paths need escaping.
//   C:\Users\me\sub.srt  ->  'C\:/Users/me/sub.srt'
function escapeSubPathForFilter(p) {
  let s = p.replace(/\\/g, '/'); // backslashes -> forward slashes
  s = s.replace(/:/g, '\\:'); // escape the drive-letter colon
  return `'${s}'`; // single-quote the whole path
}

function isNvenc(enc) {
  return /_nvenc$/.test(enc);
}
function isAmf(enc) {
  return /_amf$/.test(enc);
}
function isQsv(enc) {
  return /_qsv$/.test(enc);
}
function isX265(enc) {
  return enc === 'libx265';
}
function isX264(enc) {
  return enc === 'libx264';
}

const NULL_SINK = process.platform === 'win32' ? 'NUL' : '/dev/null';

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1'];

// Build the -vf filter chain (crop -> scale -> rotate -> flip -> subtitle burn-in).
function buildVf(plan, settings) {
  const parts = [];
  // Crop first (Video Crop Settings).
  if (Number(settings.cropW) > 0 || Number(settings.cropH) > 0) {
    const w = Number(settings.cropW) > 0 ? settings.cropW : 'iw';
    const h = Number(settings.cropH) > 0 ? settings.cropH : 'ih';
    parts.push(`crop=${w}:${h}:${Number(settings.cropX) || 0}:${Number(settings.cropY) || 0}`);
  }
  if (plan.scaleHeight) parts.push(`scale=-2:${plan.scaleHeight}`);
  // Rotate.
  const rot = Number(settings.rotate) || 0;
  if (rot === 90) parts.push('transpose=1');
  else if (rot === 180) parts.push('transpose=2,transpose=2');
  else if (rot === 270) parts.push('transpose=2');
  // Flip.
  if (settings.flip === 'h') parts.push('hflip');
  else if (settings.flip === 'v') parts.push('vflip');
  // Subtitle burn-in last.
  if (settings.subtitle && settings.subtitle.mode === 'hard' && settings.subtitle.path) {
    const escaped = escapeSubPathForFilter(settings.subtitle.path);
    const isAss = /\.ass$/i.test(settings.subtitle.path);
    parts.push(isAss ? `ass=${escaped}` : `subtitles=${escaped}`);
  }
  return parts.length ? parts.join(',') : null;
}

// Audio filter chain (volume + fades).
function buildAf(settings, meta) {
  const parts = [];
  const vol = Number(settings.volume);
  if (vol && vol !== 100) parts.push(`volume=${(vol / 100).toFixed(3)}`);
  const dur = meta.durationSec || 0;
  if (settings.fadeIn) parts.push('afade=t=in:st=0:d=1');
  if (settings.fadeOut && dur > 1.5) parts.push(`afade=t=out:st=${(dur - 1).toFixed(2)}:d=1`);
  return parts.length ? parts.join(',') : null;
}

// Compatibility flags for old devices.
function compatFlags(enc, settings) {
  if (!settings.compatibility) return [];
  const out = ['-pix_fmt', 'yuv420p'];
  // Profile/level only meaningful for H.264 encoders.
  if (/264/.test(enc)) {
    out.push('-profile:v', settings.compatProfile === 'baseline' ? 'baseline' : 'main');
    out.push('-level', '4.0');
  }
  return out;
}

// Audio args (shared by pass 2 / single pass).
const AUDIO_CODECS = { aac: 'aac', mp3: 'libmp3lame', opus: 'libopus', ac3: 'ac3' };
function audioArgs(plan, settings, meta) {
  if (settings.removeAudio || !meta.hasAudio) return ['-an'];
  const af = buildAf(settings, meta);
  const codec = settings.audioCodec || (settings.audioCopy ? 'copy' : 'auto');
  // Copy only when no audio filter is needed.
  if ((codec === 'copy') && !af) return ['-c:a', 'copy'];
  const kbps = plan.audioKbps > 0 ? plan.audioKbps : 128;
  const enc = AUDIO_CODECS[codec] || 'aac';
  const out = ['-c:a', enc, '-b:a', `${kbps}k`];
  if (af) out.push('-af', af);
  return out;
}

// Video rate-control args for a given encoder + plan, for the REAL output pass.
function videoRateArgs(enc, plan) {
  const k = plan.videoKbps;
  if (plan.mode === 'crf') {
    const crf = plan.crf != null ? plan.crf : isX265(enc) ? 28 : 23;
    const preset = plan.preset || 'medium';
    if (isX264(enc) || isX265(enc)) return ['-crf', String(crf), '-preset', preset];
    if (isNvenc(enc)) return ['-rc', 'vbr', '-cq', String(crf), '-preset', 'p5'];
    if (isQsv(enc)) return ['-global_quality', String(crf), '-preset', 'medium'];
    if (isAmf(enc)) return ['-rc', 'cqp', '-qp_p', String(crf), '-qp_i', String(crf)];
    return ['-crf', String(crf)];
  }
  if (plan.mode === 'bitrate') {
    // Hard cap (max bitrate) — single pass capped VBR.
    return ['-b:v', `${k}k`, '-maxrate', `${k}k`, '-bufsize', `${k * 2}k`];
  }
  // mode === 'size' single-invocation encoders (NVENC/AMF/QSV) use average VBR.
  const maxrate = Math.round(k * 1.2);
  const bufsize = k * 2;
  if (isNvenc(enc)) {
    return [
      '-rc', 'vbr',
      '-b:v', `${k}k`,
      '-maxrate', `${maxrate}k`,
      '-bufsize', `${bufsize}k`,
      '-multipass', 'fullres',
      '-rc-lookahead', '32',
      '-preset', 'p5',
      '-tune', 'hq',
    ];
  }
  if (isQsv(enc)) {
    return ['-b:v', `${k}k`, '-maxrate', `${maxrate}k`, '-look_ahead', '1', '-preset', 'medium'];
  }
  if (isAmf(enc)) {
    return ['-rc', 'vbr_latency', '-b:v', `${k}k`, '-maxrate', `${maxrate}k`, '-quality', 'quality'];
  }
  // Should not reach here for CPU (handled by two-pass below).
  return ['-b:v', `${k}k`];
}

function hevcTag(enc) {
  return isX265(enc) || /hevc/.test(enc) ? ['-tag:v', 'hvc1'] : [];
}

// Trim as input options (before -i): -ss start / -to end.
function trimIn(settings) {
  const a = [];
  const norm = (t) => t && !/^0{1,2}:0{2}:0{2}(\.0+)?$/.test(String(t).trim()) && String(t).trim() !== '';
  if (norm(settings.trimStart)) a.push('-ss', String(settings.trimStart).trim());
  if (norm(settings.trimEnd)) a.push('-to', String(settings.trimEnd).trim());
  return a;
}
function fpsArgs(settings) { const f = Number(settings.fps) || 0; return f > 0 ? ['-r', String(f)] : []; }

// Returns { passes: [argsArray, ...], twoPass: bool }
function build({ plan, settings, meta, detected, inputPath, outputPath, passlogPrefix }) {
  const codec = settings.codec === 'hevc' ? 'hevc' : 'h264';
  const enc = resolveEncoder(detected, codec, settings.encoder || 'auto');
  const vf = buildVf(plan, settings);
  const trim = trimIn(settings);
  const fps = fpsArgs(settings);
  const cpuTwoPass = plan.mode === 'size' && (isX264(enc) || isX265(enc));

  const subInputs = []; // for soft subtitle muxing
  const soft = settings.subtitle && settings.subtitle.mode === 'soft' && settings.subtitle.path;
  if (soft) subInputs.push('-i', settings.subtitle.path);

  if (cpuTwoPass) {
    const k = plan.videoKbps;
    const x265 = isX265(enc);

    // Pass 1: video only, null sink.
    const p1 = [...GLOBALS, ...trim, '-i', inputPath];
    if (vf) p1.push('-vf', vf);
    p1.push(...fps, '-c:v', enc, '-b:v', `${k}k`, '-preset', 'medium');
    if (x265) {
      p1.push('-x265-params', `pass=1:stats=${passlogPrefix}.log`);
    } else {
      p1.push('-pass', '1', '-passlogfile', passlogPrefix);
    }
    p1.push(...compatFlags(enc, settings), ...hevcTag(enc), '-an', '-f', 'null', NULL_SINK);

    // Pass 2: real output + audio (+ optional soft subs).
    const p2 = [...GLOBALS, ...trim, '-i', inputPath, ...subInputs];
    if (soft) {
      p2.push('-map', '0:v', '-map', '0:a?', '-map', '1');
    }
    if (vf) p2.push('-vf', vf);
    p2.push(...fps, '-c:v', enc, '-b:v', `${k}k`, '-preset', 'medium');
    if (x265) {
      p2.push('-x265-params', `pass=2:stats=${passlogPrefix}.log`);
    } else {
      p2.push('-pass', '2', '-passlogfile', passlogPrefix);
    }
    p2.push(...compatFlags(enc, settings), ...hevcTag(enc));
    p2.push(...audioArgs(plan, settings, meta));
    if (soft) p2.push('-c:s', /\.mkv$/i.test(outputPath) ? 'srt' : 'mov_text');
    p2.push('-movflags', '+faststart', outputPath);

    return { passes: [p1, p2], twoPass: true, encoder: enc };
  }

  // Single invocation (CRF, max-bitrate, or GPU size-target).
  const args = [...GLOBALS, ...trim, '-i', inputPath, ...subInputs];
  if (soft) {
    args.push('-map', '0:v', '-map', '0:a?', '-map', '1');
  }
  if (vf) args.push('-vf', vf);
  args.push(...fps, '-c:v', enc, ...videoRateArgs(enc, plan));
  args.push(...compatFlags(enc, settings), ...hevcTag(enc));
  args.push(...audioArgs(plan, settings, meta));
  if (soft) args.push('-c:s', /\.mkv$/i.test(outputPath) ? 'srt' : 'mov_text');
  args.push('-movflags', '+faststart', outputPath);

  return { passes: [args], twoPass: false, encoder: enc };
}

module.exports = { build, escapeSubPathForFilter, buildVf };
