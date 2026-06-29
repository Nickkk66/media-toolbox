'use strict';

// Populate vendor/bin with the CORE engine binaries for THIS platform so
// electron-builder can bundle them (extraResources). Run in CI before the build.
// Downloads from the engines-v1 GitHub release; extracts with the OS's native
// unzip; sets the executable bit on macOS/Linux.
//
// Only the always-needed core engines live in bin/ (ffmpeg, ffprobe, yt-dlp,
// 7-Zip). The heavier engines stay on-demand (engines.js).

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = 'https://github.com/Nickkk66/media-toolbox/releases/download/engines-v1/';

const OS = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const KEY = `${OS}-${ARCH}`;

// engine asset name -> vendor subdir to extract into.
const CORE = [
  { name: 'ffmpeg', subdir: 'bin' },
  { name: 'ytdlp', subdir: 'bin' },
  { name: 'sevenzip', subdir: 'bin' },
];

const root = path.resolve(__dirname, '..');

function download(url, dest, redirects = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'media-toolbox-ci' } }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects - 1));
      }
      if (code !== 200) { res.resume(); return reject(new Error(`HTTP ${code} for ${url}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  let r;
  if (process.platform === 'win32') {
    r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(dir)} -Force`], { stdio: 'inherit' });
  } else {
    r = spawnSync('unzip', ['-o', zip, '-d', dir], { stdio: 'inherit' });
  }
  if (r.status !== 0) throw new Error(`unzip failed for ${zip}`);
}

function chmodTree(dir) {
  if (process.platform === 'win32') return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) chmodTree(full);
    else { try { fs.chmodSync(full, 0o755); } catch { /* */ } }
  }
}

(async () => {
  console.log(`Fetching core engines for ${KEY}...`);
  for (const { name, subdir } of CORE) {
    const asset = `${name}-${KEY}.zip`;
    const dest = path.join(root, `${name}.${KEY}.zip`);
    const outDir = path.join(root, 'vendor', subdir);
    try {
      await download(BASE + asset, dest);
      unzip(dest, outDir);
      console.log(`  ✓ ${asset} -> vendor/${subdir}`);
    } catch (e) {
      console.error(`  ✗ ${asset}: ${e.message}`);
      process.exitCode = 1;
    } finally {
      try { fs.unlinkSync(dest); } catch { /* */ }
    }
  }
  chmodTree(path.join(root, 'vendor', 'bin'));
  console.log('Done.');
})();
