'use strict';

// electron-builder afterPack hook.
//
// onnxruntime-node ships native binaries for every platform/arch (~260 MB). Each
// OS build only needs its own, so right after the app is packed we delete the
// other platforms' binaries from the packaged app. This keeps every installer
// lean without maintaining per-OS `files` filters.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function findNapiDir(root, depth = 0) {
  if (depth > 10) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    if (e.name === 'napi-v6' && full.includes(path.join('onnxruntime-node', 'bin'))) return full;
    const found = findNapiDir(full, depth + 1);
    if (found) return found;
  }
  return null;
}

exports.default = async function afterPack(context) {
  // electronPlatformName: 'win32' | 'darwin' | 'linux'
  const keepPlatform = context.electronPlatformName === 'win32' ? 'win32'
    : context.electronPlatformName === 'darwin' ? 'darwin' : 'linux';

  // Arch enum -> name (0 ia32, 1 x64, 3 arm64, 4 universal).
  let keepArch = null;
  try { keepArch = require('electron-builder').Arch[context.arch]; } catch { keepArch = null; }

  const napi = findNapiDir(context.appOutDir);
  if (napi) {
    for (const plat of fs.readdirSync(napi)) {
      const platDir = path.join(napi, plat);
      if (plat !== keepPlatform) {
        try { fs.rmSync(platDir, { recursive: true, force: true }); } catch { /* */ }
        continue;
      }
      // Within the kept platform, drop non-target arch dirs (skip for universal).
      if (keepArch && keepArch !== 'universal') {
        let archs = [];
        try { archs = fs.readdirSync(platDir); } catch { archs = []; }
        for (const a of archs) {
          if (a !== keepArch) { try { fs.rmSync(path.join(platDir, a), { recursive: true, force: true }); } catch { /* */ } }
        }
      }
    }
  }

  // macOS: ad-hoc sign the app AFTER pruning. Apple Silicon refuses to launch a
  // wholly unsigned arm64 app ("...is damaged and can't be opened"); an ad-hoc
  // signature turns that into the normal "unidentified developer" right-click →
  // Open flow. Done here (not via electron-builder signing) since we ship
  // without a Developer ID certificate.
  if (context.electronPlatformName === 'darwin') {
    let appName = null;
    try { appName = fs.readdirSync(context.appOutDir).find((f) => f.endsWith('.app')); } catch { /* */ }
    if (appName) {
      const appPath = path.join(context.appOutDir, appName);
      try {
        cp.execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        console.log('afterPack: ad-hoc signed', appName);
      } catch (e) {
        console.warn('afterPack: ad-hoc codesign failed:', e.message);
      }
    }
  }
};
