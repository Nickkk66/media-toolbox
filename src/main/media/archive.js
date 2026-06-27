'use strict';

// Archive converter — re-pack an archive (or any file/folder) into ZIP / 7Z /
// TAR using the bundled 7-Zip. For converting an existing archive to another
// format we extract then recompress; for a plain file we just compress it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['zip', '7z', 'tar', 'gz', 'rar', 'bz2', 'xz', 'tgz'];
const outputFormats = [
  { value: 'zip', label: 'ZIP' },
  { value: '7z', label: '7Z' },
  { value: 'tar', label: 'TAR' },
];

function defaultSettings() {
  return { outputFormat: 'zip' };
}

function outExt(settings) {
  return settings.outputFormat || 'zip';
}

function probe(inputPath) {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
  return Promise.resolve({ type: 'archive', sizeBytes, durationSec: 0 });
}

const ARCHIVE_RE = /\.(zip|7z|tar|gz|rar|bz2|xz|tgz)$/i;

function build({ settings, inputPath, outputPath }) {
  if (!ffmpegPath.hasSevenzip()) {
    throw new Error('Archive conversion requires 7-Zip, which was not found.');
  }
  const fmt = settings.outputFormat || 'zip';

  // If the input is itself an archive, extract to a temp dir then recompress.
  if (ARCHIVE_RE.test(inputPath)) {
    const tmp = path.join(os.tmpdir(), `vc_arc_${Date.now()}_${path.parse(inputPath).name}`);
    fs.mkdirSync(tmp, { recursive: true });
    // 7za can't chain extract+add in one call, so we run two passes.
    const extract = [ffmpegPath.sevenzip, 'x', inputPath, `-o${tmp}`, '-y'];
    const compress = [ffmpegPath.sevenzip, 'a', `-t${fmt}`, outputPath, `${tmp}/*`, '-y'];
    return {
      binary: ffmpegPath.sevenzip,
      passes: [extract.slice(1), compress.slice(1)],
      twoPass: true, durationSec: 0,
    };
  }

  // Plain file/folder -> archive.
  const args = ['a', `-t${fmt}`, outputPath, inputPath, '-y'];
  return { binary: ffmpegPath.sevenzip, passes: [args], twoPass: false, durationSec: 0 };
}

module.exports = { type: 'archive', extensions, outputFormats, defaultSettings, outExt, probe, build };
