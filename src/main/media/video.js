'use strict';

// Video media module — wraps the existing probe/bitrate/buildArgs pipeline.

const { probe } = require('../ffmpeg/probe');
const { plan } = require('../ffmpeg/bitrate');
const buildArgs = require('../ffmpeg/buildArgs');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = [
  'mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg',
  'ts', 'm2ts', 'mts', '3gp', '3g2', 'vob', 'ogv', 'mxf', 'divx', 'f4v',
  'rm', 'rmvb', 'asf', 'mpv', 'm1v', 'wtv', 'dvr-ms', 'qt', 'xvid',
];

const outputFormats = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mkv', label: 'MKV' },
  { value: 'webm', label: 'WEBM' },
  { value: 'mov', label: 'MOV' },
];

function defaultSettings() {
  return {
    outputFormat: 'mp4',
    codec: 'h264',
    encoder: 'auto',
    method: 'percent',
    percent: 60,
    targetMB: 200,
    videoKbps: 4000,
    crf: 23,
    preset: 'medium',
    scaleHeight: 0,
    fps: 0,
    rotate: 0,
    flip: 'none',
    audioKbps: 128,
    audioCopy: false,
    audioCodec: 'auto',
    volume: 100,
    fadeIn: false,
    fadeOut: false,
    removeAudio: false,
    compatibility: false,
    compatProfile: 'main',
    trimStart: '',
    trimEnd: '',
    cropW: 0, cropH: 0, cropX: 0, cropY: 0,
  };
}

function outExt(settings) {
  // .ass soft subs force mkv.
  if (settings.subtitle && settings.subtitle.mode === 'soft' &&
      /\.(ass|ssa)$/i.test(settings.subtitle.path || '')) {
    return 'mkv';
  }
  return settings.outputFormat || 'mp4';
}

async function probeMedia(inputPath) {
  const m = await probe(inputPath);
  m.type = 'video';
  return m;
}

function build({ settings, meta, inputPath, outputPath, detected, passlogPrefix }) {
  const encPlan = plan(settings, meta);
  const built = buildArgs.build({
    plan: encPlan, settings, meta, detected, inputPath, outputPath, passlogPrefix,
  });
  return {
    binary: ffmpegPath.ffmpeg,
    passes: built.passes,
    twoPass: built.twoPass,
    durationSec: meta.durationSec,
    encoder: built.encoder,
  };
}

module.exports = { type: 'video', extensions, outputFormats, defaultSettings, outExt, probe: probeMedia, build };
