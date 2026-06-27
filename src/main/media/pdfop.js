'use strict';

// PDF tools. Page-structure operations (extract / remove / rotate / unlock /
// split) go through qpdf; re-distilling operations (flatten / protect / resize)
// go through Ghostscript.

const fs = require('fs');
const path = require('path');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['pdf'];
const outputFormats = [{ value: 'pdf', label: 'PDF' }];

function defaultSettings() {
  return { op: 'flatten', outputFormat: 'pdf', firstPage: 1, lastPage: 0, removeFirst: 1, removeLast: 1, angle: 90, password: '', paper: 'a4' };
}
function outExt() { return 'pdf'; }

function probe(inputPath) {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(inputPath).size; } catch { /* */ }
  return Promise.resolve({ type: 'pdfop', sizeBytes, durationSec: 0 });
}

const GS_BASE = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dNOPAUSE', '-dBATCH', '-dQUIET'];

function build({ settings, inputPath, outputPath }) {
  const op = settings.op;
  const qpdf = ffmpegPath.qpdf;
  const hasQ = ffmpegPath.hasQpdf();

  // ---- qpdf-based page operations ----
  if (op === 'extract') {
    if (!hasQ) throw new Error('This needs qpdf, which was not found.');
    const f = Math.max(1, Number(settings.firstPage) || 1);
    const l = Number(settings.lastPage) || 0;
    const range = l >= f ? `${f}-${l}` : `${f}-z`;
    return { binary: qpdf, passes: [['--empty', '--pages', inputPath, range, '--', outputPath]], durationSec: 0 };
  }
  if (op === 'remove') {
    if (!hasQ) throw new Error('This needs qpdf, which was not found.');
    const f = Math.max(1, Number(settings.removeFirst) || 1);
    const l = Math.max(f, Number(settings.removeLast) || f);
    // Keep everything except pages f..l: pages 1..f-1 and l+1..end.
    const keep = [];
    if (f > 1) keep.push(`1-${f - 1}`);
    keep.push(`${l + 1}-z`);
    const args = ['--empty', '--pages'];
    keep.forEach((r) => { args.push(inputPath, r); });
    args.push('--', outputPath);
    return { binary: qpdf, passes: [args], durationSec: 0 };
  }
  if (op === 'rotate') {
    if (!hasQ) throw new Error('This needs qpdf, which was not found.');
    const a = Number(settings.angle) || 90;
    return { binary: qpdf, passes: [[`--rotate=+${a}`, inputPath, outputPath]], durationSec: 0 };
  }
  if (op === 'unlock') {
    if (!hasQ) throw new Error('This needs qpdf, which was not found.');
    const pw = settings.password || '';
    return { binary: qpdf, passes: [['--decrypt', `--password=${pw}`, inputPath, outputPath]], durationSec: 0 };
  }
  if (op === 'split') {
    if (!hasQ) throw new Error('This needs qpdf, which was not found.');
    const folder = path.join(path.dirname(outputPath), path.parse(outputPath).name);
    fs.mkdirSync(folder, { recursive: true });
    const pattern = path.join(folder, 'page_%d.pdf');
    return { binary: qpdf, passes: [['--split-pages=1', inputPath, pattern]], durationSec: 0, outputPath: folder };
  }

  // ---- Ghostscript-based operations ----
  if (!ffmpegPath.hasGhostscript()) throw new Error('This needs Ghostscript, which was not found.');
  let args = [...GS_BASE];
  if (op === 'protect') {
    const pw = settings.password || '';
    if (!pw) throw new Error('Enter a password to protect the PDF.');
    args.push('-sOwnerPassword=' + pw, '-sUserPassword=' + pw, '-dEncryptionR=3', '-dKeyLength=128');
  } else if (op === 'resize') {
    args.push('-sPAPERSIZE=' + (settings.paper || 'a4'), '-dFIXEDMEDIA', '-dPDFFitPage');
  } else if (op === 'flatten') {
    args.push('-dPreserveAnnots=false');
  }
  args.push('-o', outputPath, inputPath);
  return { binary: ffmpegPath.ghostscript, passes: [args], durationSec: 0 };
}

module.exports = { type: 'pdfop', extensions, outputFormats, defaultSettings, outExt, probe, build };
