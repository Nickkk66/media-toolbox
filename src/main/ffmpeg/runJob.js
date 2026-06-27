'use strict';

// Runs a single compression job for ANY media type: resolves the media module,
// builds the command(s), spawns the right binary (ffmpeg or ghostscript),
// reports progress, and cleans up. Cancellable.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = require('../media');
const ffmpegPath = require('./ffmpegPath');

function cleanupPasslogs(prefix) {
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(base) && /\.(log|log\.mbtree|mbtree|cutree)$/.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// job: { jobId, mediaType, inputPath, outputPath, settings, meta, detected }
function run(job, attachProgress, callbacks = {}) {
  const { jobId, mediaType, inputPath, outputPath, settings, meta, detected } = job;
  const passlogPrefix = path.join(os.tmpdir(), `vc_${jobId}`);

  const mod = media.getByType(mediaType);
  if (!mod) throw new Error(`Unsupported media type: ${mediaType}`);

  const built = mod.build({ settings, meta, inputPath, outputPath, detected, passlogPrefix });
  // A module may redirect output (e.g. PDF->images writes into a folder).
  const finalOutputPath = built.outputPath || outputPath;
  const passes = built.passes;

  // Apply the ffmpeg thread cap (usage limit) — only for ffmpeg passes, inserted
  // as an output option just before the output sink. Never for gs/qpdf/7za.
  const threads = settings && Number(settings.threads) || 0;
  if (threads > 0 && built.binary === ffmpegPath.ffmpeg) {
    passes.forEach((p) => { p.splice(p.length - 1, 0, '-threads', String(threads)); });
  }
  const durationSec = built.durationSec || 0;
  const indeterminate = !(durationSec > 0);

  let current = null;
  let canceled = false;
  let stderrTail = '';

  function spawnPass(index) {
    return new Promise((resolve, reject) => {
      const range = passes.length === 2 ? (index === 0 ? [0, 50] : [50, 100]) : [0, 100];
      const proc = spawn(built.binary, passes[index], { windowsHide: true });
      current = proc;

      let detach = () => {};
      if (!indeterminate) {
        detach = attachProgress(
          proc,
          durationSec,
          (p) => callbacks.onProgress && callbacks.onProgress({ jobId, ...p }),
          range
        );
      } else {
        // No duration (image/pdf): emit a single "working" pulse.
        if (callbacks.onProgress) callbacks.onProgress({ jobId, percent: 50, indeterminate: true });
        // Drain stdout so the pipe doesn't stall.
        if (proc.stdout) proc.stdout.on('data', () => {});
      }

      proc.stderr.on('data', (d) => {
        const s = d.toString();
        stderrTail = (stderrTail + s).slice(-4000);
        if (callbacks.onLog) callbacks.onLog(s);
      });

      proc.on('error', (err) => {
        detach();
        reject(new Error(`Failed to start ${path.basename(built.binary)}: ${err.message}`));
      });

      proc.on('close', (code) => {
        detach();
        if (canceled) return reject(new Error('canceled'));
        if (code === 0) return resolve();
        reject(new Error(`${path.basename(built.binary)} exited with code ${code}\n${stderrTail}`));
      });
    });
  }

  const promise = (async () => {
    try {
      for (let i = 0; i < passes.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await spawnPass(i);
      }
      // Optional JS post-step (e.g. wrap a transcoded image into a PDF).
      if (typeof built.finalize === 'function') {
        if (callbacks.onProgress) callbacks.onProgress({ jobId, percent: 90, indeterminate: true });
        await built.finalize();
      }
      cleanupPasslogs(passlogPrefix);
      let outSize = 0;
      try { outSize = fs.statSync(finalOutputPath).size; } catch { /* ignore */ }
      return { jobId, outputPath: finalOutputPath, outSize, encoder: built.encoder };
    } catch (err) {
      cleanupPasslogs(passlogPrefix);
      if (canceled) {
        try { fs.unlinkSync(finalOutputPath); } catch { /* ignore */ }
      }
      throw err;
    }
  })();

  function cancel() {
    canceled = true;
    if (current && !current.killed) {
      current.kill();
      if (process.platform === 'win32' && current.pid) {
        try {
          spawn('taskkill', ['/pid', String(current.pid), '/T', '/F'], { windowsHide: true });
        } catch { /* ignore */ }
      }
    }
  }

  return { jobId, promise, cancel, encoder: built.encoder };
}

module.exports = { run, cleanupPasslogs };
