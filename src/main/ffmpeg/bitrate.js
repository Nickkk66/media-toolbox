'use strict';

// PURE module (no I/O): converts a compression request + probed metadata into
// a concrete encoding plan (target video kbps / CRF / scale). Kept pure so the
// risky math is unit-testable.

const DEFAULT_AUDIO_KBPS_STEREO = 128;
const DEFAULT_AUDIO_KBPS_MONO = 96;
const OVERHEAD = 0.97; // muxing/overhead safety margin so we don't overshoot
const MIN_VIDEO_KBPS = 100;

function audioKbpsFor(meta, requestedAudioKbps) {
  if (requestedAudioKbps && requestedAudioKbps > 0) return requestedAudioKbps;
  if (!meta.hasAudio) return 0;
  const channels = meta.audios[0] && meta.audios[0].channels ? meta.audios[0].channels : 2;
  return channels <= 1 ? DEFAULT_AUDIO_KBPS_MONO : DEFAULT_AUDIO_KBPS_STEREO;
}

// Core: target output size in bytes -> required video kbps.
function videoKbpsForTargetBytes(targetBytes, durationSec, audioKbps) {
  if (!(durationSec > 0)) {
    throw new Error('Cannot target a file size: video duration is unknown.');
  }
  const targetBits = targetBytes * 8;
  const totalBitrateBps = (targetBits / durationSec) * OVERHEAD;
  const audioBps = audioKbps * 1000;
  const videoBps = totalBitrateBps - audioBps;
  if (videoBps <= 0) {
    throw new Error(
      'Target size is too small for the audio track. Lower the audio bitrate or pick a larger target.'
    );
  }
  return Math.max(Math.round(videoBps / 1000), MIN_VIDEO_KBPS);
}

// Build an encoding plan from settings. Returns:
//   { mode, videoKbps?, crf?, scaleHeight?, audioKbps, twoPass }
function plan(settings, meta) {
  const audioKbps = settings.audioCopy ? 0 : audioKbpsFor(meta, settings.audioKbps);
  const method = settings.method;

  // Resolution downscale: skip if it would upscale.
  let scaleHeight = null;
  if (settings.scaleHeight && settings.scaleHeight > 0) {
    if (!meta.video.height || settings.scaleHeight < meta.video.height) {
      scaleHeight = settings.scaleHeight;
    }
  }

  if (method === 'percent') {
    const pct = Number(settings.percent);
    if (!(pct > 0)) throw new Error('Percentage must be greater than 0.');
    const targetBytes = meta.sizeBytes * (pct / 100);
    return {
      mode: 'size',
      videoKbps: videoKbpsForTargetBytes(targetBytes, meta.durationSec, audioKbps),
      scaleHeight,
      audioKbps,
      twoPass: true,
    };
  }

  if (method === 'mb') {
    const mb = Number(settings.targetMB);
    if (!(mb > 0)) throw new Error('Target MB must be greater than 0.');
    const targetBytes = mb * 1024 * 1024;
    return {
      mode: 'size',
      videoKbps: videoKbpsForTargetBytes(targetBytes, meta.durationSec, audioKbps),
      scaleHeight,
      audioKbps,
      twoPass: true,
    };
  }

  if (method === 'bitrate') {
    const kbps = Number(settings.videoKbps);
    if (!(kbps > 0)) throw new Error('Max bitrate must be greater than 0.');
    return {
      mode: 'bitrate',
      videoKbps: Math.max(Math.round(kbps), MIN_VIDEO_KBPS),
      scaleHeight,
      audioKbps,
      twoPass: false,
    };
  }

  if (method === 'quality') {
    // CRF (constant quality) + preset. Optional downscale too.
    return {
      mode: 'crf',
      crf: settings.crf != null ? Number(settings.crf) : undefined,
      preset: settings.preset || 'medium',
      scaleHeight,
      audioKbps,
      twoPass: false,
    };
  }

  if (method === 'resolution') {
    // Quality-based downscale; CRF chosen by codec in buildArgs.
    // Use the upscale-guarded scaleHeight computed above (not the raw setting).
    return {
      mode: 'crf',
      crf: settings.crf, // may be undefined -> buildArgs picks codec default
      preset: settings.preset || 'medium',
      scaleHeight,
      audioKbps,
      twoPass: false,
    };
  }

  throw new Error(`Unknown compression method: ${method}`);
}

module.exports = {
  plan,
  videoKbpsForTargetBytes,
  audioKbpsFor,
  OVERHEAD,
  MIN_VIDEO_KBPS,
};
