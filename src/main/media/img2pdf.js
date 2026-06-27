'use strict';

// Image -> PDF. ffmpeg normalizes the image to a JPEG, then a small JS step
// embeds that JPEG into a one-page PDF (DCTDecode). No extra tools needed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('../ffmpeg/ffmpegPath');

const extensions = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'];
const outputFormats = [{ value: 'pdf', label: 'PDF' }];

function defaultSettings() { return { outputFormat: 'pdf' }; }
function outExt() { return 'pdf'; }

function probe(inputPath) {
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(inputPath).size; } catch { /* ignore */ }
  return Promise.resolve({ type: 'img2pdf', sizeBytes, durationSec: 0 });
}

// Find JPEG dimensions by scanning SOF markers.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF15 (except DHT=C4, DNL=C8, DAC=CC) carry frame dimensions.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { width: 612, height: 792 };
}

function jpegToPdf(jpegPath, pdfPath) {
  const jpeg = fs.readFileSync(jpegPath);
  const { width, height } = jpegSize(jpeg);

  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  const xobjHeader = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`;
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (s) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); chunks.push(b); pos += b.length; };

  push('%PDF-1.4\n');
  // obj 1,2,3 (plain dictionaries)
  for (let n = 0; n < 3; n++) {
    offsets[n + 1] = pos;
    push(`${n + 1} 0 obj\n${objects[n]}\nendobj\n`);
  }
  // obj 4: image stream
  offsets[4] = pos;
  push(`4 0 obj\n${xobjHeader}\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  // obj 5: content stream
  offsets[5] = pos;
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  fs.writeFileSync(pdfPath, Buffer.concat(chunks));
}

const GLOBALS = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error'];

function build({ inputPath, outputPath }) {
  const tmpJpeg = path.join(os.tmpdir(), `vc_i2p_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
  // Flatten any alpha onto white, force standard chroma.
  const args = [...GLOBALS, '-i', inputPath, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuvj420p', '-q:v', '3', tmpJpeg];
  return {
    binary: ffmpegPath.ffmpeg,
    passes: [args],
    twoPass: false,
    durationSec: 0,
    outputPath,
    finalize: async () => {
      jpegToPdf(tmpJpeg, outputPath);
      try { fs.unlinkSync(tmpJpeg); } catch { /* ignore */ }
    },
  };
}

module.exports = { type: 'img2pdf', extensions, outputFormats, defaultSettings, outExt, probe, build, jpegToPdf };
