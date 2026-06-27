'use strict';

// PDF media module — compression via bundled Ghostscript.

const fs = require('fs');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['pdf'];

const outputFormats = [{ value: 'pdf', label: 'PDF' }];

// Ghostscript -dPDFSETTINGS presets, smallest -> largest.
const PRESETS = {
  screen: '/screen', // 72 dpi, smallest
  ebook: '/ebook', // 150 dpi, good balance
  printer: '/printer', // 300 dpi
  prepress: '/prepress', // 300 dpi, color preserving
};

function defaultSettings() {
  return { outputFormat: 'pdf', preset: 'ebook' };
}

function outExt() {
  return 'pdf';
}

function probe(inputPath) {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
  return Promise.resolve({ type: 'pdf', sizeBytes, durationSec: 0 });
}

function build({ settings, inputPath, outputPath }) {
  if (!ffmpegPath.hasGhostscript()) {
    throw new Error('PDF compression requires Ghostscript, which was not found in this build.');
  }
  const setting = PRESETS[settings.preset] || PRESETS.ebook;
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-dPDFSETTINGS=${setting}`,
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ];
  return { binary: ffmpegPath.ghostscript, passes: [args], twoPass: false, durationSec: 0 };
}

module.exports = { type: 'pdf', extensions, outputFormats, defaultSettings, outExt, probe, build };
