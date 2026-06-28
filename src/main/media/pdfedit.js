'use strict';

// Visual PDF editing helpers used by the Crop PDF and Organize PDF tools.
//
//  - thumbs()   : render every page to a small PNG (Ghostscript) and read each
//                 page's size in POINTS (origin bottom-left) so the renderer can
//                 map a drawn box back to PDF coordinates.
//  - crop()     : set the CropBox on every page (Ghostscript pdfmark).
//  - organize() : reorder / drop / rotate pages (qpdf).
//
// All temp thumbnails live under the OS temp folder in a per-call dir; the
// caller (ipc.js) wipes the parent dir on app quit, and we also clear stale
// thumb dirs before each fresh render.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

// Ghostscript chokes on backslashes inside its `(...)` PostScript string
// literals, so always feed it forward-slash paths.
function gsPath(p) { return String(p).replace(/\\/g, '/'); }

function fileUrl(p) {
  return 'file:///' + String(p).replace(/\\/g, '/').replace(/ /g, '%20');
}

function run(bin, args, label) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '').split('\n').filter(Boolean)[0] || (label + ' failed');
        return reject(new Error(msg));
      }
      resolve(String(stdout || ''));
    });
  });
}

// Root temp dir for thumbnail renders; wiped on app quit by ipc.js.
function thumbsRoot() {
  return path.join(os.tmpdir(), 'mtb-pdf-thumbs');
}

function cleanupThumbs() {
  try { fs.rmSync(thumbsRoot(), { recursive: true, force: true }); } catch { /* */ }
}

// Read page count + each page's MediaBox (in points) via a tiny PostScript
// program run through Ghostscript with the display device disabled.
async function readPageBoxes(inputPath) {
  const gp = gsPath(inputPath);
  // For every page: emit "x0 y0 x1 y1" of the MediaBox on its own block. We mark
  // each page with a leading "P" line so parsing stays robust.
  const ps = `(${gp}) (r) file runpdfbegin `
    + `pdfpagecount dup (COUNT ) print == `
    + `1 1 3 -1 roll { pdfgetpage /MediaBox get (BOX ) print `
    + `dup 0 get == dup 1 get == dup 2 get == 3 get == } for quit`;
  const out = await run(ffmpegPath.ghostscript,
    ['-q', '-dNODISPLAY', '-dNOSAFER', '-dBATCH', '-c', ps], 'PDF read');

  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let count = 0;
  const boxes = [];
  let pending = [];
  for (const line of lines) {
    if (line.startsWith('COUNT')) {
      count = parseInt(line.replace('COUNT', '').trim(), 10) || 0;
    } else if (line.startsWith('BOX')) {
      // A new MediaBox block begins; flush any complete previous block.
      if (pending.length === 4) boxes.push(pending);
      pending = [];
    } else {
      const n = parseFloat(line);
      if (!Number.isNaN(n)) pending.push(n);
    }
  }
  if (pending.length === 4) boxes.push(pending);
  return { count, boxes };
}

// Render every page to a small PNG and return per-page { thumb, wPt, hPt }.
// DPI is intentionally low (preview only). Page size in points comes from the
// MediaBox; if that probe fails we fall back to the first page / a Letter size.
async function thumbs(inputPath) {
  if (!ffmpegPath.hasGhostscript()) throw new Error('PDF preview requires Ghostscript, which was not found.');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('No input PDF.');

  cleanupThumbs();
  const dir = path.join(thumbsRoot(), 'job_' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  const pattern = path.join(dir, 'p-%03d.png');
  await run(ffmpegPath.ghostscript, [
    '-sDEVICE=png16m', '-r60', '-dNOPAUSE', '-dBATCH', '-dQUIET',
    '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
    '-o', pattern, inputPath,
  ], 'PDF preview');

  // Best-effort page sizes; never let a probe failure kill the thumbnails.
  let sizes = { count: 0, boxes: [] };
  try { sizes = await readPageBoxes(inputPath); } catch { /* fall back below */ }

  // Collect the PNGs that were actually written, in order.
  const files = fs.readdirSync(dir)
    .filter((f) => /^p-\d+\.png$/i.test(f))
    .sort();

  const fallback = sizes.boxes[0] || [0, 0, 612, 792]; // Letter
  const pages = files.map((f, i) => {
    const box = sizes.boxes[i] || fallback;
    const wPt = Math.round((box[2] - box[0]) * 100) / 100;
    const hPt = Math.round((box[3] - box[1]) * 100) / 100;
    return { thumb: fileUrl(path.join(dir, f)), wPt, hPt };
  });

  return { pages, count: pages.length, dir };
}

// Set the CropBox on every page. cropPt is in PDF points, origin bottom-left:
// { x0, y0, x1, y1 }. (Per-page crops aren't exposed by the UI yet, but the
// pdfmark /PAGES form applies the box to all pages, which is what we want.)
async function crop({ inputPath, cropPt, outputPath }) {
  if (!ffmpegPath.hasGhostscript()) throw new Error('Cropping requires Ghostscript, which was not found.');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('No input PDF.');
  const c = cropPt || {};
  const x0 = Number(c.x0), y0 = Number(c.y0), x1 = Number(c.x1), y1 = Number(c.y1);
  if ([x0, y0, x1, y1].some((v) => Number.isNaN(v)) || x1 <= x0 || y1 <= y0) {
    throw new Error('Invalid crop rectangle.');
  }
  // Round to whole points; pdfmark expects numbers.
  const box = [x0, y0, x1, y1].map((v) => Math.round(v)).join(' ');
  await run(ffmpegPath.ghostscript, [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dNOPAUSE', '-dBATCH', '-dQUIET',
    '-o', outputPath,
    '-c', `[/CropBox [${box}] /PAGES pdfmark`,
    '-f', inputPath,
  ], 'Crop');
  let outSize = 0; try { outSize = fs.statSync(outputPath).size; } catch { /* */ }
  return { outputPath, outSize };
}

// Reorder / drop / rotate pages with qpdf.
//  order     : array of ORIGINAL 1-based page numbers, in the new order. Pages
//              omitted from this list are dropped.
//  rotations : map of OUTPUT page index (1-based, position in `order`) -> degrees
//              (0/90/180/270). Applied after page selection, so the keys are the
//              final positions, not the original page numbers.
async function organize({ inputPath, order, rotations, outputPath }) {
  if (!ffmpegPath.hasQpdf()) throw new Error('Organizing requires qpdf, which was not found.');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('No input PDF.');
  const ord = (order || []).map((n) => parseInt(n, 10)).filter((n) => n >= 1);
  if (!ord.length) throw new Error('Keep at least one page.');

  const args = [inputPath, '--pages', '.', ord.join(','), '--'];

  // Group output positions by rotation degree → one --rotate flag per group.
  // qpdf normalizes degrees; 0 means "no rotation" so we skip those.
  const byDeg = new Map();
  ord.forEach((_orig, idx) => {
    const outPos = idx + 1;
    let deg = Number((rotations || {})[outPos]) || 0;
    deg = ((deg % 360) + 360) % 360;
    if (deg === 0) return;
    if (!byDeg.has(deg)) byDeg.set(deg, []);
    byDeg.get(deg).push(outPos);
  });
  for (const [deg, positions] of byDeg) {
    args.push(`--rotate=+${deg}:${positions.join(',')}`);
  }

  args.push(outputPath);
  await run(ffmpegPath.qpdf, args, 'Organize');
  let outSize = 0; try { outSize = fs.statSync(outputPath).size; } catch { /* */ }
  return { outputPath, outSize };
}

module.exports = { thumbs, crop, organize, cleanupThumbs, thumbsRoot };
