'use strict';

// Thumbnail Grab — extract a single frame from a video at a chosen timestamp
// and save it as a PNG or JPG. A real (non-generative) thumbnail.

const { probe } = require('../ffmpeg/probe');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'mpg', 'ts'];
const outputFormats = [{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }];

function defaultSettings() {
  return { op: 'thumb', outputFormat: 'png', time: '00:00:01' };
}
function outExt(settings) {
  return (settings && settings.outputFormat) || 'png';
}

async function probeMedia(inputPath) { const m = await probe(inputPath); m.type = 'thumbgrab'; return m; }

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error'];

function build({ settings, inputPath, outputPath }) {
  // -ss before -i seeks fast (keyframe), -frames:v 1 grabs exactly one frame.
  const t = String(settings.time || '00:00:00').trim() || '00:00:00';
  const args = [...GLOBALS, '-ss', t, '-i', inputPath, '-frames:v', '1'];
  // JPG needs a sane quality; PNG is lossless by default.
  if (outExt(settings) === 'jpg') args.push('-q:v', '2');
  args.push(outputPath);
  // Single image → no usable progress duration (pipeline emits a pulse).
  return { binary: ffmpegPath.ffmpeg, passes: [args], twoPass: false, durationSec: 0 };
}

module.exports = { type: 'thumbgrab', extensions, outputFormats, defaultSettings, outExt, probe: probeMedia, build };
