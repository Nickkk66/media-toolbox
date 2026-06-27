'use strict';

// Manual end-to-end check (not part of `npm test`): probes a real file, runs a
// real compression via the job runner + bundled ffmpeg, and reports the result.
// Usage: node test/e2e.manual.js <inputVideo> [method] [value]

const path = require('path');
const fs = require('fs');
const { probe } = require('../src/main/ffmpeg/probe');
const encoders = require('../src/main/ffmpeg/encoders');
const { run } = require('../src/main/ffmpeg/runJob');
const { attach } = require('../src/main/ffmpeg/progress');

async function main() {
  const input = process.argv[2];
  const method = process.argv[3] || 'mb';
  const value = Number(process.argv[4] || 5);
  if (!input) {
    console.error('Usage: node test/e2e.manual.js <inputVideo> [method] [value]');
    process.exit(1);
  }

  const detected = await encoders.detect();
  console.log('Encoders:', detected.vendors);

  const meta = await probe(input);
  console.log(
    `Input: ${meta.video.width}x${meta.video.height}, ${meta.durationSec.toFixed(1)}s, ` +
      `${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB`
  );

  const settings = {
    codec: 'h264',
    encoder: 'cpu', // force CPU so this works on any machine in CI-like runs
    method,
    targetMB: value,
    percent: value,
    videoKbps: value,
    scaleHeight: 0,
    audioKbps: 128,
  };

  const outputPath = path.join(
    path.dirname(input),
    path.parse(input).name + '_e2e_out.mp4'
  );
  try {
    fs.unlinkSync(outputPath);
  } catch {
    /* ignore */
  }

  const ctrl = run(
    { jobId: 'e2e', inputPath: input, outputPath, settings, meta, detected },
    attach,
    {
      onProgress: (p) =>
        process.stdout.write(`\r  ${p.percent.toFixed(0)}%  ${p.speed.toFixed(1)}x   `),
    }
  );

  const result = await ctrl.promise;
  console.log(
    `\nDone: ${result.outputPath}\n  size: ${(result.outSize / 1024 / 1024).toFixed(2)} MB ` +
      `(target ${method}=${value})  encoder=${result.encoder}`
  );
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
