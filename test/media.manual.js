'use strict';

// Manual end-to-end check for every media type. Generates test inputs with the
// bundled ffmpeg, then compresses each via the real media modules + runJob.
// Usage: node test/media.manual.js <scratchDir>

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const media = require('../src/main/media');
const encoders = require('../src/main/ffmpeg/encoders');
const { run } = require('../src/main/ffmpeg/runJob');
const { attach } = require('../src/main/ffmpeg/progress');
const ffmpegPath = require('../src/main/ffmpeg/ffmpegPath');

const scratch = process.argv[2];
if (!scratch) { console.error('pass scratch dir'); process.exit(1); }
fs.mkdirSync(scratch, { recursive: true });
const FF = ffmpegPath.ffmpeg;

function gen() {
  const img = path.join(scratch, 'in.png');
  const gif = path.join(scratch, 'in.gif');
  const aud = path.join(scratch, 'in.wav');
  execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=1920x1080:rate=1', '-frames:v', '1', img]);
  execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=480x480:rate=15', '-t', '3', gif]);
  execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:sample_rate=48000', '-t', '10', aud]);
  return { img, gif, aud };
}

async function compress(label, mediaType, inputPath, settings) {
  const mod = media.getByType(mediaType);
  const detected = await encoders.detect();
  const meta = await mod.probe(inputPath);
  const ext = mod.outExt(settings, inputPath);
  const out = path.join(scratch, `out_${label}.${ext}`);
  try { fs.unlinkSync(out); } catch { /* */ }
  const ctrl = run(
    { jobId: label, mediaType, inputPath, outputPath: out, settings, meta, detected },
    attach, {}
  );
  await ctrl.promise;
  const inSz = meta.sizeBytes || fs.statSync(inputPath).size;
  const outSz = fs.statSync(out).size;
  console.log(`${label.padEnd(14)} ${(inSz / 1024).toFixed(0)}KB -> ${(outSz / 1024).toFixed(0)}KB  (${ext})`);
}

(async () => {
  const { img, gif, aud } = gen();
  console.log('typeForPath in.png =', media.typeForPath(img));
  console.log('typeForPath in.gif =', media.typeForPath(gif));
  console.log('typeForPath in.wav =', media.typeForPath(aud));
  console.log('hasGhostscript =', ffmpegPath.hasGhostscript());

  await compress('image-jpg', 'image', img, { outputFormat: 'jpg', quality: 60, scalePercent: 100 });
  await compress('image-webp', 'image', img, { outputFormat: 'webp', quality: 60, scalePercent: 50 });
  await compress('image-png', 'image', img, { outputFormat: 'png', quality: 50, scalePercent: 100 });
  await compress('gif-opt', 'gif', gif, { outputFormat: 'gif', colors: 64, scalePercent: 75, fps: 10 });
  await compress('gif-mp4', 'gif', gif, { outputFormat: 'mp4', scalePercent: 100, fps: 0 });
  await compress('audio-mp3', 'audio', aud, { outputFormat: 'mp3', method: 'bitrate', audioKbps: 96 });
  await compress('audio-aac', 'audio', aud, { outputFormat: 'aac', method: 'mb', targetMB: 0.1 });

  // PDF: build a tiny pdf via ghostscript if available, else skip.
  if (ffmpegPath.hasGhostscript()) {
    const pdfIn = path.join(scratch, 'in.pdf');
    // make a simple multipage pdf using ghostscript's ps2pdf-ish: convert the png to pdf via ffmpeg
    execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', img, pdfIn]);
    await compress('pdf-ebook', 'pdf', pdfIn, { preset: 'screen' });
  }

  console.log('\nALL MEDIA TYPES OK');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
