'use strict';

// AI Model Manager — downloads / removes the optional model weights used by the
// local AI features (currently whisper.cpp transcription). The engines
// themselves (whisper-cli, realesrgan) are bundled binaries resolved in
// ffmpegPath.js; only the large model files are managed here so the installer
// stays small and users fetch just what they need.
//
// Node https/fs only — no new npm deps. The download follows cross-host HTTPS
// redirects (HuggingFace -> cdn-lfs), writes to a temp file, verifies the size,
// then atomically renames to the final path so a partial/aborted download can
// never masquerade as an installed model.

const fs = require('fs');
const path = require('path');
const https = require('https');

let electronApp = null;
try { electronApp = require('electron').app; } catch { electronApp = null; }

const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
function hfUrl(file) { return HF + file; }

// rembg ships the U²-Net / IS-Net ONNX weights as GitHub release assets.
const REMBG = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/';
function rembgUrl(file) { return REMBG + file; }

// ---- Manifest -------------------------------------------------------------
// Each entry: { id, label, file, url, sizeBytes, tier }. Real-ESRGAN models are
// bundled (not managed). Managed features: `whisper` (transcription) and
// `bgremoval` (U²-Net / IS-Net background removal, run via onnxruntime-node).
const MODELS = {
  whisper: [
    { id: 'tiny',           label: 'Tiny (fast, ~78 MB)',          file: 'ggml-tiny.bin',           sizeBytes: 77700000,   tier: 'fast' },
    { id: 'base',           label: 'Base (balanced, ~148 MB)',     file: 'ggml-base.bin',           sizeBytes: 148000000,  tier: 'balanced' },
    { id: 'small',          label: 'Small (better, ~488 MB)',      file: 'ggml-small.bin',          sizeBytes: 488000000,  tier: 'better' },
    { id: 'medium',         label: 'Medium (high, ~1.5 GB)',       file: 'ggml-medium.bin',         sizeBytes: 1530000000, tier: 'high' },
    { id: 'large-v3-turbo', label: 'Large v3 Turbo (best, ~1.6 GB)', file: 'ggml-large-v3-turbo.bin', sizeBytes: 1620000000, tier: 'best' },
  ],
  bgremoval: [
    { id: 'u2netp',            label: 'U²-Net P (light, ~4 MB)',     file: 'u2netp.onnx',            sizeBytes: 4574861,   tier: 'light',    host: 'rembg' },
    { id: 'u2net',             label: 'U²-Net (standard, ~176 MB)',  file: 'u2net.onnx',             sizeBytes: 175997641, tier: 'standard', host: 'rembg' },
    { id: 'isnet-general-use', label: 'IS-Net (best, ~179 MB)',      file: 'isnet-general-use.onnx', sizeBytes: 178648008, tier: 'best',     host: 'rembg' },
  ],
};
// Fill in each entry's download URL (HF resolve for whisper, GitHub release for rembg).
for (const list of Object.values(MODELS)) {
  for (const m of list) m.url = (m.host === 'rembg') ? rembgUrl(m.file) : hfUrl(m.file);
}

// ---- Paths ----------------------------------------------------------------
function userData() {
  try { return electronApp.getPath('userData'); }
  catch { return path.join(require('os').tmpdir(), 'media-toolbox'); }
}

// userData/models/<feature> (created if missing).
function modelsDir(feature) {
  const dir = path.join(userData(), 'models', feature);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  return dir;
}

function entry(feature, id) {
  return (MODELS[feature] || []).find((m) => m.id === id) || null;
}

// Full path to a model's file inside its feature's models dir.
function modelPath(feature, id) {
  const e = entry(feature, id);
  if (!e) return null;
  return path.join(modelsDir(feature), e.file);
}

// Installed = file exists AND its size is within ~5% of the expected size (so a
// truncated/partial file is rejected and offered for re-download).
function isInstalled(feature, id) {
  const e = entry(feature, id);
  if (!e) return false;
  const p = modelPath(feature, id);
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    const lo = e.sizeBytes * 0.95;
    return st.size >= lo; // accept anything from 95% upward (HF sizes are approx)
  } catch { return false; }
}

// Whole-manifest status: { whisper: [ {…entry, installed} ] }.
function status() {
  const out = {};
  for (const [feature, list] of Object.entries(MODELS)) {
    out[feature] = list.map((m) => ({ ...m, installed: isInstalled(feature, m.id) }));
  }
  return out;
}

