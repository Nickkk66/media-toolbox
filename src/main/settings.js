'use strict';

// Persisted app settings (usage limits). Stored in userData/settings.json.

const fs = require('fs');
const path = require('path');
const os = require('os');

let _file = null;
let _cache = null;

function file() {
  if (_file) return _file;
  let dir;
  try { dir = require('electron').app.getPath('userData'); }
  catch { dir = path.join(os.tmpdir(), 'media-toolbox'); }
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  _file = path.join(dir, 'settings.json');
  return _file;
}

const cores = Math.max(1, os.cpus() ? os.cpus().length : 4);

// Map a performance level to concrete limits.
function limitsFor(level) {
  if (level === 'low') return { threads: 1, concurrency: 1 };
  if (level === 'full') return { threads: 0, concurrency: 2 }; // 0 = ffmpeg auto (all cores)
  return { threads: Math.max(1, Math.floor(cores / 2)), concurrency: 1 }; // recommended
}

function defaults() {
  return {
    // Only real, functional settings. Everything here actually controls behavior.
    firstRun: true, performance: 'recommended', downloadLocation: 'downloads', customDownloadDir: '',
    theme: 'auto', reduceMotion: false, reduceTransparency: false,
    ...limitsFor('recommended'),
  };
}

function load() {
  if (_cache) return _cache;
  try { _cache = { ...defaults(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { _cache = defaults(); }
  // Re-derive limits from level unless explicitly overridden.
  if (_cache.performance !== 'custom') Object.assign(_cache, limitsFor(_cache.performance));
  return _cache;
}

function save(patch) {
  const cur = load();
  const next = { ...cur, ...patch };
  if (next.performance && next.performance !== 'custom') Object.assign(next, limitsFor(next.performance));
  _cache = next;
  try { fs.writeFileSync(file(), JSON.stringify(next, null, 2)); } catch { /* */ }
  return next;
}

// Reset every setting to defaults but keep firstRun=false (user is past onboarding).
function reset() {
  _cache = { ...defaults(), firstRun: false };
  try { fs.writeFileSync(file(), JSON.stringify(_cache, null, 2)); } catch { /* */ }
  return _cache;
}

module.exports = { load, save, reset, defaults, limitsFor, cores };
