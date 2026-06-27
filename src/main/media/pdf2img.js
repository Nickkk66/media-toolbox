'use strict';

// PDF -> images (one image per page) via Ghostscript. Writes into a folder
// named after the PDF and returns that folder as the output path.

const fs = require('fs');
const path = require('path');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['pdf'];
const outputFormats = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
];

function defaultSettings() {
  return { outputFormat: 'jpg', dpi: 150 };
}

function outExt(settings) {
  return settings.outputFormat || 'jpg';
}

function probe(inputPath) {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
  return Promise.resolve({ type: 'pdf2img', sizeBytes, durationSec: 0 });
}

function build({ settings, inputPath, outputPath }) {
  if (!ffmpegPath.hasGhostscript()) {
    throw new Error('PDF conversion requires Ghostscript, which was not found.');
  }
  const fmt = settings.outputFormat === 'png' ? 'png' : 'jpg';
  const dev = fmt === 'png' ? 'png16m' : 'jpeg';
  const dpi = Number(settings.dpi) || 150;

  // outputPath is dir/name.<ext>; turn it into a folder dir/name_pages/.
  const folder = path.join(path.dirname(outputPath), path.parse(outputPath).name);
  fs.mkdirSync(folder, { recursive: true });
  const pattern = path.join(folder, `page_%03d.${fmt}`);

  const args = [
    '-sDEVICE=' + dev,
    `-r${dpi}`,
    '-dNOPAUSE', '-dBATCH', '-dQUIET',
    '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
  ];
  if (fmt === 'jpg') args.push('-dJPEGQ=90');
  args.push('-o', pattern, inputPath);

  return { binary: ffmpegPath.ghostscript, passes: [args], twoPass: false, durationSec: 0, outputPath: folder };
}

module.exports = { type: 'pdf2img', extensions, outputFormats, defaultSettings, outExt, probe, build };