// ---- Download -------------------------------------------------------------
// Track in-flight downloads so they can be cancelled.
const _active = new Map(); // key `${feature}:${id}` -> { req, tmp, cancelled }

function dlKey(feature, id) { return `${feature}:${id}`; }

// Follow redirects across hosts (HF 302s to cdn-lfs). Resolves with the final
// IncomingMessage (a 200 response) or rejects.
function openStream(url, onResponse, onError, depth) {
  if (depth > 8) { onError(new Error('Too many redirects.')); return null; }
  const req = https.get(url, { headers: { 'User-Agent': 'media-toolbox' } }, (res) => {
    const code = res.statusCode || 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume(); // drain
      const next = new URL(res.headers.location, url).toString();
      openStream(next, onResponse, onError, (depth || 0) + 1);
      return;
    }
    if (code !== 200) {
      res.resume();
      onError(new Error(`Download failed (HTTP ${code}).`));
      return;
    }
    onResponse(res);
  });
  req.on('error', onError);
  return req;
}

// download(feature, id, onProgress) -> Promise. Writes url -> temp file in
// modelsDir, then atomically renames to the final file. Calls
// onProgress({ feature, id, received, total, percent }) periodically. Rejects on
// size mismatch / network error and cleans up the temp file.
function download(feature, id, onProgress) {
  const e = entry(feature, id);
  if (!e) return Promise.reject(new Error(`Unknown model: ${feature}/${id}`));

  const finalPath = modelPath(feature, id);
  const dir = modelsDir(feature);
  const tmp = path.join(dir, `.${e.file}.part`);
  const key = dlKey(feature, id);

  // Clean any stale temp from a previous aborted run.
  try { fs.unlinkSync(tmp); } catch { /* */ }

  return new Promise((resolve, reject) => {
    const rec = { req: null, tmp, cancelled: false };
    _active.set(key, rec);

    let out;
    try { out = fs.createWriteStream(tmp); }
    catch (err) { _active.delete(key); return reject(err); }

    let received = 0;
    let total = e.sizeBytes;
    let lastTick = 0;
    let settled = false;

    const cleanup = () => { try { fs.unlinkSync(tmp); } catch { /* */ } };
    const fail = (err) => {
      if (settled) return; settled = true;
      _active.delete(key);
      try { out.destroy(); } catch { /* */ }
      cleanup();
      reject(err);
    };
    const finish = () => {
      if (settled) return; settled = true;
      _active.delete(key);
      // Size sanity check before promoting the temp file.
      let size = 0;
      try { size = fs.statSync(tmp).size; } catch { /* */ }
      if (size < e.sizeBytes * 0.95) { cleanup(); return reject(new Error('Download incomplete (size mismatch).')); }
      try {
        try { fs.unlinkSync(finalPath); } catch { /* */ }
        fs.renameSync(tmp, finalPath);
      } catch (err) { cleanup(); return reject(err); }
      if (onProgress) { try { onProgress({ feature, id, received: size, total: size, percent: 100 }); } catch { /* */ } }
      resolve({ feature, id, path: finalPath, size });
    };

    const req = openStream(e.url, (res) => {
      if (rec.cancelled) { res.destroy(); return; }
      const len = Number(res.headers['content-length']);
      if (len > 0) total = len;
      res.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (onProgress && (now - lastTick > 120)) {
          lastTick = now;
          const percent = total > 0 ? Math.min(99.9, (received / total) * 100) : 0;
          try { onProgress({ feature, id, received, total, percent }); } catch { /* */ }
        }
      });
      res.on('error', fail);
      res.pipe(out);
    }, fail, 0);

    rec.req = req;

    out.on('error', fail);
    out.on('finish', () => { if (!rec.cancelled) finish(); });
  });
}

// Cancel an in-flight download. Returns true if one was aborted.
function cancel(feature, id) {
  const key = dlKey(feature, id);
  const rec = _active.get(key);
  if (!rec) return false;
  rec.cancelled = true;
  try { if (rec.req) rec.req.destroy(new Error('cancelled')); } catch { /* */ }
  try { fs.unlinkSync(rec.tmp); } catch { /* */ }
  _active.delete(key);
  return true;
}

// remove(feature, id) -> delete the file; returns boolean.
function remove(feature, id) {
  const p = modelPath(feature, id);
  if (!p) return false;
  try { fs.unlinkSync(p); return true; }
  catch { return false; }
}

module.exports = {
  MODELS,
  modelsDir,
  modelPath,
  isInstalled,
  status,
  download,
  cancel,
  remove,
};
