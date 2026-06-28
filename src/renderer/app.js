'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  caps: null,
  section: 'compress',
  ws: null, // active workspace (file-based tool)
  outputDir: null,
  modalJobId: null,
  openMenuItem: null, // remember last opened item per section
  backTo: 'home', // where the Back button should return to
  currentTool: null, // { id, label } of the tool screen currently open (null on home/profile/settings)
  online: (typeof navigator !== 'undefined' && 'onLine' in navigator) ? navigator.onLine : true,
  settings: null, // cached persisted settings (set during init)
};

// ---------- offline mode ----------
// EFFECTIVE OFFLINE = no network connection OR the user's manual "offline mode".
// Only the app's internet-dependent entry points are gated; on-device tools keep working.
function isOffline() {
  const noNet = (typeof navigator !== 'undefined' && 'onLine' in navigator) ? !navigator.onLine : false;
  const manual = !!(state.settings && state.settings.offlineMode);
  return noNet || manual;
}
// Toggle the body.is-offline class so CSS can fade/disable net-only UI.
// Called on load, on window online/offline events, and on the manual toggle.
function applyOnlineState() {
  state.online = !isOffline();
  const offline = !state.online;
  document.body.classList.toggle('is-offline', offline);
  // Surface a "Requires internet" tooltip on net-only entry points while offline.
  document.querySelectorAll('[data-offline-title]').forEach((el) => {
    if (offline) el.setAttribute('title', el.dataset.offlineTitle);
    else el.removeAttribute('title');
  });
}

function uid() { return 'j' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function icon(name) { return (window.ICONS && window.ICONS[name]) || ''; }
function baseName(p) { return p.split(/[\\/]/).pop(); }
function fmtBytes(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? `${h}:` : '') + `${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}
function injectIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { if (el.dataset.iconDone) return; el.innerHTML = icon(el.dataset.icon); el.dataset.iconDone = '1'; });
}
function defaultSettingsFor(type) {
  return state.caps && state.caps.media[type] ? JSON.parse(JSON.stringify(state.caps.media[type].defaults)) : {};
}

// ---------- custom dropdown (replaces the native OS <select> popup) ----------
function customSelect(sel) {
  if (!sel || sel.dataset.cs) return; sel.dataset.cs = '1';
  const wrap = document.createElement('div'); wrap.className = 'cs';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn';
  const list = document.createElement('div'); list.className = 'cs-list hidden';
  const render = () => { const o = sel.options[sel.selectedIndex]; btn.innerHTML = `<span class="cs-cur">${o ? o.text : ''}</span><span class="cs-chev">${icon('chevron')}</span>`; };
  const close = () => { list.classList.add('hidden'); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const open = () => {
    list.innerHTML = '';
    [...sel.options].forEach((o, i) => {
      const it = document.createElement('div');
      it.className = 'cs-opt' + (i === sel.selectedIndex ? ' sel' : '') + (o.disabled ? ' dis' : '');
      it.textContent = o.text;
      it.addEventListener('click', () => { if (o.disabled) return; sel.selectedIndex = i; render(); sel.dispatchEvent(new Event('change', { bubbles: true })); close(); });
      list.appendChild(it);
    });
    list.classList.remove('hidden');
    document.addEventListener('mousedown', outside, true);
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); list.classList.contains('hidden') ? open() : close(); });
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(btn); wrap.appendChild(list); wrap.appendChild(sel);
  sel.style.display = 'none'; sel._csRender = render; render();
}
function enhanceSelects(root) { (root || document).querySelectorAll('select:not([data-cs])').forEach(customSelect); }
function setHero(title, sub) { $('heroTitle').textContent = title; $('heroSub').textContent = sub; }

const PANELS = ['homeView', 'convertMenu', 'compressMenu', 'toolsMenu', 'toolHeader', 'dropZone', 'colorPanel', 'ytPanel', 'spotifyPanel', 'unitPanel', 'timePanel', 'stretchPanel', 'fpsPanel', 'profilePanel', 'metaPanel', 'batchPanel', 'fxPanel', 'pbPanel', 'aiHubPanel', 'transcribePanel', 'upscalePanel', 'removebgPanel', 'ttsPanel'];
function hideAll() {
  PANELS.forEach((id) => { const el = $(id); if (el) el.classList.add('hidden'); });
  document.body.classList.remove('on-profile');
  cancelAnimationFrame(pixelRaf);
  // NOTE: do NOT pause #apAudio here — the About-page music persists across
  // navigation. The element stays in the DOM and keeps playing when you leave;
  // returning to About reflects the current play/pause state (see openProfile).
}

// ---------- spring helper (damped harmonic oscillator) ----------
// Mirrors framer-motion's spring "bounce" feel used by the bouncy-accordion.
function spring(from, to, opts, onUpdate, onDone) {
  const stiffness = opts.stiffness || 190;
  const damping = opts.damping || 17;
  let x = from, v = 0, last = 0, raf = 0;
  function step(t) {
    if (!last) last = t;
    let dt = Math.min((t - last) / 1000, 0.032); last = t;
    const a = -stiffness * (x - to) - damping * v;
    v += a * dt; x += v * dt;
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 0.4) { onUpdate(to); if (onDone) onDone(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// ---------- bouncy accordion (single-open, spring physics) ----------
function bouncyAccordion(container, categories, onItemClick) {
  container.innerHTML = '';
  const rows = [];
  let activeIdx = -1; // all categories collapsed by default

  categories.forEach((cat, idx) => {
    const sec = document.createElement('div');
    sec.className = 'acc-item';
    const head = document.createElement('button');
    head.className = 'acc-head';
    head.innerHTML = `<span class="acc-title"><span class="ic">${icon(cat.icon)}</span> ${cat.name}</span><span class="acc-chev">${icon('chevron')}</span>`;
    const body = document.createElement('div');
    body.className = 'acc-body';
    const inner = document.createElement('div');
    inner.className = 'acc-inner';
    cat.items.forEach((item) => {
      if (item.need && state.caps && !state.caps[item.need]) return;
      const btn = document.createElement('button');
      btn.className = 'menu-link' + (item.engine === 'disabled' ? ' disabled' : '');
      btn.textContent = item.label;
      if (item.engine === 'disabled') { btn.title = item.note || ''; btn.addEventListener('click', () => alert(`${item.label}\n\n${item.note || 'Not available.'}`)); }
      else btn.addEventListener('click', () => onItemClick(item));
      inner.appendChild(btn);
    });
    body.appendChild(inner);
    const chev = head.querySelector('.acc-chev');
    const row = { sec, head, body, inner, chev, cancelH: null, cancelC: null };
    rows.push(row);
    head.addEventListener('click', () => toggle(idx));
    sec.appendChild(head); sec.appendChild(body);
    container.appendChild(sec);
  });

  function setOpen(row, open, animate) {
    if (row.cancelH) row.cancelH();
    if (row.cancelC) row.cancelC();
    row.sec.classList.toggle('open', open);
    const target = open ? row.inner.offsetHeight : 0;
    const start = parseFloat(row.body.style.height) || (open ? 0 : row.inner.offsetHeight);
    const rot0 = open ? 0 : 180, rot1 = open ? 180 : 0;
    if (!animate) {
      row.body.style.height = open ? 'auto' : '0px';
      row.chev.style.transform = `rotate(${rot1}deg)`;
      return;
    }
    row.cancelH = spring(start, target, open ? { stiffness: 170, damping: 15 } : { stiffness: 210, damping: 19 },
      (h) => { row.body.style.height = Math.max(0, h) + 'px'; },
      () => { if (open) row.body.style.height = 'auto'; });
    row.cancelC = spring(rot0, rot1, { stiffness: 200, damping: 16 }, (r) => { row.chev.style.transform = `rotate(${r}deg)`; });
  }

  function toggle(idx) {
    if (idx === activeIdx) { setOpen(rows[idx], false, true); activeIdx = -1; return; }
    if (activeIdx >= 0 && rows[activeIdx]) setOpen(rows[activeIdx], false, true);
    activeIdx = idx;
    setOpen(rows[idx], true, true);
  }

  injectIcons(container);
  rows.forEach((r, i) => setOpen(r, i === activeIdx, false));
}

// ---------- section routing ----------
function showHome() {
  state.section = 'home'; state.ws = null; state.backTo = 'home';
  state.currentTool = null; updateFavBtn();
  hideAll();
  setHero('Media Toolbox', 'Your local media workshop');
  $('homeView').classList.remove('hidden');
}
function showSection(section) {
  state.section = section;
  state.ws = null;
  // The menu root: Back goes HOME.
  state.backTo = 'home';
  // A menu root is not a tool screen → no heart.
  state.currentTool = null; updateFavBtn();
  hideAll();
  const labels = { convert: 'Convert', compress: 'Compress', tools: 'Tools' };
  if (section === 'convert') { setHero('Convert', 'Pick a converter'); $('convertMenu').classList.remove('hidden'); bouncyAccordion($('convertMenu'), window.CONVERT_CATEGORIES, (it) => openItem(it, 'convert')); }
  else if (section === 'compress') { setHero('Compress', 'Pick a compressor'); $('compressMenu').classList.remove('hidden'); bouncyAccordion($('compressMenu'), window.COMPRESS_CATEGORIES, (it) => openItem(it, 'compress')); }
  else if (section === 'tools') { setHero('Tools', 'Pick a tool'); $('toolsMenu').classList.remove('hidden'); bouncyAccordion($('toolsMenu'), window.TOOL_CATEGORIES, (it) => openItem(it, 'tool')); }
  // Reveal the Back button on menu screens too.
  $('toolHeader').classList.remove('hidden');
  $('toolName').textContent = labels[section] || '';
}

function backToMenu() {
  if (state.backTo === 'home') showHome();
  else if (state.backTo === 'ai') openAiHub();
  else showSection(state.backTo);
}

// ---------- open an item ----------
function openItem(item, kind) {
  // Opened from a menu → Back returns to that menu (kind 'tool' maps to 'tools').
  state.backTo = kind === 'tool' ? 'tools' : (kind || 'home');
  state.currentTool = { id: item.id, label: item.label };
  updateFavBtn();
  if (item.engine === 'special') return openSpecial(item.id);
  if (item.engine === 'colorpicker') return openColorPicker();
  if (item.engine === 'stretch') return openStretch();
  if (item.engine === 'fpspreview') return openFpsPreview();
  if (item.engine === 'metaedit') return openMetaEditor();
  if (item.engine === 'batchrename') return openBatchRename();
  if (item.engine === 'photofx') return openPhotoEffects();
  if (item.engine === 'privacyblur') return openPrivacyBlur();
  if (item.engine === 'transcribe') return openTranscribe();
  if (item.engine === 'upscaleai') return openUpscaleAi();
  if (item.engine === 'removebg') return openRemoveBg();
  if (item.engine === 'tts') return openTts();
  if (item.engine === 'spotify') return openSpotify();
  hideAll();
  $('toolHeader').classList.remove('hidden');
  $('toolName').textContent = item.label;
  $('dropZone').classList.remove('hidden');

  const isConvert = kind === 'convert' || item.engine === 'op' || item.engine === 'pdfmerge';
  const lockFmt = item.engine === 'pdfmerge' ? true : (kind === 'compress' ? !!item.out : !item.pickOut);
  const base = defaultSettingsFor(item.mediaType);
  if (item.out) base.outputFormat = item.out;
  if (item.op && item.op !== 'gif' && item.op !== 'pdf2img') base.op = item.op;

  state.ws = {
    item, kind, mediaType: item.mediaType, list: new Map(),
    convert: isConvert, lockFmt, isOp: item.engine === 'op', isMerge: item.engine === 'pdfmerge',
    base,
  };

  setHero(item.label, item.engine === 'pdfmerge' ? 'Combine several PDFs into one' : '');
  $('ehSub').textContent = item.accept ? `accepts ${item.accept.slice(0, 5).join(', ').toUpperCase()}` : '';
  $('btnCompress').innerHTML = `${state.ws.isMerge ? 'Merge' : kind === 'compress' ? 'Compress Now!' : 'Convert Now!'} <span class="ic">${icon('arrowRight')}</span>`;

  renderToolOptions();
  renderList();
}

// ---------- Batch Rename ----------
// Self-contained tool: pick files, build new names from a base + sequential
// numbering and/or find→replace, preview, then rename on disk via IPC.
const batchState = { files: [], wired: false };
function openBatchRename() {
  hideAll(); state.section = 'tools'; state.ws = null;
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Batch Rename';
  setHero('Batch Rename', 'Bulk-rename files with numbering and find → replace');
  $('batchPanel').classList.remove('hidden');
  if (!batchState.wired) { wireBatchRename(); batchState.wired = true; }
  renderBatchPreview();
}
function batchNewName(path, idx) {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  const ext = dot > slash ? path.slice(dot) : '';
  let stem = dot > slash ? path.slice(slash + 1, dot) : path.slice(slash + 1);
  const find = $('brFind').value;
  if (find) stem = stem.split(find).join($('brReplace').value);
  const base = $('brBase').value.trim();
  if (base) {
    const start = Number($('brStart').value) || 1;
    const pad = Math.max(1, Number($('brPad').value) || 3);
    const num = String(start + idx).padStart(pad, '0');
    stem = `${base}_${num}`;
  }
  return stem + ext;
}
function renderBatchPreview() {
  const box = $('brList');
  if (!batchState.files.length) { box.innerHTML = '<div class="muted" style="padding:12px 0">No files chosen yet.</div>'; $('brRun').disabled = true; return; }
  $('brRun').disabled = false;
  box.innerHTML = batchState.files.map((p, i) => {
    const cur = baseName(p);
    const nn = batchNewName(p, i);
    return `<div class="br-row"><span class="br-old">${mtbEsc(cur)}</span><span class="br-arr">${icon('arrowRight')}</span><span class="br-new">${mtbEsc(nn)}</span></div>`;
  }).join('');
}
function wireBatchRename() {
  $('brLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    batchState.files = paths; renderBatchPreview();
  });
  $('brClear').addEventListener('click', () => { batchState.files = []; renderBatchPreview(); });
  ['brBase', 'brStart', 'brPad', 'brFind', 'brReplace'].forEach((id) => $(id).addEventListener('input', renderBatchPreview));
  $('brRun').addEventListener('click', async () => {
    if (!batchState.files.length) return;
    const renames = batchState.files.map((p, i) => ({ from: p, to: batchNewName(p, i) }));
    $('brStatus').textContent = 'Renaming…'; $('brStatus').className = 'fr-status';
    try {
      const res = await window.api.filesRename(renames);
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.filter((r) => !r.ok);
      $('brStatus').textContent = `Renamed ${ok}/${res.results.length}` + (failed.length ? ` · ${failed.length} skipped (${failed.map((f) => f.error).filter((v, i, a) => a.indexOf(v) === i).join(', ')})` : '');
      $('brStatus').className = failed.length ? 'fr-status error' : 'fr-status done';
      // Point file list at the new paths so a second rename pass chains naturally.
      batchState.files = res.results.map((r) => r.ok ? r.to : r.from);
      renderBatchPreview();
      toast(`Renamed ${ok} file${ok === 1 ? '' : 's'}`, ok ? {} : { kind: 'error' });
    } catch (e) { $('brStatus').textContent = 'Error: ' + (e.message || e); $('brStatus').className = 'fr-status error'; }
  });
}

// ---------- Photo Effects ----------
// Self-contained image effects lab ported from shaderlab.html: a stackable
// canvas pipeline (dither / ascii / halftone / glitch / crt / …) restyled to the
// app's look. Lazy-wired on first open like Batch Rename; exports PNG via <a download>.
const FX_PALETTE_PRESETS = [
  { name: 'mono', colors: ['#000000', '#ffffff'] },
  { name: 'game boy', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { name: 'pocket', colors: ['#2d2d2d', '#656555', '#a9a987', '#e8e8c0'] },
  { name: 'cga', colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  { name: 'paper', colors: ['#1a1a1a', '#8a8577', '#e8e4d8', '#f4f0e4'] },
  { name: 'cyan', colors: ['#001a2c', '#005577', '#00ccff', '#ffffff'] },
  { name: 'amber', colors: ['#1a0a00', '#663300', '#ffaa00', '#ffeecc'] },
  { name: 'acid', colors: ['#000000', '#00ff00', '#ffff00', '#ffffff'] },
  { name: 'sunset', colors: ['#2d0036', '#6e1423', '#e25822', '#f9a03f', '#ffeebc'] },
  { name: 'aqua', colors: ['#001219', '#005f73', '#0a9396', '#94d2bd', '#e9d8a6'] },
  { name: 'neon', colors: ['#14002c', '#7400b8', '#ff006e', '#ffbe0b'] },
];

const FX_ASCII_CHARSETS = {
  standard: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  dots: ' .·•○●',
  binary: ' 01',
  dense: " .'^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  minimal: ' .#',
};

// Each def: name (shown in stack), defaults, and params(p) → array of control descriptors.
// Control kinds: range {key,label,min,max,step}, select {key,label,opts:[[val,text]]},
// toggle {key,label}, seg {key,label,opts:[[val,text]]}.
const FX_EFFECT_DEFS = {
  dither: {
    name: 'dither',
    defaults: { algorithm: 'floyd', scale: 1, strength: 1.0 },
    params: () => [
      { kind: 'select', key: 'algorithm', label: 'Algorithm', opts: [['floyd', 'floyd-steinberg'], ['atkinson', 'atkinson'], ['bayer4', 'bayer 4×4'], ['bayer8', 'bayer 8×8'], ['bayer16', 'bayer 16×16'], ['random', 'random noise'], ['sierra', 'sierra lite'], ['jarvis', 'jarvis'], ['burkes', 'burkes'], ['stucki', 'stucki']] },
      { kind: 'range', key: 'scale', label: 'Pixel scale', min: 1, max: 10, step: 1, unit: '×' },
      { kind: 'range', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, pct: true },
    ],
  },
  ascii: {
    name: 'ascii',
    defaults: { density: 100, charset: 'standard', invertBright: false, colored: true, textMode: false, bold: true },
    params: () => [
      { kind: 'select', key: 'charset', label: 'Character set', opts: Object.keys(FX_ASCII_CHARSETS).map((k) => [k, k]) },
      { kind: 'range', key: 'density', label: 'Density (cols)', min: 30, max: 220, step: 1 },
      { kind: 'seg', key: 'textMode', label: 'Output', opts: [[false, 'canvas'], [true, 'text']] },
      { kind: 'toggle', key: 'colored', label: 'Use palette colors' },
      { kind: 'toggle', key: 'invertBright', label: 'Invert brightness' },
      { kind: 'toggle', key: 'bold', label: 'Bold characters' },
    ],
  },
  halftone: {
    name: 'halftone',
    defaults: { dotSize: 8, angle: 15, shape: 'circle', cmyk: false, spacing: 1.0, contrast: 1.0 },
    params: () => [
      { kind: 'range', key: 'dotSize', label: 'Dot cell size', min: 3, max: 30, step: 1, unit: 'px' },
      { kind: 'range', key: 'spacing', label: 'Dot spacing', min: 0.7, max: 2.5, step: 0.05, unit: '×' },
      { kind: 'range', key: 'angle', label: 'Rotation', min: 0, max: 90, step: 1, unit: '°' },
      { kind: 'range', key: 'contrast', label: 'Contrast', min: 0.2, max: 3, step: 0.05, unit: '×' },
      { kind: 'select', key: 'shape', label: 'Shape', opts: [['circle', 'circle'], ['square', 'square'], ['diamond', 'diamond'], ['line', 'line'], ['cross', 'cross'], ['hex', 'hexagon']] },
      { kind: 'toggle', key: 'cmyk', label: 'CMYK separation' },
    ],
  },
  posterize: {
    name: 'posterize',
    defaults: { levels: 3, usePalette: true },
    params: () => [
      { kind: 'range', key: 'levels', label: 'Levels', min: 2, max: 8, step: 1 },
      { kind: 'toggle', key: 'usePalette', label: 'Snap to palette' },
    ],
  },
  pixel: {
    name: 'pixelate',
    defaults: { size: 8, usePalette: false },
    params: () => [
      { kind: 'range', key: 'size', label: 'Pixel size', min: 2, max: 50, step: 1, unit: 'px' },
      { kind: 'toggle', key: 'usePalette', label: 'Snap to palette' },
    ],
  },
  threshold: {
    name: 'threshold',
    defaults: { level: 128, smooth: 0 },
    params: () => [
      { kind: 'range', key: 'level', label: 'Threshold', min: 0, max: 255, step: 1 },
      { kind: 'range', key: 'smooth', label: 'Softness', min: 0, max: 100, step: 1 },
    ],
  },
  rgbshift: {
    name: 'rgb shift',
    defaults: { amount: 8, angle: 0 },
    params: () => [
      { kind: 'range', key: 'amount', label: 'Amount', min: 0, max: 40, step: 1, unit: 'px' },
      { kind: 'range', key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
    ],
  },
  scanglitch: {
    name: 'scan glitch',
    defaults: { intensity: 30, frequency: 8, seed: 7 },
    params: () => [
      { kind: 'range', key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1 },
      { kind: 'range', key: 'frequency', label: 'Frequency', min: 1, max: 30, step: 1 },
      { kind: 'range', key: 'seed', label: 'Seed', min: 1, max: 99, step: 1 },
    ],
  },
  slice: {
    name: 'slice displace',
    defaults: { slices: 20, maxOffset: 30, seed: 7 },
    params: () => [
      { kind: 'range', key: 'slices', label: 'Slice count', min: 2, max: 80, step: 1 },
      { kind: 'range', key: 'maxOffset', label: 'Max offset', min: 0, max: 120, step: 1, unit: 'px' },
      { kind: 'range', key: 'seed', label: 'Seed', min: 1, max: 99, step: 1 },
    ],
  },
  grain: {
    name: 'film grain',
    defaults: { amount: 20, size: 1, mono: true },
    params: () => [
      { kind: 'range', key: 'amount', label: 'Amount', min: 0, max: 100, step: 1 },
      { kind: 'range', key: 'size', label: 'Size', min: 1, max: 5, step: 1, unit: 'px' },
      { kind: 'toggle', key: 'mono', label: 'Monochrome' },
    ],
  },
  crt: {
    name: 'crt',
    defaults: { scanlines: 4, stripes: true, vignette: 0.4 },
    params: () => [
      { kind: 'range', key: 'scanlines', label: 'Scanline spacing', min: 2, max: 12, step: 1, unit: 'px' },
      { kind: 'range', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, pct: true },
      { kind: 'toggle', key: 'stripes', label: 'RGB subpixels' },
    ],
  },
  vignette: {
    name: 'vignette',
    defaults: { amount: 0.6, softness: 0.5 },
    params: () => [
      { kind: 'range', key: 'amount', label: 'Darkness', min: 0, max: 1, step: 0.01, pct: true },
      { kind: 'range', key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, pct: true },
    ],
  },
  chromatic: {
    name: 'chromatic',
    defaults: { amount: 5, radial: true },
    params: () => [
      { kind: 'range', key: 'amount', label: 'Amount', min: 0, max: 30, step: 1, unit: 'px' },
      { kind: 'toggle', key: 'radial', label: 'Radial (from center)' },
    ],
  },
  glow: {
    name: 'bloom / glow',
    defaults: { threshold: 180, amount: 0.6, radius: 10 },
    params: () => [
      { kind: 'range', key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1 },
      { kind: 'range', key: 'radius', label: 'Radius', min: 1, max: 40, step: 1, unit: 'px' },
      { kind: 'range', key: 'amount', label: 'Strength', min: 0, max: 2, step: 0.01, pct: true },
    ],
  },
  blur: {
    name: 'blur',
    defaults: { radius: 4 },
    params: () => [{ kind: 'range', key: 'radius', label: 'Radius', min: 0, max: 30, step: 1, unit: 'px' }],
  },
  edge: {
    name: 'edge detect',
    defaults: { strength: 1.0, invert: false },
    params: () => [
      { kind: 'range', key: 'strength', label: 'Strength', min: 0.1, max: 3, step: 0.05 },
      { kind: 'toggle', key: 'invert', label: 'Invert (dark edges)' },
    ],
  },
  emboss: {
    name: 'emboss',
    defaults: { strength: 1.0 },
    params: () => [{ kind: 'range', key: 'strength', label: 'Strength', min: 0.1, max: 3, step: 0.05 }],
  },
};

const FX_PRESET_STACKS = [
  { name: 'mac classic', stack: [{ type: 'dither', params: { algorithm: 'atkinson', scale: 2, strength: 1 } }] },
  { name: 'newspaper', stack: [{ type: 'halftone', params: { dotSize: 6, angle: 15, shape: 'circle', spacing: 1, contrast: 1.2 } }] },
  { name: 'gameboy', stack: [{ type: 'pixel', params: { size: 4, usePalette: true } }, { type: 'dither', params: { algorithm: 'bayer4', scale: 1, strength: 1 } }], palette: 'game boy' },
  { name: 'vhs horror', stack: [{ type: 'chromatic', params: { amount: 4, radial: true } }, { type: 'scanglitch', params: { intensity: 25, frequency: 10 } }, { type: 'crt', params: { scanlines: 3, stripes: true, vignette: 0.5 } }] },
  { name: 'print zine', stack: [{ type: 'threshold', params: { level: 128, smooth: 10 } }, { type: 'halftone', params: { dotSize: 5, angle: 45, shape: 'circle', spacing: 1, contrast: 1.4 } }, { type: 'grain', params: { amount: 14, size: 1, mono: true } }], palette: 'paper' },
  { name: 'ascii art', stack: [{ type: 'ascii', params: { density: 120, charset: 'dense', colored: true, bold: true } }] },
  { name: 'glitched', stack: [{ type: 'rgbshift', params: { amount: 6, angle: 45 } }, { type: 'slice', params: { slices: 15, maxOffset: 20 } }] },
  { name: 'oil painting', stack: [{ type: 'posterize', params: { levels: 5, usePalette: false } }, { type: 'edge', params: { strength: 0.5, invert: true } }, { type: 'blur', params: { radius: 2 } }] },
  { name: 'riso print', stack: [{ type: 'posterize', params: { levels: 3, usePalette: true } }, { type: 'dither', params: { algorithm: 'bayer8', scale: 2, strength: 0.8 } }, { type: 'grain', params: { amount: 10, size: 1, mono: false } }], palette: 'neon' },
  { name: 'dream soft', stack: [{ type: 'glow', params: { threshold: 150, amount: 0.8, radius: 15 } }, { type: 'chromatic', params: { amount: 3, radial: true } }, { type: 'vignette', params: { amount: 0.4, softness: 0.7 } }] },
];

// Hand-authored eye-open / eye-closed icons for the per-effect enable toggle.
const FX_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const FX_EYE_CLOSED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7c1.6 0 3 .3 4.3.9"/><path d="M22 12s-1.2 2.4-3.6 4.4"/><path d="M9.5 9.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

const fxState = {
  wired: false,
  source: null,            // HTMLImageElement
  effects: [],
  selectedId: null,
  nextId: 1,
  palette: ['#1a1a1a', '#888888', '#f4f0e4'],
  brightness: 0, contrast: 0, saturation: 0, invert: false, grayscale: false,
  lastAsciiText: '',
  isAsciiText: false,
};
let fxCanvas = null, fxCtx = null, fxWork = null, fxWorkCtx = null;

function fxHexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function fxActivePalette() { return fxState.palette.map(fxHexToRgb); }
function fxClosest(r, g, b, pal) {
  let best = pal[0], bd = Infinity;
  for (const c of pal) { const dr = r - c[0], dg = g - c[1], db = b - c[2]; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = c; } }
  return best;
}

function openPhotoEffects() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'photo-effects', label: 'Photo Effects' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Photo Effects';
  setHero('Photo Effects', 'Stackable image effects — dither, ascii, halftone, glitch & more');
  $('fxPanel').classList.remove('hidden');
  if (!fxState.wired) { wirePhotoEffects(); fxState.wired = true; }
  fxRenderStack(); fxRenderParams();
  // Load the demo scene by default so effects are visible immediately.
  if (!fxState.source) fxLoadDemo();
}

function wirePhotoEffects() {
  fxCanvas = $('fxCanvas'); fxCtx = fxCanvas.getContext('2d', { willReadFrequently: true });
  fxWork = document.createElement('canvas'); fxWorkCtx = fxWork.getContext('2d', { willReadFrequently: true });

  enhanceSelects($('fxPanel'));
  fxBuildSwatches();
  fxBuildPalSize();
  fxBuildPalPresets();
  fxBuildPresetMenu();

  $('fxLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    fxLoadImagePath(paths[0]);
  });
  $('fxLoadVid').addEventListener('click', fxLoadVideoFrame);
  $('fxWebcam').addEventListener('click', fxUseWebcam);
  $('fxDemo').addEventListener('click', () => fxLoadDemo());
  $('fxClear').addEventListener('click', () => { fxState.effects = []; fxState.selectedId = null; fxRenderStack(); fxRenderParams(); fxRender(); });

  $('fxAddBtn').addEventListener('click', () => {
    const sel = $('fxAdd'); const type = sel.value; if (!type) return;
    const def = FX_EFFECT_DEFS[type];
    const fx = { id: fxState.nextId++, type, enabled: true, params: JSON.parse(JSON.stringify(def.defaults)) };
    fxState.effects.push(fx); fxState.selectedId = fx.id;
    sel.value = ''; if (sel._csRender) sel._csRender();
    fxRenderStack(); fxRenderParams(); fxRender();
  });

  // presets ▾ dropdown menu
  $('fxPresetBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('fxPresetMenu').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    const m = $('fxPresetMenu');
    if (m && !m.classList.contains('hidden') && !e.target.closest('.fx-presets-wrap')) m.classList.add('hidden');
  });

  ['brightness', 'contrast', 'saturation'].forEach((k) => {
    const id = 'fx' + k.charAt(0).toUpperCase() + k.slice(1);
    $(id).addEventListener('input', (e) => { fxState[k] = parseInt(e.target.value, 10); $(id + 'Val').textContent = fxState[k]; fxRenderDebounced(); });
    $(id).addEventListener('change', () => fxRenderFlush());
  });
  $('fxInvert').addEventListener('change', (e) => { fxState.invert = e.target.checked; fxRender(); });
  $('fxGrayscale').addEventListener('change', (e) => { fxState.grayscale = e.target.checked; fxRender(); });

  $('fxCopyAscii').addEventListener('click', () => {
    navigator.clipboard.writeText(fxState.lastAsciiText || '');
    $('fxStatus').textContent = 'ASCII copied';
  });
  $('fxSave').addEventListener('click', fxSave);
}

function fxLoadImagePath(path) {
  const img = new Image();
  img.onload = () => {
    fxState.source = img;
    $('fxName').textContent = baseName(path);
    $('fxHint').classList.add('hidden');
    $('fxSave').disabled = false;
    fxRender();
  };
  img.src = 'file:///' + String(path).replace(/\\/g, '/');
}

function fxLoadDemo() {
  const c = document.createElement('canvas'); c.width = 640; c.height = 480;
  const d = c.getContext('2d');
  const grad = d.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, '#1a3a5c'); grad.addColorStop(0.5, '#d4846b'); grad.addColorStop(1, '#f4c869');
  d.fillStyle = grad; d.fillRect(0, 0, 640, 480);
  const sun = d.createRadialGradient(480, 180, 10, 480, 180, 100);
  sun.addColorStop(0, '#ffeecc'); sun.addColorStop(1, 'rgba(255,220,150,0)');
  d.fillStyle = sun; d.fillRect(0, 0, 640, 480);
  d.fillStyle = '#2a2a4a'; d.beginPath(); d.moveTo(0, 320);
  for (let x = 0; x <= 640; x += 20) d.lineTo(x, 320 + Math.sin(x * 0.03) * 40 + Math.sin(x * 0.1) * 15);
  d.lineTo(640, 480); d.lineTo(0, 480); d.closePath(); d.fill();
  d.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) { d.beginPath(); d.arc(Math.random() * 640, Math.random() * 200, Math.random() * 1.5 + 0.5, 0, Math.PI * 2); d.fill(); }
  const img = new Image();
  img.onload = () => { fxState.source = img; $('fxName').textContent = 'demo image'; $('fxHint').classList.add('hidden'); $('fxSave').disabled = false; fxRender(); };
  img.src = c.toDataURL();
}

function fxApplyPreset(preset) {
  fxState.effects = preset.stack.map((s) => ({ id: fxState.nextId++, type: s.type, enabled: true, params: { ...FX_EFFECT_DEFS[s.type].defaults, ...s.params } }));
  fxState.selectedId = fxState.effects[0] ? fxState.effects[0].id : null;
  if (preset.palette) { const pp = FX_PALETTE_PRESETS.find((p) => p.name === preset.palette); if (pp) { fxState.palette = [...pp.colors]; fxBuildSwatches(); fxBuildPalSize(); fxBuildPalPresets(); } }
  fxRenderStack(); fxRenderParams(); fxRender();
}

function fxBuildPresetMenu() {
  const menu = $('fxPresetMenu'); if (!menu) return;
  menu.innerHTML = '';
  FX_PRESET_STACKS.forEach((p) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fx-preset-opt'; b.textContent = p.name;
    b.addEventListener('click', () => { fxApplyPreset(p); menu.classList.add('hidden'); });
    menu.appendChild(b);
  });
}

function fxBuildSwatches() {
  const wrap = $('fxSwatches'); if (!wrap) return; wrap.innerHTML = '';
  fxState.palette.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fx-swatch';
    btn.style.background = color; btn.title = color;
    btn.setAttribute('aria-label', 'palette color ' + (i + 1));
    btn.addEventListener('click', (e) => { e.stopPropagation(); fxOpenColorPicker(btn, i); });
    wrap.appendChild(btn);
  });
}

// ----- custom in-app color picker (no OS dialog) -----
const fxCP = { el: null, idx: -1, swatch: null, h: 0, s: 0, v: 0, onDoc: null };

function fxClampN(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
function fxRgbToHex(r, g, b) {
  const h = (n) => fxClampN(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function fxRgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = max ? d / max : 0;
  return [h, s, max];
}
function fxHsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function fxCpCurrentHex() {
  const [r, g, b] = fxHsvToRgb(fxCP.h, fxCP.s, fxCP.v);
  return fxRgbToHex(r, g, b);
}
function fxCpSyncUi() {
  const hex = fxCpCurrentHex();
  const [hr, hg, hb] = fxHsvToRgb(fxCP.h, 1, 1);
  fxCP.el.querySelector('.fx-cp-sv').style.background =
    `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${hr},${hg},${hb}))`;
  const cur = fxCP.el.querySelector('.fx-cp-cursor');
  cur.style.left = (fxCP.s * 100) + '%';
  cur.style.top = ((1 - fxCP.v) * 100) + '%';
  fxCP.el.querySelector('.fx-cp-hue').value = Math.round(fxCP.h);
  fxCP.el.querySelector('.fx-cp-preview').style.background = hex;
  const hexInp = fxCP.el.querySelector('.fx-cp-hex');
  if (document.activeElement !== hexInp) hexInp.value = hex;
}
function fxCpCommit() {
  const hex = fxCpCurrentHex();
  fxState.palette[fxCP.idx] = hex;
  if (fxCP.swatch) { fxCP.swatch.style.background = hex; fxCP.swatch.title = hex; }
  fxRenderDebounced();
}
function fxCloseColorPicker() {
  if (!fxCP.el) return;
  if (fxCP.onDoc) document.removeEventListener('mousedown', fxCP.onDoc, true);
  fxCP.el.remove();
  fxCP.el = null; fxCP.idx = -1; fxCP.swatch = null; fxCP.onDoc = null;
  fxRenderFlush();
}
function fxOpenColorPicker(swatch, idx) {
  fxCloseColorPicker();
  fxCP.idx = idx; fxCP.swatch = swatch;
  const [r, g, b] = fxHexToRgb(fxState.palette[idx] || '#888888');
  [fxCP.h, fxCP.s, fxCP.v] = fxRgbToHsv(r, g, b);

  const pop = document.createElement('div');
  pop.className = 'fx-cp';
  pop.innerHTML =
    '<div class="fx-cp-sv"><div class="fx-cp-cursor"></div></div>' +
    '<div class="fx-cp-row">' +
      '<div class="fx-cp-preview"></div>' +
      '<input type="range" class="perf-range fx-cp-hue" min="0" max="360" step="1" />' +
    '</div>' +
    '<div class="fx-cp-row">' +
      '<input type="text" class="fx-cp-hex" maxlength="7" spellcheck="false" />' +
      '<button type="button" class="fx-cp-done">done</button>' +
    '</div>';
  pop.addEventListener('mousedown', (e) => e.stopPropagation());
  pop.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(pop);
  fxCP.el = pop;

  const rect = swatch.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = rect.left, top = rect.bottom + 6;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  pop.style.visibility = '';

  const sv = pop.querySelector('.fx-cp-sv');
  const svPick = (ev) => {
    const r2 = sv.getBoundingClientRect();
    fxCP.s = fxClampN((ev.clientX - r2.left) / r2.width, 0, 1);
    fxCP.v = fxClampN(1 - (ev.clientY - r2.top) / r2.height, 0, 1);
    fxCpSyncUi(); fxCpCommit();
  };
  sv.addEventListener('mousedown', (ev) => {
    svPick(ev);
    const move = (e2) => svPick(e2);
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });

  pop.querySelector('.fx-cp-hue').addEventListener('input', (e) => {
    fxCP.h = parseInt(e.target.value, 10); fxCpSyncUi(); fxCpCommit();
  });

  const hexInp = pop.querySelector('.fx-cp-hex');
  hexInp.addEventListener('input', () => {
    let v = hexInp.value.trim(); if (v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      const [hr, hg, hb] = fxHexToRgb(v);
      [fxCP.h, fxCP.s, fxCP.v] = fxRgbToHsv(hr, hg, hb);
      fxCpSyncUi(); fxCpCommit();
    }
  });
  hexInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fxCloseColorPicker(); });

  pop.querySelector('.fx-cp-done').addEventListener('click', fxCloseColorPicker);

  fxCP.onDoc = (e) => { if (fxCP.el && !fxCP.el.contains(e.target)) fxCloseColorPicker(); };
  document.addEventListener('mousedown', fxCP.onDoc, true);

  fxCpSyncUi();
}

function fxBuildPalSize() {
  const ctl = $('fxPalSize'); if (!ctl) return; ctl.innerHTML = '';
  [2, 3, 4, 5, 6].forEach((n) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = n === 2 ? '1-bit' : String(n);
    b.className = 'fx-seg-btn' + (fxState.palette.length === n ? ' on' : '');
    b.addEventListener('click', () => {
      const cur = fxState.palette.slice();
      const next = [];
      for (let i = 0; i < n; i++) next.push(cur[i] || '#888888');
      fxState.palette = next; fxBuildSwatches(); fxBuildPalSize(); fxRender();
    });
    ctl.appendChild(b);
  });
}

function fxBuildPalPresets() {
  const grid = $('fxPalPresets'); if (!grid) return; grid.innerHTML = '';
  FX_PALETTE_PRESETS.forEach((p) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fx-pal-preset'; b.title = p.name;
    b.innerHTML = p.colors.map((c) => `<i style="background:${mtbEsc(c)}"></i>`).join('') + `<u>${mtbEsc(p.name)}</u>`;
    b.addEventListener('click', () => {
      fxState.palette = [...p.colors];
      fxBuildSwatches(); fxBuildPalSize(); fxRender();
    });
    grid.appendChild(b);
  });
}

function fxLoadVideoFrame() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/*';
  inp.onchange = () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video'); vid.muted = true; vid.src = url;
    vid.onloadeddata = () => {
      vid.currentTime = Math.min(0.1, vid.duration || 0.1);
      vid.onseeked = () => {
        const c = document.createElement('canvas'); c.width = vid.videoWidth; c.height = vid.videoHeight;
        c.getContext('2d').drawImage(vid, 0, 0);
        const img = new Image();
        img.onload = () => { fxState.source = img; $('fxName').textContent = file.name; $('fxHint').classList.add('hidden'); $('fxSave').disabled = false; fxRender(); URL.revokeObjectURL(url); };
        img.src = c.toDataURL();
      };
    };
  };
  inp.click();
}

async function fxUseWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const vid = document.createElement('video'); vid.muted = true; vid.srcObject = stream;
    await vid.play();
    await new Promise((r) => setTimeout(r, 350));
    const c = document.createElement('canvas'); c.width = vid.videoWidth || 640; c.height = vid.videoHeight || 480;
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    stream.getTracks().forEach((t) => t.stop());
    const img = new Image();
    img.onload = () => { fxState.source = img; $('fxName').textContent = 'webcam frame'; $('fxHint').classList.add('hidden'); $('fxSave').disabled = false; fxRender(); };
    img.src = c.toDataURL();
  } catch (err) {
    $('fxStatus').textContent = 'webcam unavailable';
  }
}

function fxRenderStack() {
  const wrap = $('fxStack'); wrap.innerHTML = '';
  if (!fxState.effects.length) { wrap.innerHTML = '<p class="hint">No effects — add one below.</p>'; return; }
  fxState.effects.forEach((fx, idx) => {
    const def = FX_EFFECT_DEFS[fx.type]; if (!def) return;
    const item = document.createElement('div');
    item.className = 'fx-stack-item' + (fx.id === fxState.selectedId ? ' selected' : '') + (fx.enabled ? '' : ' disabled');
    item.innerHTML = `<button class="fx-eye" data-act="toggle" title="${fx.enabled ? 'disable' : 'enable'}">${fx.enabled ? FX_EYE_OPEN : FX_EYE_CLOSED}</button>
      <span class="fx-stack-name">${mtbEsc(def.name)}</span>
      <span class="fx-stack-actions">
        <button data-act="up" title="move up">▲</button>
        <button data-act="down" title="move down">▼</button>
        <button data-act="remove" title="remove">✕</button>
      </span>`;
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      fxState.selectedId = fx.id; fxRenderStack(); fxRenderParams();
    });
    item.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation(); const a = btn.dataset.act;
      if (a === 'toggle') fx.enabled = !fx.enabled;
      else if (a === 'up' && idx > 0) { const t = fxState.effects[idx - 1]; fxState.effects[idx - 1] = fxState.effects[idx]; fxState.effects[idx] = t; }
      else if (a === 'down' && idx < fxState.effects.length - 1) { const t = fxState.effects[idx + 1]; fxState.effects[idx + 1] = fxState.effects[idx]; fxState.effects[idx] = t; }
      else if (a === 'remove') { fxState.effects.splice(idx, 1); if (fxState.selectedId === fx.id) fxState.selectedId = null; }
      fxRenderStack(); fxRenderParams(); fxRender();
    }));
    wrap.appendChild(item);
  });
}

function fxRenderParams() {
  const wrap = $('fxParams');
  const title = $('fxParamsTitle');
  const fx = fxState.effects.find((f) => f.id === fxState.selectedId);
  if (!fx) { if (title) title.textContent = 'params'; wrap.innerHTML = '<p class="hint">Select an effect to edit its parameters.</p>'; return; }
  const def = FX_EFFECT_DEFS[fx.type];
  if (title) title.textContent = 'params / ' + def.name;
  const ctrls = def.params(fx.params);
  wrap.innerHTML = ctrls.map((c) => fxControlHtml(c, fx.params[c.key])).join('');
  enhanceSelects(wrap);
  fxAttachParamListeners(wrap, fx);
}

function fxFmtVal(c, v) {
  if (c.pct) return Math.round(v * 100) + '%';
  if (c.unit) return v + c.unit;
  return String(v);
}
function fxControlHtml(c, v) {
  if (c.kind === 'range') {
    return `<label class="fx-field"><span>${mtbEsc(c.label)} <b data-valfor="${c.key}">${fxFmtVal(c, v)}</b></span>
      <input type="range" class="perf-range" data-param="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}" /></label>`;
  }
  if (c.kind === 'select') {
    return `<label class="fx-field"><span>${mtbEsc(c.label)}</span><select data-param="${c.key}">${c.opts.map(([val, txt]) => `<option value="${mtbEsc(String(val))}" ${String(val) === String(v) ? 'selected' : ''}>${mtbEsc(txt)}</option>`).join('')}</select></label>`;
  }
  if (c.kind === 'seg') {
    return `<div class="fx-field"><span>${mtbEsc(c.label)}</span><div class="fx-seg" data-segparam="${c.key}">${c.opts.map(([val, txt]) => `<button type="button" class="fx-seg-btn ${String(val) === String(v) ? 'on' : ''}" data-val="${mtbEsc(String(val))}">${mtbEsc(txt)}</button>`).join('')}</div></div>`;
  }
  if (c.kind === 'toggle') {
    return `<label class="check-inline"><input type="checkbox" data-param="${c.key}" ${v ? 'checked' : ''} /> <span class="hint">${mtbEsc(c.label)}</span></label>`;
  }
  return '';
}
function fxAttachParamListeners(wrap, fx) {
  wrap.querySelectorAll('[data-param]').forEach((el) => {
    const key = el.dataset.param;
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => { fx.params[key] = el.checked; fxRender(); });
    } else if (el.type === 'range') {
      el.addEventListener('input', () => {
        const step = parseFloat(el.step);
        fx.params[key] = step < 1 ? parseFloat(el.value) : parseInt(el.value, 10);
        const def = FX_EFFECT_DEFS[fx.type].params(fx.params).find((c) => c.key === key);
        const b = wrap.querySelector(`[data-valfor="${key}"]`); if (b && def) b.textContent = fxFmtVal(def, fx.params[key]);
        fxRenderDebounced(); // label is live above; defer the heavy canvas render
      });
      el.addEventListener('change', () => fxRenderFlush()); // ensure final value renders on release
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => { fx.params[key] = el.value; fxRender(); });
    }
  });
  wrap.querySelectorAll('[data-segparam]').forEach((seg) => {
    const key = seg.dataset.segparam;
    seg.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      let val = btn.dataset.val; if (val === 'true') val = true; else if (val === 'false') val = false;
      fx.params[key] = val;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      fxRender();
    }));
  });
}

// Debounced canvas re-render: heavy work only fires after the slider has
// stayed put for ~300ms. Labels update live (cheap) in the callers; only the
// canvas render is deferred. A trailing call always fires the final value.
let fxRenderTimer = null;
function fxRenderDebounced() {
  if (fxRenderTimer) clearTimeout(fxRenderTimer);
  fxRenderTimer = setTimeout(() => { fxRenderTimer = null; fxRender(); }, 300);
}
function fxRenderFlush() {
  if (fxRenderTimer) { clearTimeout(fxRenderTimer); fxRenderTimer = null; }
  fxRender();
}

// ----- pipeline -----
function fxRender() {
  if (!fxState.source) return;
  const src = fxState.source;
  const w = src.naturalWidth, h = src.naturalHeight;
  if (!w || !h) return;
  const MAX = 900; let outW = w, outH = h;
  if (outW > MAX || outH > MAX) { const sc = MAX / Math.max(outW, outH); outW = Math.round(outW * sc); outH = Math.round(outH * sc); }
  fxCanvas.width = outW; fxCanvas.height = outH;
  fxCtx.drawImage(src, 0, 0, outW, outH);

  if (fxState.brightness || fxState.contrast || fxState.saturation || fxState.invert || fxState.grayscale) fxAdjust();

  let asciiText = false;
  for (const fx of fxState.effects) {
    if (!fx.enabled) continue;
    fxApply(fx);
    asciiText = fx.type === 'ascii' && fx.params.textMode;
  }
  fxState.isAsciiText = asciiText;
  if (asciiText) { $('fxCanvas').classList.add('hidden'); $('fxAscii').classList.remove('hidden'); }
  else { $('fxAscii').classList.add('hidden'); $('fxCanvas').classList.remove('hidden'); }
  $('fxCopyAscii').classList.toggle('hidden', !asciiText);
  $('fxStatus').textContent = `${outW}×${outH} · ${fxState.effects.filter((f) => f.enabled).length} fx`;
}

function fxApply(fx) {
  switch (fx.type) {
    case 'dither': return fxDither(fx.params);
    case 'ascii': return fxAscii(fx.params);
    case 'halftone': return fxHalftone(fx.params);
    case 'posterize': return fxPosterize(fx.params);
    case 'pixel': return fxPixelate(fx.params);
    case 'threshold': return fxThreshold(fx.params);
    case 'rgbshift': return fxRGBShift(fx.params);
    case 'scanglitch': return fxScanGlitch(fx.params);
    case 'slice': return fxSlice(fx.params);
    case 'grain': return fxGrain(fx.params);
    case 'crt': return fxCRT(fx.params);
    case 'vignette': return fxVignette(fx.params);
    case 'chromatic': return fxChromatic(fx.params);
    case 'glow': return fxGlow(fx.params);
    case 'blur': return fxBlur(fx.params);
    case 'edge': return fxEdge(fx.params);
    case 'emboss': return fxEmboss(fx.params);
  }
}

function fxAdjust() {
  const img = fxCtx.getImageData(0, 0, fxCanvas.width, fxCanvas.height); const d = img.data;
  const b = fxState.brightness * 2.55, c = (fxState.contrast + 100) / 100, s = (fxState.saturation + 100) / 100;
  const inv = fxState.invert, gray = fxState.grayscale;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    if (gray) { const l = r * 0.299 + g * 0.587 + bl * 0.114; r = g = bl = l; }
    if (s !== 1) { const l = r * 0.299 + g * 0.587 + bl * 0.114; r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s; }
    r = (r - 128) * c + 128 + b; g = (g - 128) * c + 128 + b; bl = (bl - 128) * c + 128 + b;
    if (inv) { r = 255 - r; g = 255 - g; bl = 255 - bl; }
    d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, bl));
  }
  fxCtx.putImageData(img, 0, 0);
}

const FX_BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const FX_BAYER_8 = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
const FX_BAYER_16 = (() => { const m = []; for (let y = 0; y < 16; y++) { m.push([]); for (let x = 0; x < 16; x++) { const q = ((x & 8) >> 3) | ((y & 8) >> 2); m[y].push(FX_BAYER_8[y % 8][x % 8] * 4 + q); } } return m; })();

function fxDither(p) {
  const pal = fxActivePalette();
  if (p.scale > 1) {
    const sw = Math.max(1, Math.floor(fxCanvas.width / p.scale)), sh = Math.max(1, Math.floor(fxCanvas.height / p.scale));
    fxWork.width = sw; fxWork.height = sh; fxWorkCtx.imageSmoothingEnabled = false; fxWorkCtx.drawImage(fxCanvas, 0, 0, sw, sh);
    fxWorkCtx.putImageData(fxDitherOp(fxWorkCtx.getImageData(0, 0, sw, sh), pal, p.algorithm, p.strength), 0, 0);
    fxCtx.imageSmoothingEnabled = false; fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); fxCtx.drawImage(fxWork, 0, 0, fxCanvas.width, fxCanvas.height);
  } else {
    const img = fxCtx.getImageData(0, 0, fxCanvas.width, fxCanvas.height);
    fxCtx.putImageData(fxDitherOp(img, pal, p.algorithm, p.strength), 0, 0);
  }
}
function fxDitherOp(img, pal, algo, strength) {
  const w = img.width, h = img.height; const d = new Float32Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) d[i] = img.data[i];
  const diffuse = (matrix, div) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; const oR = d[i], oG = d[i + 1], oB = d[i + 2];
      const [nR, nG, nB] = fxClosest(oR, oG, oB, pal); d[i] = nR; d[i + 1] = nG; d[i + 2] = nB;
      const eR = (oR - nR) * strength, eG = (oG - nG) * strength, eB = (oB - nB) * strength;
      for (const [dx, dy, f] of matrix) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const ni = (ny * w + nx) * 4; const fr = f / div; d[ni] += eR * fr; d[ni + 1] += eG * fr; d[ni + 2] += eB * fr; }
    }
  };
  const M = {
    floyd: [[[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]], 16],
    atkinson: [[[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]], 8],
    sierra: [[[1, 0, 2], [-1, 1, 1], [0, 1, 1]], 4],
    burkes: [[[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]], 32],
    stucki: [[[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]], 42],
    jarvis: [[[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]], 48],
  };
  if (M[algo]) diffuse(M[algo][0], M[algo][1]);
  else if (algo === 'bayer4' || algo === 'bayer8' || algo === 'bayer16') {
    const matrix = algo === 'bayer4' ? FX_BAYER_4 : (algo === 'bayer8' ? FX_BAYER_8 : FX_BAYER_16);
    const size = matrix.length, div = size * size;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const thr = (matrix[y % size][x % size] / div - 0.5) * 64 * strength; const [nR, nG, nB] = fxClosest(d[i] + thr, d[i + 1] + thr, d[i + 2] + thr, pal); d[i] = nR; d[i + 1] = nG; d[i + 2] = nB; }
  } else if (algo === 'random') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const n = (Math.random() - 0.5) * 64 * strength; const [nR, nG, nB] = fxClosest(d[i] + n, d[i + 1] + n, d[i + 2] + n, pal); d[i] = nR; d[i + 1] = nG; d[i + 2] = nB; }
  }
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.max(0, Math.min(255, d[i]));
  return img;
}

function fxAscii(p) {
  const chars = FX_ASCII_CHARSETS[p.charset]; const aspect = 0.5;
  const w = fxCanvas.width, h = fxCanvas.height; const cols = p.density;
  const rows = Math.max(1, Math.floor((h / w) * cols / aspect));
  fxWork.width = cols; fxWork.height = rows; fxWorkCtx.imageSmoothingEnabled = true; fxWorkCtx.drawImage(fxCanvas, 0, 0, cols, rows);
  const s = fxWorkCtx.getImageData(0, 0, cols, rows).data; const pal = fxActivePalette();
  const inv = p.invertBright;
  if (p.textMode) {
    let out = '';
    for (let y = 0; y < rows; y++) { for (let x = 0; x < cols; x++) { const i = (y * cols + x) * 4; const lum = (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) / 255; const br = inv ? 1 - lum : lum; out += chars[Math.max(0, Math.min(chars.length - 1, Math.floor(br * (chars.length - 1))))]; } out += '\n'; }
    fxState.lastAsciiText = out;
    const a = $('fxAscii'); a.textContent = out;
    a.style.fontSize = Math.max(4, Math.min(12, 1000 / cols)) + 'px';
    a.style.fontWeight = p.bold ? '700' : '400';
    a.style.color = `rgb(${pal[0].join(',')})`; a.style.background = `rgb(${pal[pal.length - 1].join(',')})`;
  } else {
    const cellW = w / cols, cellH = h / rows; const bg = pal[pal.length - 1];
    fxCtx.fillStyle = `rgb(${bg.join(',')})`; fxCtx.fillRect(0, 0, w, h);
    const fs = Math.floor(Math.max(cellW, cellH) * 1.3);
    fxCtx.font = `${p.bold ? 'bold ' : ''}${fs}px "Space Mono", monospace`; fxCtx.textBaseline = 'middle'; fxCtx.textAlign = 'center';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4; const r = s[i], g = s[i + 1], b = s[i + 2];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255; const br = inv ? 1 - lum : lum;
      const ch = chars[Math.max(0, Math.min(chars.length - 1, Math.floor(br * (chars.length - 1))))]; if (ch === ' ') continue;
      if (p.colored) { const [cr, cg, cb] = fxClosest(r, g, b, pal); fxCtx.fillStyle = `rgb(${cr},${cg},${cb})`; } else fxCtx.fillStyle = `rgb(${pal[0].join(',')})`;
      fxCtx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2);
    }
  }
}

function fxHalftone(p) {
  const step = p.dotSize * p.spacing; const angle = p.angle * Math.PI / 180; const pal = fxActivePalette();
  const w = fxCanvas.width, h = fxCanvas.height;
  fxWork.width = w; fxWork.height = h; fxWorkCtx.drawImage(fxCanvas, 0, 0);
  const samples = fxWorkCtx.getImageData(0, 0, w, h).data;
  if (p.cmyk) {
    const angles = { c: 15, m: 75, y: 0, k: 45 }; const colors = { c: [0, 200, 220], m: [220, 0, 160], y: [240, 220, 0], k: [20, 20, 20] };
    fxCtx.fillStyle = 'rgb(250,248,240)'; fxCtx.fillRect(0, 0, w, h); fxCtx.globalCompositeOperation = 'multiply';
    for (const ch of ['c', 'm', 'y', 'k']) fxHalftoneChannel(samples, w, h, step, (p.angle + angles[ch]) * Math.PI / 180, p.shape, p.dotSize, colors[ch], ch, p.contrast);
    fxCtx.globalCompositeOperation = 'source-over';
  } else {
    const bg = pal[pal.length - 1], fg = pal[0];
    fxCtx.fillStyle = `rgb(${bg.join(',')})`; fxCtx.fillRect(0, 0, w, h);
    fxHalftoneChannel(samples, w, h, step, angle, p.shape, p.dotSize, fg, 'k', p.contrast);
  }
}
function fxHalftoneChannel(samples, w, h, step, angle, shape, dotSize, color, channel, contrast) {
  fxCtx.fillStyle = `rgb(${color.join(',')})`;
  const cos = Math.cos(angle), sin = Math.sin(angle), cx = w / 2, cy = h / 2, diag = Math.sqrt(w * w + h * h);
  for (let y = -diag; y < diag; y += step) for (let x = -diag; x < diag; x += step) {
    const ix = cos * x - sin * y + cx, iy = sin * x + cos * y + cy; const sx = Math.floor(ix), sy = Math.floor(iy);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
    const i = (sy * w + sx) * 4; const r = samples[i], g = samples[i + 1], b = samples[i + 2];
    let val; if (channel === 'c') val = 1 - r / 255; else if (channel === 'm') val = 1 - g / 255; else if (channel === 'y') val = 1 - b / 255; else val = 1 - Math.min(r, g, b) / 255;
    val = Math.pow(val, 1 / contrast); const size = val * dotSize; if (size < 0.3) continue;
    fxCtx.save(); fxCtx.translate(ix, iy); fxCtx.rotate(angle); fxHalftoneShape(shape, size, dotSize); fxCtx.restore();
  }
}
function fxHalftoneShape(shape, size, maxSize) {
  if (shape === 'circle') { fxCtx.beginPath(); fxCtx.arc(0, 0, size / 2, 0, Math.PI * 2); fxCtx.fill(); }
  else if (shape === 'square') fxCtx.fillRect(-size / 2, -size / 2, size, size);
  else if (shape === 'diamond') { fxCtx.beginPath(); fxCtx.moveTo(0, -size / 2); fxCtx.lineTo(size / 2, 0); fxCtx.lineTo(0, size / 2); fxCtx.lineTo(-size / 2, 0); fxCtx.closePath(); fxCtx.fill(); }
  else if (shape === 'line') fxCtx.fillRect(-maxSize / 2, -size / 3, maxSize, size / 1.5);
  else if (shape === 'cross') { const t = size / 3; fxCtx.fillRect(-size / 2, -t / 2, size, t); fxCtx.fillRect(-t / 2, -size / 2, t, size); }
  else if (shape === 'hex') { fxCtx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, px = Math.cos(a) * size / 2, py = Math.sin(a) * size / 2; if (i === 0) fxCtx.moveTo(px, py); else fxCtx.lineTo(px, py); } fxCtx.closePath(); fxCtx.fill(); }
}

function fxPosterize(p) {
  const pal = fxActivePalette(); const img = fxCtx.getImageData(0, 0, fxCanvas.width, fxCanvas.height); const d = img.data;
  const step = 255 / (p.levels - 1);
  for (let i = 0; i < d.length; i += 4) {
    let r = Math.round(Math.round(d[i] / step) * step), g = Math.round(Math.round(d[i + 1] / step) * step), b = Math.round(Math.round(d[i + 2] / step) * step);
    if (p.usePalette) [r, g, b] = fxClosest(r, g, b, pal); d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  fxCtx.putImageData(img, 0, 0);
}

function fxPixelate(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const sw = Math.max(1, Math.floor(w / p.size)), sh = Math.max(1, Math.floor(h / p.size)); const pal = fxActivePalette();
  fxWork.width = sw; fxWork.height = sh; fxWorkCtx.imageSmoothingEnabled = false; fxWorkCtx.drawImage(fxCanvas, 0, 0, sw, sh);
  if (p.usePalette) { const id = fxWorkCtx.getImageData(0, 0, sw, sh); const d = id.data; for (let i = 0; i < d.length; i += 4) { const [nr, ng, nb] = fxClosest(d[i], d[i + 1], d[i + 2], pal); d[i] = nr; d[i + 1] = ng; d[i + 2] = nb; } fxWorkCtx.putImageData(id, 0, 0); }
  fxCtx.imageSmoothingEnabled = false; fxCtx.clearRect(0, 0, w, h); fxCtx.drawImage(fxWork, 0, 0, w, h);
}

function fxThreshold(p) {
  const pal = fxActivePalette(); const dark = pal[0], light = pal[pal.length - 1];
  const img = fxCtx.getImageData(0, 0, fxCanvas.width, fxCanvas.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (p.smooth > 0) { const t = Math.max(0, Math.min(1, (lum - (p.level - p.smooth)) / (2 * p.smooth))); d[i] = dark[0] + (light[0] - dark[0]) * t; d[i + 1] = dark[1] + (light[1] - dark[1]) * t; d[i + 2] = dark[2] + (light[2] - dark[2]) * t; }
    else { const c = lum > p.level ? light : dark; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }
  }
  fxCtx.putImageData(img, 0, 0);
}

function fxRGBShift(p) {
  const angle = p.angle * Math.PI / 180, dx = Math.cos(angle) * p.amount, dy = Math.sin(angle) * p.amount;
  const w = fxCanvas.width, h = fxCanvas.height; const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const rx = Math.round(x - dx), ry = Math.round(y - dy), bx = Math.round(x + dx), by = Math.round(y + dy);
    const ri = (Math.max(0, Math.min(h - 1, ry)) * w + Math.max(0, Math.min(w - 1, rx))) * 4;
    const bi = (Math.max(0, Math.min(h - 1, by)) * w + Math.max(0, Math.min(w - 1, bx))) * 4;
    o[i] = s[ri]; o[i + 1] = s[i + 1]; o[i + 2] = s[bi + 2]; o[i + 3] = s[i + 3];
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxScanGlitch(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const intensity = p.intensity / 100; const freq = p.frequency;
  const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data; o.set(s);
  for (let sl = 0; sl < freq; sl++) {
    const seed = sl * 37 + p.seed; const rnd = (Math.sin(seed) + 1) * 0.5; if (rnd > 0.7) continue;
    const sliceY = Math.floor(((seed * 13) % 100) / 100 * h); const sliceH = Math.floor(rnd * 30 * intensity) + 1;
    const shift = Math.floor((((seed * 17) % 200) - 100) / 100 * 60 * intensity);
    for (let y = sliceY; y < sliceY + sliceH && y < h; y++) for (let x = 0; x < w; x++) {
      const srcX = Math.max(0, Math.min(w - 1, x - shift)); const si = (y * w + srcX) * 4, di = (y * w + x) * 4;
      o[di] = s[si]; o[di + 1] = s[si + 1]; o[di + 2] = s[si + 2]; o[di + 3] = s[si + 3];
    }
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxSlice(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data;
  const sliceH = Math.ceil(h / p.slices);
  for (let sl = 0; sl < p.slices; sl++) {
    const seed = sl * 23 + p.seed; const rnd = (Math.sin(seed) + 1) * 0.5; const offset = Math.floor((rnd - 0.5) * 2 * p.maxOffset);
    const y0 = sl * sliceH, y1 = Math.min(y0 + sliceH, h);
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) { const srcX = ((x - offset) % w + w) % w; const si = (y * w + srcX) * 4, di = (y * w + x) * 4; o[di] = s[si]; o[di + 1] = s[si + 1]; o[di + 2] = s[si + 2]; o[di + 3] = s[si + 3]; }
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxGrain(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const img = fxCtx.getImageData(0, 0, w, h); const d = img.data; const amount = p.amount, size = p.size;
  if (size === 1) {
    for (let i = 0; i < d.length; i += 4) {
      if (p.mono) { const n = (Math.random() - 0.5) * amount * 2; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n)); }
      else { d[i] += (Math.random() - 0.5) * amount * 2; d[i + 1] += (Math.random() - 0.5) * amount * 2; d[i + 2] += (Math.random() - 0.5) * amount * 2; }
    }
  } else {
    for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
      const n = (Math.random() - 0.5) * amount * 2; const nr = p.mono ? n : (Math.random() - 0.5) * amount * 2, ng = p.mono ? n : (Math.random() - 0.5) * amount * 2, nb = p.mono ? n : (Math.random() - 0.5) * amount * 2;
      for (let dy = 0; dy < size && y + dy < h; dy++) for (let dx = 0; dx < size && x + dx < w; dx++) { const i = ((y + dy) * w + (x + dx)) * 4; d[i] = Math.max(0, Math.min(255, d[i] + nr)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + ng)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + nb)); }
    }
  }
  fxCtx.putImageData(img, 0, 0);
}

function fxCRT(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const lines = p.scanlines; const img = fxCtx.getImageData(0, 0, w, h); const d = img.data;
  for (let y = 0; y < h; y++) {
    const dim = (y % lines < lines / 2) ? 1 : 0.55;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (p.stripes) { const st = x % 3; if (st === 0) { d[i + 1] *= 0.7; d[i + 2] *= 0.7; } else if (st === 1) { d[i] *= 0.7; d[i + 2] *= 0.7; } else { d[i] *= 0.7; d[i + 1] *= 0.7; } }
      d[i] *= dim; d[i + 1] *= dim; d[i + 2] *= dim;
    }
  }
  fxCtx.putImageData(img, 0, 0);
  if (p.vignette > 0) { const g = fxCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 3, w / 2, h / 2, Math.max(w, h) / 1.1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.vignette})`); fxCtx.fillStyle = g; fxCtx.fillRect(0, 0, w, h); }
}

function fxVignette(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const inner = Math.min(w, h) * (1 - p.softness) * 0.4, outer = Math.max(w, h) * 0.7;
  const g = fxCtx.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${p.amount})`); fxCtx.fillStyle = g; fxCtx.fillRect(0, 0, w, h);
}

function fxChromatic(p) {
  const amount = p.amount, w = fxCanvas.width, h = fxCanvas.height, cx = w / 2, cy = h / 2;
  const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data; const maxDist = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let dx = 0, dy = 0;
    if (p.radial) { dx = ((x - cx) / maxDist) * amount; dy = ((y - cy) / maxDist) * amount; } else dx = amount;
    const rx = Math.max(0, Math.min(w - 1, Math.round(x - dx))), ry = Math.max(0, Math.min(h - 1, Math.round(y - dy)));
    const bx = Math.max(0, Math.min(w - 1, Math.round(x + dx))), by = Math.max(0, Math.min(h - 1, Math.round(y + dy)));
    o[i] = s[(ry * w + rx) * 4]; o[i + 1] = s[i + 1]; o[i + 2] = s[(by * w + bx) * 4 + 2]; o[i + 3] = s[i + 3];
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxGlow(p) {
  const w = fxCanvas.width, h = fxCanvas.height;
  fxWork.width = w; fxWork.height = h; fxWorkCtx.drawImage(fxCanvas, 0, 0);
  const wd = fxWorkCtx.getImageData(0, 0, w, h); const dd = wd.data;
  for (let i = 0; i < dd.length; i += 4) { const lum = dd[i] * 0.299 + dd[i + 1] * 0.587 + dd[i + 2] * 0.114; if (lum < p.threshold) { dd[i] = 0; dd[i + 1] = 0; dd[i + 2] = 0; } }
  fxWorkCtx.putImageData(wd, 0, 0);
  const bc = document.createElement('canvas'); bc.width = w; bc.height = h; const bctx = bc.getContext('2d'); bctx.filter = `blur(${p.radius}px)`; bctx.drawImage(fxWork, 0, 0);
  fxCtx.globalCompositeOperation = 'lighter'; fxCtx.globalAlpha = p.amount; fxCtx.drawImage(bc, 0, 0); fxCtx.globalAlpha = 1; fxCtx.globalCompositeOperation = 'source-over';
}

function fxBlur(p) {
  if (p.radius === 0) return;
  fxWork.width = fxCanvas.width; fxWork.height = fxCanvas.height; fxWorkCtx.filter = `blur(${p.radius}px)`; fxWorkCtx.drawImage(fxCanvas, 0, 0); fxWorkCtx.filter = 'none';
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height); fxCtx.drawImage(fxWork, 0, 0);
}

function fxEdge(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4; let gx = 0, gy = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) { const ni = ((y + ky) * w + (x + kx)) * 4; const lum = s[ni] * 0.299 + s[ni + 1] * 0.587 + s[ni + 2] * 0.114; gx += lum * (kx * (ky === 0 ? 2 : 1)); gy += lum * (ky * (kx === 0 ? 2 : 1)); }
    let mag = Math.min(255, Math.sqrt(gx * gx + gy * gy) * p.strength); if (p.invert) mag = 255 - mag;
    o[i] = mag; o[i + 1] = mag; o[i + 2] = mag; o[i + 3] = 255;
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxEmboss(p) {
  const w = fxCanvas.width, h = fxCanvas.height; const s = fxCtx.getImageData(0, 0, w, h).data; const out = fxCtx.createImageData(w, h); const o = out.data;
  const kernel = [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4; let r = 0, g = 0, b = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) { const ni = ((y + ky) * w + (x + kx)) * 4; const k = kernel[ky + 1][kx + 1] * p.strength; r += s[ni] * k; g += s[ni + 1] * k; b += s[ni + 2] * k; }
    o[i] = Math.max(0, Math.min(255, r + 128)); o[i + 1] = Math.max(0, Math.min(255, g + 128)); o[i + 2] = Math.max(0, Math.min(255, b + 128)); o[i + 3] = 255;
  }
  fxCtx.putImageData(out, 0, 0);
}

function fxSave() {
  if (!fxState.source) return;
  const a = document.createElement('a');
  if (fxState.isAsciiText) {
    const blob = new Blob([fxState.lastAsciiText || ''], { type: 'text/plain' });
    a.href = URL.createObjectURL(blob); a.download = `photo-effects-${Date.now()}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('fxStatus').textContent = 'Saved ASCII text';
  } else {
    a.href = fxCanvas.toDataURL('image/png'); a.download = `photo-effects-${Date.now()}.png`; a.click();
    $('fxStatus').textContent = 'Saved PNG';
  }
  toast('Photo effects saved');
}

// ========== Privacy Blur — live two-pane canvas editor ==========
// Source image on the left (draw rectangles / paint a brush mask); the right
// pane is a live OUTPUT preview rebuilt from an ordered list of actions. Each
// action carries its own effect type + radius, so undo/redo simply pop/restore
// from the list and re-render. All effects are client-side canvas work.
const pbState = {
  wired: false,
  source: null,          // HTMLImageElement (full-res original)
  name: '',
  effect: 'blur',        // blur | pixelate | blackbox | dither
  apply: 'areas',        // whole | areas
  selMode: 'rect',       // rect | brush
  radius: 14,
  actions: [],           // committed actions (rectangles / brush strokes)
  redo: [],              // popped actions available to redo
  // transient drawing state
  dragging: false, dragStart: null, dragCur: null,
  painting: false, stroke: null,
  // per-action effect cache so re-render of a static stack is cheap
};
let pbSrcCv = null, pbSrcCtx = null;   // left interactive canvas
let pbOutCv = null, pbOutCtx = null;   // right preview canvas
let pbBaseCv = null, pbBaseCtx = null; // offscreen full-res original
let pbScale = 1;                       // displayed px → image px factor

const PB_EFFECTS = [
  ['blur', 'Blur'],
  ['pixelate', 'Pixelate'],
  ['blackbox', 'Black Box'],
  ['dither', 'Dither / Mosaic'],
];

function openPrivacyBlur() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'privacy-blur', label: 'Privacy Blur' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Privacy Blur';
  setHero('Privacy Blur', 'Blur, pixelate, black-box or dither faces & private details — live, in-app');
  $('pbPanel').classList.remove('hidden');
  if (!pbState.wired) { wirePrivacyBlur(); pbState.wired = true; }
  pbSyncControls();
  pbRender();
}

function wirePrivacyBlur() {
  pbSrcCv = $('pbSrc'); pbSrcCtx = pbSrcCv.getContext('2d', { willReadFrequently: true });
  pbOutCv = $('pbOut'); pbOutCtx = pbOutCv.getContext('2d', { willReadFrequently: true });
  pbBaseCv = document.createElement('canvas'); pbBaseCtx = pbBaseCv.getContext('2d', { willReadFrequently: true });

  enhanceSelects($('pbPanel'));

  $('pbLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    pbLoadImagePath(paths[0]);
  });

  $('pbEffect').addEventListener('change', (e) => { pbState.effect = e.target.value; pbRenderDebounced(); });
  $('pbRadius').addEventListener('input', (e) => {
    pbState.radius = parseInt(e.target.value, 10);
    $('pbRadiusVal').textContent = pbState.radius;
    pbDrawSource(); // keep brush-size cursor responsive
    pbRenderDebounced();
  });
  $('pbRadius').addEventListener('change', pbRenderFlush);

  // segmented: application mode
  $('pbApply').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-val]'); if (!btn) return;
    pbState.apply = btn.dataset.val;
    pbSyncControls(); pbDrawSource(); pbRender();
  });
  // segmented: selection mode
  $('pbSelMode').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-val]'); if (!btn) return;
    pbState.selMode = btn.dataset.val;
    pbSyncControls(); pbDrawSource();
  });

  $('pbUndo').addEventListener('click', pbUndo);
  $('pbRedo').addEventListener('click', pbRedo);
  $('pbClear').addEventListener('click', () => {
    if (!pbState.actions.length) return;
    pbState.actions = []; pbState.redo = [];
    pbUpdateButtons(); pbDrawSource(); pbRender();
  });

  $('pbExport').addEventListener('click', pbExport);
  $('pbDelete').addEventListener('click', pbDeleteResult);
  $('pbFolder').addEventListener('click', () => { if (pbState.lastSaved) window.api.showItem(pbState.lastSaved); else window.api.openPath(pbState.lastDir || ''); });

  // pointer interaction on the source canvas
  pbSrcCv.addEventListener('mousedown', pbPointerDown);
  window.addEventListener('mousemove', pbPointerMove);
  window.addEventListener('mouseup', pbPointerUp);

  // keyboard undo/redo — only while this panel is visible
  document.addEventListener('keydown', (e) => {
    if ($('pbPanel').classList.contains('hidden')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const z = e.key === 'z' || e.key === 'Z';
    const y = e.key === 'y' || e.key === 'Y';
    if ((e.ctrlKey || e.metaKey) && z && !e.shiftKey) { e.preventDefault(); pbUndo(); }
    else if ((e.ctrlKey || e.metaKey) && (y || (z && e.shiftKey))) { e.preventDefault(); pbRedo(); }
  });
}

function pbSyncControls() {
  const eff = $('pbEffect');
  if (eff && !eff.options.length) eff.innerHTML = PB_EFFECTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  if (eff) { eff.value = pbState.effect; if (eff._csRender) eff._csRender(); }
  const r = $('pbRadius'); if (r) { r.value = pbState.radius; $('pbRadiusVal').textContent = pbState.radius; }
  pbSeg('pbApply', pbState.apply);
  pbSeg('pbSelMode', pbState.selMode);
  // selection mode controls only matter for "selected areas"
  $('pbSelRow').classList.toggle('hidden', pbState.apply !== 'areas');
  pbUpdateButtons();
}
function pbSeg(id, val) {
  const seg = $(id); if (!seg) return;
  seg.querySelectorAll('[data-val]').forEach((b) => b.classList.toggle('on', b.dataset.val === val));
}
function pbUpdateButtons() {
  $('pbUndo').disabled = !pbState.actions.length;
  $('pbRedo').disabled = !pbState.redo.length;
  $('pbClear').disabled = !pbState.actions.length;
  const ready = !!pbState.source;
  $('pbExport').disabled = !ready;
}

function pbLoadImagePath(path) {
  const img = new Image();
  img.onload = () => {
    pbState.source = img; pbState.name = baseName(path);
    pbState.actions = []; pbState.redo = []; pbState.lastSaved = null;
    pbBaseCv.width = img.naturalWidth; pbBaseCv.height = img.naturalHeight;
    pbBaseCtx.drawImage(img, 0, 0);
    $('pbName').textContent = pbState.name;
    $('pbHint').classList.add('hidden');
    $('pbResult').classList.add('hidden');
    pbUpdateButtons();
    pbRender();
  };
  img.src = 'file:///' + String(path).replace(/\\/g, '/');
}

// ----- layout: fit both canvases to a max display size -----
function pbFit() {
  const src = pbState.source; if (!src) return { w: 0, h: 0 };
  const iw = src.naturalWidth, ih = src.naturalHeight;
  const MAX = 460;
  let w = iw, h = ih;
  if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  pbScale = iw / w; // displayed → image
  return { w, h };
}

// ----- left pane: original + selection overlay -----
function pbDrawSource() {
  if (!pbState.source) return;
  const { w, h } = pbFit();
  pbSrcCv.width = w; pbSrcCv.height = h;
  pbSrcCtx.drawImage(pbState.source, 0, 0, w, h);
  if (pbState.apply !== 'areas') {
    // whole-image mode → shade the whole canvas to signal it
    pbSrcCtx.fillStyle = 'rgba(0,113,187,0.10)';
    pbSrcCtx.fillRect(0, 0, w, h);
    return;
  }
  // committed actions
  pbSrcCtx.save();
  pbSrcCtx.strokeStyle = '#0071bb'; pbSrcCtx.lineWidth = 1;
  pbSrcCtx.fillStyle = 'rgba(0,113,187,0.18)';
  for (const a of pbState.actions) pbOverlayAction(pbSrcCtx, a);
  // in-progress drag rectangle
  if (pbState.dragging && pbState.dragStart && pbState.dragCur) {
    const r = pbRectFrom(pbState.dragStart, pbState.dragCur);
    pbSrcCtx.fillRect(r.x / pbScale, r.y / pbScale, r.w / pbScale, r.h / pbScale);
    pbSrcCtx.strokeRect(r.x / pbScale, r.y / pbScale, r.w / pbScale, r.h / pbScale);
  }
  // in-progress brush stroke
  if (pbState.painting && pbState.stroke) pbOverlayAction(pbSrcCtx, pbState.stroke);
  pbSrcCtx.restore();
}
function pbOverlayAction(ctx, a) {
  if (a.kind === 'rect') {
    ctx.fillRect(a.x / pbScale, a.y / pbScale, a.w / pbScale, a.h / pbScale);
    ctx.strokeRect(a.x / pbScale, a.y / pbScale, a.w / pbScale, a.h / pbScale);
  } else if (a.kind === 'brush') {
    ctx.beginPath();
    for (const p of a.points) ctx.moveTo(p.x / pbScale + p.r / pbScale, p.y / pbScale), ctx.arc(p.x / pbScale, p.y / pbScale, p.r / pbScale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pbRectFrom(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
function pbEvtPos(e) {
  const rect = pbSrcCv.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (pbSrcCv.width / rect.width);
  const y = (e.clientY - rect.top) * (pbSrcCv.height / rect.height);
  return { x: x * pbScale, y: y * pbScale }; // store in IMAGE pixels
}

function pbPointerDown(e) {
  if (!pbState.source || pbState.apply !== 'areas') return;
  e.preventDefault();
  const p = pbEvtPos(e);
  if (pbState.selMode === 'rect') {
    pbState.dragging = true; pbState.dragStart = p; pbState.dragCur = p;
  } else {
    pbState.painting = true;
    const r = pbState.radius * pbScale; // brush radius in image px
    pbState.stroke = { kind: 'brush', effect: pbState.effect, radius: pbState.radius, points: [{ x: p.x, y: p.y, r }] };
    pbDrawSource();
  }
}
function pbPointerMove(e) {
  if (pbState.dragging) { pbState.dragCur = pbEvtPos(e); pbDrawSource(); }
  else if (pbState.painting && pbState.stroke) {
    const p = pbEvtPos(e); const r = pbState.radius * pbScale;
    pbState.stroke.points.push({ x: p.x, y: p.y, r });
    pbDrawSource(); pbRenderDebounced();
  }
}
function pbPointerUp() {
  if (pbState.dragging) {
    pbState.dragging = false;
    const r = pbRectFrom(pbState.dragStart, pbState.dragCur);
    pbState.dragStart = pbState.dragCur = null;
    if (r.w > 3 && r.h > 3) {
      pbPush({ kind: 'rect', effect: pbState.effect, radius: pbState.radius, x: r.x, y: r.y, w: r.w, h: r.h });
    } else { pbDrawSource(); }
  } else if (pbState.painting) {
    pbState.painting = false;
    const stroke = pbState.stroke; pbState.stroke = null;
    if (stroke && stroke.points.length) pbPush(stroke);
    else pbDrawSource();
  }
}

// ----- action stack / undo / redo -----
function pbPush(action) {
  pbState.actions.push(action);
  pbState.redo = [];
  pbUpdateButtons(); pbDrawSource(); pbRender();
}
function pbUndo() {
  if (!pbState.actions.length) return;
  pbState.redo.push(pbState.actions.pop());
  pbUpdateButtons(); pbDrawSource(); pbRender();
}
function pbRedo() {
  if (!pbState.redo.length) return;
  pbState.actions.push(pbState.redo.pop());
  pbUpdateButtons(); pbDrawSource(); pbRender();
}

// ----- debounced re-render of the heavy output pane -----
let pbRenderTimer = null;
function pbRenderDebounced() {
  if (pbRenderTimer) clearTimeout(pbRenderTimer);
  pbRenderTimer = setTimeout(() => { pbRenderTimer = null; pbRender(); }, 200);
}
function pbRenderFlush() { if (pbRenderTimer) { clearTimeout(pbRenderTimer); pbRenderTimer = null; } pbRender(); }

// ----- OUTPUT: rebuild the full result from source + actions -----
// Returns a full-resolution canvas with all effects applied.
function pbComposite() {
  const src = pbState.source; if (!src) return null;
  const W = src.naturalWidth, H = src.naturalHeight;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.drawImage(pbBaseCv, 0, 0);

  if (pbState.apply === 'whole') {
    pbApplyEffectRegion(octx, 0, 0, W, H, pbState.effect, pbState.radius, null);
    return out;
  }
  // selected areas → apply each action within its own region/mask
  for (const a of pbState.actions) {
    if (a.kind === 'rect') {
      const x = Math.max(0, Math.round(a.x)), y = Math.max(0, Math.round(a.y));
      const w = Math.min(W - x, Math.round(a.w)), h = Math.min(H - y, Math.round(a.h));
      if (w <= 0 || h <= 0) continue;
      pbApplyEffectRegion(octx, x, y, w, h, a.effect, a.radius, null);
    } else if (a.kind === 'brush') {
      // bounding box of the stroke, then apply effect masked to the painted discs
      let minX = W, minY = H, maxX = 0, maxY = 0;
      for (const p of a.points) {
        minX = Math.min(minX, p.x - p.r); minY = Math.min(minY, p.y - p.r);
        maxX = Math.max(maxX, p.x + p.r); maxY = Math.max(maxY, p.y + p.r);
      }
      const x = Math.max(0, Math.floor(minX)), y = Math.max(0, Math.floor(minY));
      const w = Math.min(W - x, Math.ceil(maxX - x)), h = Math.min(H - y, Math.ceil(maxY - y));
      if (w <= 0 || h <= 0) continue;
      // build a mask canvas for the stroke discs in region-local coords
      const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
      const mctx = mask.getContext('2d');
      mctx.fillStyle = '#fff';
      for (const p of a.points) { mctx.beginPath(); mctx.arc(p.x - x, p.y - y, p.r, 0, Math.PI * 2); mctx.fill(); }
      pbApplyEffectRegion(octx, x, y, w, h, a.effect, a.radius, mask);
    }
  }
  return out;
}

// Apply one effect to a sub-rectangle of octx; if mask is given, only the
// white parts of the mask receive the effect (the rest keeps the original).
function pbApplyEffectRegion(octx, x, y, w, h, effect, radius, mask) {
  // grab the region, run the effect on a detached canvas, paint it back
  const region = document.createElement('canvas'); region.width = w; region.height = h;
  const rctx = region.getContext('2d', { willReadFrequently: true });
  rctx.drawImage(octx.canvas, x, y, w, h, 0, 0, w, h);

  if (effect === 'blur') pbBoxBlur(rctx, w, h, Math.max(1, radius));
  else if (effect === 'pixelate') pbPixelate(rctx, w, h, Math.max(2, radius));
  else if (effect === 'blackbox') { rctx.fillStyle = '#000'; rctx.fillRect(0, 0, w, h); }
  else if (effect === 'dither') pbDitherMosaic(rctx, w, h, Math.max(2, radius));

  if (mask) {
    // keep only masked pixels of the processed region
    rctx.globalCompositeOperation = 'destination-in';
    rctx.drawImage(mask, 0, 0);
    rctx.globalCompositeOperation = 'source-over';
  }
  octx.drawImage(region, x, y);
}

// box blur (separable, multi-pass → approximates gaussian / stack blur)
function pbBoxBlur(ctx, w, h, radius) {
  const passes = 3;
  let img = ctx.getImageData(0, 0, w, h);
  let src = img.data;
  let tmp = new Uint8ClampedArray(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < passes; pass++) {
    pbBoxBlurPass(src, tmp, w, h, r, true);   // horizontal
    pbBoxBlurPass(tmp, src, w, h, r, false);  // vertical
  }
  ctx.putImageData(img, 0, 0);
}
function pbBoxBlurPass(src, dst, w, h, r, horizontal) {
  const len = (2 * r + 1);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      let ti = y * w * 4;
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let i = -r; i <= r; i++) { const xi = Math.min(w - 1, Math.max(0, i)); const o = (y * w + xi) * 4; rs += src[o]; gs += src[o + 1]; bs += src[o + 2]; as += src[o + 3]; }
      for (let x = 0; x < w; x++) {
        dst[ti] = rs / len; dst[ti + 1] = gs / len; dst[ti + 2] = bs / len; dst[ti + 3] = as / len;
        const xOut = Math.min(w - 1, Math.max(0, x - r)); const xIn = Math.min(w - 1, Math.max(0, x + r + 1));
        const oOut = (y * w + xOut) * 4, oIn = (y * w + xIn) * 4;
        rs += src[oIn] - src[oOut]; gs += src[oIn + 1] - src[oOut + 1]; bs += src[oIn + 2] - src[oOut + 2]; as += src[oIn + 3] - src[oOut + 3];
        ti += 4;
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let ti = x * 4;
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let i = -r; i <= r; i++) { const yi = Math.min(h - 1, Math.max(0, i)); const o = (yi * w + x) * 4; rs += src[o]; gs += src[o + 1]; bs += src[o + 2]; as += src[o + 3]; }
      for (let y = 0; y < h; y++) {
        dst[ti] = rs / len; dst[ti + 1] = gs / len; dst[ti + 2] = bs / len; dst[ti + 3] = as / len;
        const yOut = Math.min(h - 1, Math.max(0, y - r)); const yIn = Math.min(h - 1, Math.max(0, y + r + 1));
        const oOut = (yOut * w + x) * 4, oIn = (yIn * w + x) * 4;
        rs += src[oIn] - src[oOut]; gs += src[oIn + 1] - src[oOut + 1]; bs += src[oIn + 2] - src[oOut + 2]; as += src[oIn + 3] - src[oOut + 3];
        ti += w * 4;
      }
    }
  }
}

// pixelate: average NxN blocks (N ≈ radius)
function pbPixelate(ctx, w, h, radius) {
  const n = Math.max(2, Math.round(radius));
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let by = 0; by < h; by += n) {
    for (let bx = 0; bx < w; bx += n) {
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      const xe = Math.min(bx + n, w), ye = Math.min(by + n, h);
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const o = (y * w + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; a += d[o + 3]; c++; }
      r /= c; g /= c; b /= c; a /= c;
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const o = (y * w + x) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a; }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// dither / mosaic censor: coarse mosaic blocks + ordered-dither quantization
const PB_BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function pbDitherMosaic(ctx, w, h, radius) {
  // first coarsen into blocks, then apply ordered dither to a small palette
  const n = Math.max(2, Math.round(radius));
  pbPixelate(ctx, w, h, n);
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  const levels = 3; // posterize steps per channel → blocky censor look
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const t = (PB_BAYER[y % 4][x % 4] / 16 - 0.5) * (255 / levels);
      for (let k = 0; k < 3; k++) {
        let v = d[o + k] + t;
        v = Math.round(v / (255 / levels)) * (255 / levels);
        d[o + k] = Math.max(0, Math.min(255, v));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ----- master render: left overlay + right output preview -----
function pbRender() {
  if (!pbState.source) {
    if (pbSrcCv) { pbSrcCv.width = pbSrcCv.height = 0; }
    if (pbOutCv) { pbOutCv.width = pbOutCv.height = 0; }
    return;
  }
  pbDrawSource();
  const full = pbComposite();
  const { w, h } = pbFit();
  pbOutCv.width = w; pbOutCv.height = h;
  pbOutCtx.imageSmoothingEnabled = true;
  pbOutCtx.drawImage(full, 0, 0, w, h);
  pbState._full = full;
  $('pbStatus').textContent = `${full.width}×${full.height} · ${pbState.apply === 'whole' ? 'whole image' : pbState.actions.length + ' area(s)'}`;
}

function pbExport() {
  if (!pbState.source) return;
  const full = pbComposite(); if (!full) return;
  const fname = 'MTB_' + (pbState.name || 'image').replace(/\.[^.]+$/, '') + '_blur.png';
  const a = document.createElement('a');
  a.href = full.toDataURL('image/png'); a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  pbState.lastSaved = null; // client-side download → revealed via Downloads folder
  $('pbResult').classList.remove('hidden');
  $('pbResultName').textContent = fname + ' — saved to Downloads';
  toast('Privacy Blur saved');
}
function pbDeleteResult() {
  $('pbResult').classList.add('hidden');
  $('pbResultName').textContent = '';
}

// ---------- tool options bar (for op tools) ----------
function renderToolOptions() {
  const bar = $('toolOptions');
  const ws = state.ws;
  // Drop any stale region-preview hook from a previously open region tool.
  state.refreshRegionPreview = null;
  if (!ws || (!ws.isOp)) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const op = ws.item.op; const b = ws.base;
  const field = (label, html) => `<label class="to-field"><span>${label}</span>${html}</label>`;
  let html = '';
  if (op === 'resize') html = field('Width (px, 0=auto)', `<input type="number" data-k="width" value="${b.width || 0}">`) + field('Height (px, 0=auto)', `<input type="number" data-k="height" value="${b.height || 0}">`);
  else if (op === 'enlarge') html = field('Scale factor', `<select data-k="factor"><option ${b.factor == 2 ? 'selected' : ''}>2</option><option ${b.factor == 3 ? 'selected' : ''}>3</option><option ${b.factor == 4 ? 'selected' : ''}>4</option></select>`);
  else if (op === 'rotate') html = field('Angle', `<select data-k="angle"><option value="90" ${b.angle == 90 ? 'selected' : ''}>90° CW</option><option value="180" ${b.angle == 180 ? 'selected' : ''}>180°</option><option value="270" ${b.angle == 270 ? 'selected' : ''}>270° CW</option></select>`);
  else if (op === 'flip') html = field('Direction', `<select data-k="flip"><option value="h" ${b.flip === 'h' ? 'selected' : ''}>Horizontal</option><option value="v" ${b.flip === 'v' ? 'selected' : ''}>Vertical</option></select>`);
  else if (op === 'crop') html = field('X', `<input type="number" data-k="cropX" value="${b.cropX || 0}">`) + field('Y', `<input type="number" data-k="cropY" value="${b.cropY || 0}">`) + field('Width', `<input type="number" data-k="cropW" value="${b.cropW || 0}">`) + field('Height', `<input type="number" data-k="cropH" value="${b.cropH || 0}">`);
  else if (op === 'trim') html = field('Start (hh:mm:ss)', `<input type="text" data-k="start" value="${b.start || '00:00:00'}">`) + field('End (hh:mm:ss, blank=end)', `<input type="text" data-k="end" value="${b.end || ''}">`);
  else if (op === 'speed') html = field('Speed', `<select data-k="speed"><option value="0.25" ${b.speed == 0.25 ? 'selected' : ''}>0.25× (slow)</option><option value="0.5" ${b.speed == 0.5 ? 'selected' : ''}>0.5×</option><option value="1" ${b.speed == 1 ? 'selected' : ''}>1× (normal)</option><option value="1.5" ${b.speed == 1.5 ? 'selected' : ''}>1.5×</option><option value="2" ${b.speed == 2 ? 'selected' : ''}>2×</option><option value="4" ${b.speed == 4 ? 'selected' : ''}>4× (fast)</option></select>`);
  else if (op === 'fps') html = field('Target FPS', `<select data-k="fps"><option value="24" ${b.fps == 24 ? 'selected' : ''}>24</option><option value="30" ${b.fps == 30 ? 'selected' : ''}>30</option><option value="60" ${b.fps == 60 ? 'selected' : ''}>60</option><option value="120" ${b.fps == 120 ? 'selected' : ''}>120</option></select>`) + field('Smooth (interpolate)', `<select data-k="interpolate"><option value="" ${!b.interpolate ? 'selected' : ''}>No (drop/dup frames)</option><option value="1" ${b.interpolate ? 'selected' : ''}>Yes (motion blend)</option></select>`);
  else if (op === 'stabilize') html = field('Smoothing', `<select data-k="smoothing"><option value="5" ${b.smoothing == 5 ? 'selected' : ''}>Low (5)</option><option value="10" ${b.smoothing == 10 ? 'selected' : ''}>Medium (10)</option><option value="20" ${b.smoothing == 20 ? 'selected' : ''}>High (20)</option><option value="40" ${b.smoothing == 40 ? 'selected' : ''}>Max (40)</option></select>`);
  else if (op === 'denoise') html = field('Strength', `<select data-k="denoise"><option value="6" ${b.denoise == 6 ? 'selected' : ''}>Gentle</option><option value="12" ${b.denoise == 12 ? 'selected' : ''}>Medium</option><option value="24" ${b.denoise == 24 ? 'selected' : ''}>Strong</option><option value="36" ${b.denoise == 36 ? 'selected' : ''}>Aggressive</option></select>`);
  else if (op === 'upscale') html = field('Scale factor', `<select data-k="factor"><option value="2" ${b.factor == 2 ? 'selected' : ''}>2×</option><option value="3" ${b.factor == 3 ? 'selected' : ''}>3×</option><option value="4" ${b.factor == 4 ? 'selected' : ''}>4×</option></select>`) + field('Algorithm', `<select data-k="algo"><option value="lanczos" ${b.algo === 'lanczos' ? 'selected' : ''}>Lanczos (photo)</option><option value="xbr" ${b.algo === 'xbr' ? 'selected' : ''}>xBR (pixel art)</option></select>`);
  else if (op === 'extract') html = field('First page', `<input type="number" data-k="firstPage" value="${b.firstPage || 1}" min="1">`) + field('Last page (0=end)', `<input type="number" data-k="lastPage" value="${b.lastPage || 0}" min="0">`);
  else if (op === 'protect') html = field('Password', `<input type="text" data-k="password" value="${b.password || ''}" placeholder="set a password">`);
  else if (op === 'remove') html = field('Remove from page', `<input type="number" data-k="removeFirst" value="${b.removeFirst || 1}" min="1">`) + field('to page', `<input type="number" data-k="removeLast" value="${b.removeLast || 1}" min="1">`);
  else if (op === 'rotate') html = field('Rotate by', `<select data-k="angle"><option value="90" ${b.angle == 90 ? 'selected' : ''}>90° CW</option><option value="180" ${b.angle == 180 ? 'selected' : ''}>180°</option><option value="270" ${b.angle == 270 ? 'selected' : ''}>270° CW</option></select>`);
  else if (op === 'unlock') html = field('Current password', `<input type="text" data-k="password" value="${b.password || ''}" placeholder="leave blank if none">`);
  else if (op === 'resize') html = field('Page size', `<select data-k="paper"><option value="a4" ${b.paper === 'a4' ? 'selected' : ''}>A4</option><option value="letter" ${b.paper === 'letter' ? 'selected' : ''}>Letter</option><option value="legal" ${b.paper === 'legal' ? 'selected' : ''}>Legal</option><option value="a3" ${b.paper === 'a3' ? 'selected' : ''}>A3</option></select>`);
  else if (op === 'motionblur') html = field('Intensity', `<select data-k="mblur"><option value="2" ${b.mblur == 2 ? 'selected' : ''}>Subtle (2)</option><option value="4" ${b.mblur == 4 ? 'selected' : ''}>Medium (4)</option><option value="8" ${b.mblur == 8 ? 'selected' : ''}>Strong (8)</option><option value="16" ${b.mblur == 16 ? 'selected' : ''}>Max (16)</option></select>`);
  else if (op === 'thumb') html = field('Timestamp (s or hh:mm:ss)', `<input type="text" data-k="time" value="${b.time || '00:00:01'}" placeholder="00:00:01">`);
  else if (op === 'blur') html = regionFields(b, true) + regionPreviewHtml();
  else if (op === 'delogo') html = regionFields(b, false) + regionPreviewHtml();
  else { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const note = op === 'crop' ? '<div class="hint" style="margin-top:10px">Common sizes — TikTok/Reels 1080×1920 · YouTube 1920×1080 · Square 1080×1080 · Story 1080×1920</div>' : '';
  bar.innerHTML = `<div class="to-title">Options</div><div class="to-fields">${html}</div>${note}`;
  enhanceSelects(bar);
  bar.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.k; b[k] = el.type === 'number' ? Number(el.value) : el.value;
    for (const e of ws.list.values()) e.settings[k] = b[k];
  }));
  if (op === 'blur' || op === 'delogo') wireRegionUI(bar, ws, b);
  bar.classList.remove('hidden');
}

// ---------- region selector (Privacy Blur / Watermark Remover) ----------
// Region is stored as percentages (regionXPct/Y/W/H) so it is resolution-
// independent. A draggable/resizable box sits over a preview of the source
// (image, or the first frame of a video); numeric % inputs are the fallback.
function regionFields(b, withStrength) {
  const f = (label, html) => `<label class="to-field"><span>${label}</span>${html}</label>`;
  let h = '';
  if (withStrength) h += f('Strength', `<select data-k="strength"><option value="light" ${b.strength === 'light' ? 'selected' : ''}>Light</option><option value="medium" ${b.strength === 'medium' ? 'selected' : ''}>Medium</option><option value="strong" ${b.strength === 'strong' ? 'selected' : ''}>Strong</option><option value="max" ${b.strength === 'max' ? 'selected' : ''}>Max</option></select>`);
  h += f('X (%)', `<input type="number" data-k="regionXPct" min="0" max="100" value="${Math.round(b.regionXPct ?? 25)}">`);
  h += f('Y (%)', `<input type="number" data-k="regionYPct" min="0" max="100" value="${Math.round(b.regionYPct ?? 25)}">`);
  h += f('Width (%)', `<input type="number" data-k="regionWPct" min="1" max="100" value="${Math.round(b.regionWPct ?? 50)}">`);
  h += f('Height (%)', `<input type="number" data-k="regionHPct" min="1" max="100" value="${Math.round(b.regionHPct ?? 50)}">`);
  return h;
}
function regionPreviewHtml() {
  return `<div class="region-wrap" id="regionWrap">
      <div class="region-stage" id="regionStage">
        <img id="regionImg" alt="" draggable="false">
        <div class="region-box" id="regionBox"><span class="rb-h rb-br"></span></div>
        <div class="region-empty" id="regionEmpty">Add a file to position the blur box — or use the X / Y / Width / Height fields above.</div>
      </div>
      <div class="hint" style="margin-top:8px">Drag inside the box to move it · drag the corner to resize. The region applies to the whole clip.</div>
    </div>`;
}
function wireRegionUI(bar, ws, b) {
  const stage = bar.querySelector('#regionStage');
  const img = bar.querySelector('#regionImg');
  const box = bar.querySelector('#regionBox');
  const empty = bar.querySelector('#regionEmpty');
  if (!stage || !img || !box) return;

  const setBoxFromPct = () => {
    box.style.left = (b.regionXPct ?? 25) + '%';
    box.style.top = (b.regionYPct ?? 25) + '%';
    box.style.width = (b.regionWPct ?? 50) + '%';
    box.style.height = (b.regionHPct ?? 50) + '%';
  };
  const syncInputs = () => {
    bar.querySelectorAll('[data-k^="region"]').forEach((el) => { el.value = Math.round(b[el.dataset.k] ?? 0); });
  };
  const apply = () => { for (const e of ws.list.values()) { e.settings.regionXPct = b.regionXPct; e.settings.regionYPct = b.regionYPct; e.settings.regionWPct = b.regionWPct; e.settings.regionHPct = b.regionHPct; } };
  // Keep the box in step when the numeric inputs change.
  bar.querySelectorAll('[data-k^="region"]').forEach((el) => el.addEventListener('input', setBoxFromPct));

  // Load a preview: an image source directly, or the first frame of a video via
  // an offscreen <video> painted to a canvas (no extra binaries needed).
  const loadPreview = () => {
    const first = ws.list.size ? [...ws.list.values()][0] : null;
    if (!first) { empty.classList.remove('hidden'); img.removeAttribute('src'); box.classList.add('hidden'); return; }
    const url = 'file:///' + first.path.replace(/\\/g, '/');
    const ext = (first.path.split('.').pop() || '').toLowerCase();
    const showImg = (src) => { img.src = src; empty.classList.add('hidden'); box.classList.remove('hidden'); setBoxFromPct(); };
    if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'mpg', 'ts'].includes(ext)) {
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
      v.addEventListener('loadeddata', () => { try { v.currentTime = Math.min(1, (v.duration || 1) / 2); } catch { /* */ } });
      v.addEventListener('seeked', () => {
        try { const c = document.createElement('canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 360; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); showImg(c.toDataURL('image/png')); } catch { showImg(url); }
      }, { once: true });
      v.addEventListener('error', () => { empty.classList.remove('hidden'); }, { once: true });
    } else {
      showImg(url);
    }
  };
  // Expose so addPaths/renderList can refresh the preview after files change.
  state.refreshRegionPreview = loadPreview;
  loadPreview();

  // Drag to move / resize. Coordinates are normalised to the stage size, so the
  // % maps 1:1 onto the source frame regardless of preview scale.
  let mode = null, sx = 0, sy = 0, start = null;
  const pct = (px, total) => Math.max(0, Math.min(100, px / total * 100));
  const onDown = (e, m) => {
    e.preventDefault(); mode = m; sx = e.clientX; sy = e.clientY;
    start = { x: b.regionXPct ?? 25, y: b.regionYPct ?? 25, w: b.regionWPct ?? 50, h: b.regionHPct ?? 50 };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };
  const onMove = (e) => {
    if (!mode) return;
    const rect = stage.getBoundingClientRect();
    const dxp = (e.clientX - sx) / rect.width * 100, dyp = (e.clientY - sy) / rect.height * 100;
    if (mode === 'move') {
      b.regionXPct = Math.max(0, Math.min(100 - start.w, start.x + dxp));
      b.regionYPct = Math.max(0, Math.min(100 - start.h, start.y + dyp));
    } else { // resize from bottom-right
      b.regionWPct = Math.max(2, Math.min(100 - start.x, start.w + dxp));
      b.regionHPct = Math.max(2, Math.min(100 - start.y, start.h + dyp));
    }
    setBoxFromPct(); syncInputs();
  };
  const onUp = () => { mode = null; apply(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  box.addEventListener('mousedown', (e) => onDown(e, 'move'));
  const handle = box.querySelector('.rb-br'); if (handle) handle.addEventListener('mousedown', (e) => { e.stopPropagation(); onDown(e, 'resize'); });
  void pct;
}

// ---------- file list ----------
function ctx() { return state.ws; }
function metaLine(entry) {
  const m = entry.meta;
  if (entry.status === 'error') return entry.error || 'Unreadable file';
  if (!m) return 'reading…';
  const bits = [];
  if (m.width && m.height) bits.push(`${m.width}×${m.height}`);
  if (m.durationSec) bits.push(fmtDur(m.durationSec));
  bits.push(fmtBytes(m.sizeBytes));
  return bits.join(' · ');
}
async function addPaths(paths) {
  const ws = state.ws; if (!ws) return;
  for (const p of paths) {
    const jobId = uid();
    const settings = { ...defaultSettingsFor(ws.mediaType), ...ws.base };
    if (ws.item.out) settings.outputFormat = ws.item.out;
    const entry = { jobId, path: p, name: baseName(p), mediaType: ws.mediaType, settings, status: 'ready', outputPath: null, els: null, convert: ws.convert };
    ws.list.set(jobId, entry);
    probeEntry(entry);
  }
  renderList();
}
async function probeEntry(entry) {
  try { entry.meta = await window.api.probe(entry.path, entry.mediaType); }
  catch (err) { entry.status = 'error'; entry.error = String(err.message || err); }
  if (state.ws && state.ws.list.has(entry.jobId)) renderList();
}
function renderList() {
  const ws = state.ws; if (!ws) return;
  const container = $('fileList'); container.innerHTML = '';
  const hasFiles = ws.list.size > 0;
  $('emptyHint').classList.toggle('hidden', hasFiles);
  $('footer').classList.toggle('hidden', !hasFiles);
  const formats = state.caps && state.caps.media[ws.mediaType] ? state.caps.media[ws.mediaType].outputFormats : [];
  const showCog = !ws.isOp && !ws.isMerge;

  for (const entry of ws.list.values()) container.appendChild(buildRow(entry, ws, formats, showCog));
  refreshFooter();
  // Region tools: refresh the preview/box when the file set changes.
  if (typeof state.refreshRegionPreview === 'function') state.refreshRegionPreview();
}

// Build one file row. Controls are swapped in place by status (no full re-render).
function buildRow(entry, ws, formats, showCog) {
  const row = document.createElement('div'); row.className = 'file-row';
  row.innerHTML = `
    <div class="fr-info"><div class="fr-name"></div><div class="fr-meta"></div></div>
    <div class="fr-controls"><span class="lbl"></span><span class="fr-out"></span><div class="fr-actions"></div></div>
    <div class="fr-progress hidden"><div class="bar"><div class="bar-fill"></div></div><div class="fr-status"></div></div>`;
  row.querySelector('.fr-name').textContent = entry.name;
  row.querySelector('.fr-meta').textContent = metaLine(entry);
  row.addEventListener('dblclick', () => { if (entry.status === 'done' && entry.outputPath) window.api.showItem(entry.outputPath); });
  entry.els = {
    row, ws, formats, showCog,
    out: row.querySelector('.fr-out'), lbl: row.querySelector('.lbl'), actions: row.querySelector('.fr-actions'),
    progress: row.querySelector('.fr-progress'), bar: row.querySelector('.bar-fill'), status: row.querySelector('.fr-status'),
    setDone: () => applyRowControls(entry),
  };
  if (['running', 'queued', 'done', 'error'].includes(entry.status)) entry.els.progress.classList.remove('hidden');
  applyRowControls(entry);
  return row;
}

function iconBtn(ic, title, cls) { return `<button class="icon-btn ${cls || ''}" title="${title}"><span class="ic">${icon(ic)}</span></button>`; }

function applyRowControls(entry) {
  const ws = entry.els.ws, els = entry.els;
  const st = entry.status;
  // Output selector (only before a job is running/done).
  if (ws.isMerge || ['queued', 'running', 'done'].includes(st)) { els.lbl.textContent = ''; els.out.innerHTML = ''; }
  else {
    els.lbl.textContent = ws.convert ? 'To:' : 'Output:';
    if (ws.lockFmt) els.out.innerHTML = `<span class="fr-format locked">${String(entry.settings.outputFormat || ws.item.out || '').toUpperCase()}</span>`;
    else {
      els.out.innerHTML = `<select class="fr-format">${els.formats.map((f) => `<option value="${f.value}" ${entry.settings.outputFormat === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}</select>`;
      const sel = els.out.querySelector('select'); customSelect(sel); sel.addEventListener('change', () => { entry.settings.outputFormat = sel.value; });
    }
  }
  // Action buttons.
  const a = els.actions; a.innerHTML = '';
  if (st === 'queued' || st === 'running') {
    a.innerHTML = iconBtn(entry.paused ? 'play' : 'pause', entry.paused ? 'Resume' : 'Pause', 'fr-pause') + iconBtn('stop', 'Stop', 'fr-stop');
    a.querySelector('.fr-pause').addEventListener('click', () => {
      if (entry.paused) { window.api.resumeJob(entry.jobId); entry.paused = false; } else { window.api.pauseJob(entry.jobId); entry.paused = true; }
      applyRowControls(entry);
    });
    a.querySelector('.fr-stop').addEventListener('click', () => window.api.cancelJob(entry.jobId));
  } else if (st === 'done') {
    a.innerHTML = iconBtn('folder', 'Open', 'fr-open') + iconBtn('trash', 'Delete file', 'fr-trash');
    a.querySelector('.fr-open').addEventListener('click', () => entry.outputPath && window.api.showItem(entry.outputPath));
    a.querySelector('.fr-trash').addEventListener('click', async () => {
      await window.api.deleteFile(entry.outputPath);
      els.row.classList.add('pop-out');
      setTimeout(() => { els.row.remove(); state.ws.list.delete(entry.jobId); refreshFooter(); }, 360);
    });
  } else {
    if (els.showCog) { a.innerHTML += iconBtn('settings', 'Advanced options', 'fr-cog'); }
    a.innerHTML += iconBtn('x', 'Remove', 'fr-del');
    const cog = a.querySelector('.fr-cog'); if (cog) cog.addEventListener('click', () => openModal(entry.jobId));
    a.querySelector('.fr-del').addEventListener('click', () => { state.ws.list.delete(entry.jobId); els.row.remove(); refreshFooter(); });
  }
}

function refreshFooter() {
  const ws = state.ws; if (!ws) return;
  const ready = [...ws.list.values()].filter((e) => e.status === 'ready' || e.status === 'error').length;
  $('footerCount').textContent = `Added ${ws.list.size} file${ws.list.size === 1 ? '' : 's'}`;
  $('emptyHint').classList.toggle('hidden', ws.list.size > 0);
  $('footer').classList.toggle('hidden', ws.list.size === 0);
  $('btnCompress').disabled = ws.isMerge ? ws.list.size < 2 : ready === 0;
  refreshCancelState();
}
// The Cancel button is inert until at least one job is queued/running.
function refreshCancelState() {
  const ws = state.ws;
  const active = ws ? [...ws.list.values()].some((e) => e.status === 'queued' || e.status === 'running') : false;
  const btn = $('btnCancelAll'); if (btn) btn.classList.toggle('inert', !active);
}
function findEntry(jobId) { return state.ws && state.ws.list.has(jobId) ? state.ws.list.get(jobId) : null; }

// ---------- run ----------
async function runActive() {
  const ws = state.ws; if (!ws) return;
  if (ws.isMerge) {
    const paths = [...ws.list.values()].map((e) => e.path);
    $('btnCompress').disabled = true;
    try {
      const res = await window.api.pdfMerge(paths, state.outputDir);
      for (const e of ws.list.values()) { if (e.els) { e.els.progress.classList.remove('hidden'); e.els.bar.style.width = '100%'; e.els.status.textContent = `Merged → ${baseName(res.outputPath)}`; e.els.status.className = 'fr-status done'; e.outputPath = res.outputPath; e.status = 'done'; } }
    } catch (err) { alert(String(err.message || err)); $('btnCompress').disabled = false; }
    return;
  }
  for (const entry of ws.list.values()) {
    if (entry.status !== 'ready' && entry.status !== 'error') continue;
    if (!entry.meta) continue;
    entry.status = 'queued';
    // Update this row IN PLACE — don't rebuild the list (keeps everything stable).
    if (entry.els) { entry.els.progress.classList.remove('hidden'); entry.els.status.textContent = 'Queued'; entry.els.status.className = 'fr-status'; applyRowControls(entry); }
    refreshCancelState(); // a job is now queued — wake the Cancel button
    try {
      const { outputPath } = await window.api.startJob({ jobId: entry.jobId, mediaType: entry.mediaType, inputPath: entry.path, settings: entry.settings, meta: entry.meta, outputDir: state.outputDir, convert: !!entry.convert });
      entry.outputPath = outputPath;
    } catch (err) { entry.status = 'error'; if (entry.els) { entry.els.status.textContent = 'Failed: ' + (err.message || err); entry.els.status.className = 'fr-status error'; applyRowControls(entry); } }
  }
  refreshFooter();
}
function wireJobEvents() {
  window.api.onJobProgress((d) => {
    const e = findEntry(d.jobId); if (!e || !e.els) return;
    e.status = 'running'; e.els.progress.classList.remove('hidden');
    if (d.indeterminate) { e.els.bar.classList.add('indet'); e.els.status.textContent = 'Processing…'; }
    else { e.els.bar.classList.remove('indet'); e.els.bar.style.width = `${d.percent.toFixed(1)}%`; e.els.status.textContent = `${d.percent.toFixed(0)}%${d.speed ? ` · ${d.speed.toFixed(1)}x` : ''}`; }
    e.els.status.className = 'fr-status';
    refreshCancelState();
  });
  window.api.onJobDone((d) => {
    // Stretch tool job (no file row).
    if (d.jobId === state._stretchJob) {
      $('stBar').style.width = '100%'; $('stStatus').className = 'fr-status done'; $('stStatus').textContent = `Done (${fmtBytes(d.outSize)}) — click to open`; $('stStatus').onclick = () => window.api.showItem(d.outputPath); $('stRender').disabled = false; toast('Stretch complete', { path: d.outputPath }); addRecent({ path: d.outputPath }); state._stretchJob = null; return;
    }
    const e = findEntry(d.jobId); if (!e || !e.els) { toast('Done'); return; }
    e.status = 'done'; e.outputPath = d.outputPath; e.els.bar.classList.remove('indet'); e.els.bar.style.width = '100%';
    const was = e.meta ? `, was ${fmtBytes(e.meta.sizeBytes)}` : '';
    e.els.status.textContent = `Done (${fmtBytes(d.outSize)}${was}) — double-click to open`; e.els.status.className = 'fr-status done';
    if (e.els.setDone) e.els.setDone();
    toast(`Done: ${e.name}`, { path: d.outputPath });
    addRecent({ name: e.name, path: d.outputPath });
    refreshCancelState(); // job finished — re-evaluate the Cancel button
  });
  window.api.onJobError((d) => {
    const e = findEntry(d.jobId); if (!e || !e.els) return;
    const c = String(d.message).includes('canceled');
    e.status = c ? 'ready' : 'error'; e.paused = false; e.els.bar.classList.remove('indet'); e.els.bar.style.width = '0%';
    e.els.status.textContent = c ? 'Canceled' : ('Error: ' + d.message.split('\n')[0]); e.els.status.className = c ? 'fr-status' : 'fr-status error';
    applyRowControls(e); refreshFooter();
  });
}

// ---------- advanced options modal (compress/convert) ----------
function codecOptions() {
  const enc = state.caps.encoders;
  const vl = { cpu: '(CPU)', nvenc: '(NVIDIA GPU)', qsv: '(Intel GPU)', amf: '(AMD GPU)' };
  const cl = { h264: 'H.264', hevc: 'H.265 / HEVC' };
  const opts = [];
  for (const c of ['h264', 'hevc']) for (const v of ['cpu', 'nvenc', 'qsv', 'amf']) if (enc[c] && enc[c][v]) opts.push({ value: `${c}|${v}`, label: `${cl[c]} ${vl[v]}` });
  return opts;
}
function fieldRow(l, c, h) { return `<div class="field-row"><label>${l}</label><div class="control">${c}${h ? `<span class="hint">${h}</span>` : ''}</div></div>`; }
function openModal(jobId) {
  const e = findEntry(jobId); if (!e) return;
  state.modalJobId = jobId;
  $('modalFileName').textContent = `${e.name} (${fmtBytes(e.meta ? e.meta.sizeBytes : 0)})`;
  $('modalBody').innerHTML = buildModalBody(e); wireModalBody(e); injectIcons($('modalBody')); enhanceSelects($('modalBody'));
  $('modalApplyAll').checked = false; $('modalOverlay').classList.remove('hidden');
}
function closeModal() { $('modalOverlay').classList.add('hidden'); state.modalJobId = null; }
function buildModalBody(e) {
  const map = { video: videoModal, image: imageModal, gif: gifModal, audio: audioModal, pdf: pdfModal, pdf2img: pdf2imgModal };
  return (map[e.mediaType] || (() => `<p class="hint" style="padding:8px 0">No extra options.</p>`))(e.settings);
}
function videoModal(s) {
  const co = codecOptions(); const cur = `${s.codec || 'h264'}|${s.encoder || (co[0] ? co[0].value.split('|')[1] : 'cpu')}`;
  const cs = co.map((o) => `<option value="${o.value}" ${o.value === cur ? 'selected' : ''}>${o.label}</option>`).join('');
  const methods = [['percent', 'Target a file size (Percentage)'], ['mb', 'Target a file size (MB)'], ['quality', 'Target a video quality'], ['resolution', 'Target a video resolution'], ['bitrate', 'Target a max bitrate']];
  const ms = methods.map(([v, l]) => `<option value="${v}" ${s.method === v ? 'selected' : ''}>${l}</option>`).join('');
  const res = [[0, 'No change'], [2160, '2160p (4K)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p']].map(([v, l]) => `<option value="${v}" ${Number(s.scaleHeight) === v ? 'selected' : ''}>${l}</option>`).join('');
  const fpsOpt = [[0, 'Keep original'], [60, '60'], [30, '30'], [24, '24'], [15, '15']].map(([v, l]) => `<option value="${v}" ${Number(s.fps) === v ? 'selected' : ''}>${l}</option>`).join('');
  const rot = [[0, 'None'], [90, '90° CW'], [180, '180°'], [270, '270° CW']].map(([v, l]) => `<option value="${v}" ${Number(s.rotate) === v ? 'selected' : ''}>${l}</option>`).join('');
  const flip = [['none', 'None'], ['h', 'Horizontal'], ['v', 'Vertical']].map(([v, l]) => `<option value="${v}" ${(s.flip || 'none') === v ? 'selected' : ''}>${l}</option>`).join('');
  const acodec = [['auto', 'Auto (recommended)'], ['copy', 'Copy (no re-encode)'], ['aac', 'AAC'], ['mp3', 'MP3'], ['opus', 'Opus'], ['ac3', 'AC3']].map(([v, l]) => `<option value="${v}" ${(s.audioCodec || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="section-title">Video Options</div>
    ${fieldRow('Video Codec', `<select id="m_codec">${cs}</select>`, 'H.265 can reduce size 20–75% more than H.264.')}
    ${fieldRow('Compression Method', `<select id="m_method">${ms}</select>`, '')}
    <div id="m_methodFields"></div>
    ${fieldRow('Resize Video', `<select id="m_res2">${res}</select>`, 'Downscale to save size. Never upscales.')}
    ${fieldRow('Video Frame Rate', `<select id="m_fps">${fpsOpt}</select>`, '')}
    ${fieldRow('Rotate Video', `<select id="m_rotate">${rot}</select>`, '')}
    ${fieldRow('Flip Video', `<select id="m_flip">${flip}</select>`, '')}
    ${fieldRow('Compatible with old devices?', `<div class="check-inline"><input type="checkbox" id="m_compat" ${s.compatibility ? 'checked' : ''}/> <span class="hint">Only for very old devices (compresses less).</span></div>`, '')}
    <div class="section-title">Subtitle Settings</div>
    ${fieldRow('Add Subtitle', `<select id="m_subAdd"><option value="none" ${!s.subtitle ? 'selected' : ''}>None</option><option value="upload" ${s.subtitle ? 'selected' : ''}>Upload</option></select>`, '')}
    <div id="m_subFields"></div>
    <div class="section-title">Audio Options</div>
    ${fieldRow('Audio Codec', `<select id="m_acodec">${acodec}</select>`, '')}
    ${fieldRow('Adjust Volume', `<div class="slider-row"><input type="range" id="m_vol" min="0" max="400" value="${s.volume || 100}"/><span class="slider-val"><input type="number" id="m_volN" value="${s.volume || 100}"/> %</span></div>`, '100% = original. 200% doubles, 50% halves.')}
    ${fieldRow('Fade In Audio', `<div class="check-inline"><input type="checkbox" id="m_fadeIn" ${s.fadeIn ? 'checked' : ''}/></div>`, '')}
    ${fieldRow('Fade Out Audio', `<div class="check-inline"><input type="checkbox" id="m_fadeOut" ${s.fadeOut ? 'checked' : ''}/></div>`, '')}
    ${fieldRow('Remove Audio', `<div class="check-inline"><input type="checkbox" id="m_removeAudio" ${s.removeAudio ? 'checked' : ''}/></div>`, '')}
    <div class="section-title">Trim Settings</div>
    ${fieldRow('Trim Start', `<input type="text" id="m_trimStart" value="${s.trimStart || ''}" placeholder="00:00:00.00"/>`, 'HH:MM:SS.MS. Leave blank to disable.')}
    ${fieldRow('Trim End', `<input type="text" id="m_trimEnd" value="${s.trimEnd || ''}" placeholder="00:00:00.00"/>`, 'HH:MM:SS.MS. Leave blank to disable.')}
    <div class="section-title">Video Crop Settings</div>
    ${fieldRow('Width × Height (px)', `<div class="slider-row"><input type="number" id="m_cropW" value="${s.cropW || 0}" min="0"/> × <input type="number" id="m_cropH" value="${s.cropH || 0}" min="0"/></div>`, '0 = full. Odd numbers round down.')}
    ${fieldRow('Position-X', `<input type="number" id="m_cropX" value="${s.cropX || 0}" min="0"/>`, 'Top-left X of the crop rectangle.')}
    ${fieldRow('Position-Y', `<input type="number" id="m_cropY" value="${s.cropY || 0}" min="0"/>`, 'Top-left Y of the crop rectangle.')}
    <div style="height:8px"></div>`;
}
function methodFieldsHtml(s) {
  const res = [[0, 'Keep original'], [2160, '2160p (4K)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p']].map(([v, l]) => `<option value="${v}" ${Number(s.scaleHeight) === v ? 'selected' : ''}>${l}</option>`).join('');
  const pr = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow'].map((p) => `<option value="${p}" ${s.preset === p ? 'selected' : ''}>${p}</option>`).join('');
  switch (s.method) {
    case 'percent': return fieldRow('Target Size (%)', `<div class="slider-row"><input type="range" id="m_percent" min="1" max="200" value="${s.percent}"/><span class="slider-val"><input type="number" id="m_percentN" value="${s.percent}"/> %</span></div>`, 'e.g. 100 MB → 25 MB at 25%.');
    case 'mb': return fieldRow('Target Size (MB)', `<input type="number" id="m_mb" value="${s.targetMB}" min="1"/>`, '');
    case 'quality': return fieldRow('Quality (CRF)', `<div class="slider-row"><input type="range" id="m_crf" min="0" max="51" value="${s.crf}"/><span class="slider-val"><input type="number" id="m_crfN" value="${s.crf}"/></span></div>`, '0–51, lower = better. 23 default.') + fieldRow('Preset', `<select id="m_preset">${pr}</select>`, '');
    case 'resolution': return fieldRow('Resolution', `<select id="m_res">${res}</select>`, 'Never upscales.');
    case 'bitrate': return fieldRow('Max Bitrate (kbps)', `<input type="number" id="m_kbps" value="${s.videoKbps}" min="100"/>`, '');
    default: return '';
  }
}
function subFieldsHtml(s) {
  if (!s.subtitle) return '';
  const name = s.subtitle.path ? baseName(s.subtitle.path) : 'No file chosen';
  const ms = ['hard', 'soft'].map((m) => `<option value="${m}" ${s.subtitle.mode === m ? 'selected' : ''}>${m === 'hard' ? 'Hard (burned in)' : 'Soft (toggleable)'}</option>`).join('');
  return fieldRow('Upload Subtitles', `<div class="slider-row"><button class="btn ghost" id="m_subPick">Choose .srt / .ass…</button> <span class="hint" id="m_subName">${name}</span></div>`, '') + fieldRow('Subtitle Mode', `<select id="m_subMode">${ms}</select>`, '');
}
function imageModal(s) {
  return `<div class="section-title">Image Quality &amp; Size</div>
    ${fieldRow('Quality', `<div class="slider-row"><input type="range" id="m_q" min="1" max="100" value="${s.quality}"/><span class="slider-val"><input type="number" id="m_qN" value="${s.quality}"/></span></div>`, '')}
    ${fieldRow('Resize', `<div class="slider-row"><input type="range" id="m_scale" min="10" max="100" value="${s.scalePercent}"/><span class="slider-val"><input type="number" id="m_scaleN" value="${s.scalePercent}"/> %</span></div>`, '')}`;
}
function gifModal(s) {
  return `<div class="section-title">GIF Options</div>
    ${fieldRow('Resize', `<div class="slider-row"><input type="range" id="m_scale" min="10" max="100" value="${s.scalePercent}"/><span class="slider-val"><input type="number" id="m_scaleN" value="${s.scalePercent}"/> %</span></div>`, '')}
    ${fieldRow('Frame rate (fps)', `<input type="number" id="m_fps" value="${s.fps}" min="0"/>`, '0 = keep')}
    ${fieldRow('Colors', `<div class="slider-row"><input type="range" id="m_colors" min="2" max="256" value="${s.colors}"/><span class="slider-val"><input type="number" id="m_colorsN" value="${s.colors}"/></span></div>`, '')}`;
}
function audioModal(s) {
  const methods = [['bitrate', 'Target a bitrate'], ['percent', 'Target a file size (%)'], ['mb', 'Target a file size (MB)']];
  const ms = methods.map(([v, l]) => `<option value="${v}" ${s.method === v ? 'selected' : ''}>${l}</option>`).join('');
  const rates = [320, 256, 192, 128, 96, 64].map((r) => `<option value="${r}" ${Number(s.audioKbps) === r ? 'selected' : ''}>${r} kbps</option>`).join('');
  const sr = [[0, 'Keep original'], [48000, '48 kHz'], [44100, '44.1 kHz'], [22050, '22 kHz']].map(([v, l]) => `<option value="${v}" ${Number(s.sampleRate) === v ? 'selected' : ''}>${l}</option>`).join('');
  let mf = s.method === 'bitrate' ? fieldRow('Bitrate', `<select id="m_kbps">${rates}</select>`, '') : s.method === 'percent' ? fieldRow('Target Size (%)', `<input type="number" id="m_percent" value="${s.percent}" min="1"/>`, '') : fieldRow('Target Size (MB)', `<input type="number" id="m_mb" value="${s.targetMB}" min="0.1" step="0.1"/>`, '');
  return `<div class="section-title">Audio Quality &amp; Size</div>${fieldRow('Compression Method', `<select id="m_method">${ms}</select>`, '')}${mf}${fieldRow('Sample rate', `<select id="m_sr">${sr}</select>`, '')}`;
}
function pdfModal(s) {
  const ps = [['screen', 'Screen — smallest'], ['ebook', 'eBook — balanced'], ['printer', 'Printer — high'], ['prepress', 'Prepress — max']].map(([v, l]) => `<option value="${v}" ${s.preset === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="section-title">PDF Quality</div>${fieldRow('Quality preset', `<select id="m_preset">${ps}</select>`, '')}`;
}
function pdf2imgModal(s) {
  const d = [[72, '72 dpi'], [150, '150 dpi'], [300, '300 dpi']].map(([v, l]) => `<option value="${v}" ${Number(s.dpi) === v ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="section-title">PDF to Image</div>${fieldRow('Resolution', `<select id="m_dpi">${d}</select>`, 'One image per page.')}`;
}
function wireModalBody(e) {
  const s = e.settings, t = e.mediaType;
  if (t === 'video') {
    const rm = () => { $('m_methodFields').innerHTML = methodFieldsHtml(s); syncPair('m_percent', 'm_percentN'); syncPair('m_crf', 'm_crfN'); enhanceSelects($('m_methodFields')); };
    const rs = () => { $('m_subFields').innerHTML = subFieldsHtml(s); const pk = $('m_subPick'); if (pk) pk.addEventListener('click', async () => { const p = await window.api.pickSubtitle(); if (p) { s.subtitle = s.subtitle || { mode: 'hard' }; s.subtitle.path = p; $('m_subName').textContent = baseName(p); } }); enhanceSelects($('m_subFields')); };
    rm(); rs(); syncPair('m_vol', 'm_volN');
    $('m_method').addEventListener('change', (ev) => { s.method = ev.target.value; rm(); });
    $('m_subAdd').addEventListener('change', (ev) => { s.subtitle = ev.target.value === 'upload' ? (s.subtitle || { path: null, mode: 'hard' }) : undefined; rs(); });
  } else if (t === 'audio') { const m = $('m_method'); if (m) m.addEventListener('change', (ev) => { s.method = ev.target.value; $('modalBody').innerHTML = audioModal(s); wireModalBody(e); injectIcons($('modalBody')); enhanceSelects($('modalBody')); }); }
  else { syncPair('m_q', 'm_qN'); syncPair('m_scale', 'm_scaleN'); syncPair('m_colors', 'm_colorsN'); }
}
function syncPair(a, b) { const r = $(a), n = $(b); if (!r || !n) return; r.addEventListener('input', () => { n.value = r.value; }); n.addEventListener('input', () => { r.value = n.value; }); }
function readModalInto(s, t) {
  const v = (id) => { const el = $(id); return el ? el.value : undefined; }, ck = (id) => { const el = $(id); return el ? el.checked : undefined; };
  if (t === 'video') {
    const cv = v('m_codec'); if (cv) { const [c, e] = cv.split('|'); s.codec = c; s.encoder = e; }
    s.method = v('m_method') || s.method; s.compatibility = !!ck('m_compat');
    if (v('m_percentN') != null) s.percent = Number(v('m_percentN'));
    if (v('m_mb') != null) s.targetMB = Number(v('m_mb'));
    if (v('m_crfN') != null) s.crf = Number(v('m_crfN'));
    if (v('m_preset') != null) s.preset = v('m_preset');
    if (v('m_res') != null) s.scaleHeight = Number(v('m_res'));
    if (v('m_res2') != null) s.scaleHeight = Number(v('m_res2'));
    if (v('m_kbps') != null) s.videoKbps = Number(v('m_kbps'));
    if (v('m_fps') != null) s.fps = Number(v('m_fps'));
    if (v('m_rotate') != null) s.rotate = Number(v('m_rotate'));
    if (v('m_flip') != null) s.flip = v('m_flip');
    if (v('m_acodec') != null) s.audioCodec = v('m_acodec');
    if (v('m_volN') != null) s.volume = Number(v('m_volN'));
    s.fadeIn = !!ck('m_fadeIn'); s.fadeOut = !!ck('m_fadeOut'); s.removeAudio = !!ck('m_removeAudio');
    if (v('m_trimStart') != null) s.trimStart = v('m_trimStart');
    if (v('m_trimEnd') != null) s.trimEnd = v('m_trimEnd');
    if (v('m_cropW') != null) s.cropW = Number(v('m_cropW'));
    if (v('m_cropH') != null) s.cropH = Number(v('m_cropH'));
    if (v('m_cropX') != null) s.cropX = Number(v('m_cropX'));
    if (v('m_cropY') != null) s.cropY = Number(v('m_cropY'));
    if (v('m_subAdd') === 'upload') { s.subtitle = s.subtitle || { mode: 'hard' }; if (v('m_subMode')) s.subtitle.mode = v('m_subMode'); } else s.subtitle = undefined;
  } else if (t === 'image') { if (v('m_qN') != null) s.quality = Number(v('m_qN')); if (v('m_scaleN') != null) s.scalePercent = Number(v('m_scaleN')); }
  else if (t === 'gif') { if (v('m_scaleN') != null) s.scalePercent = Number(v('m_scaleN')); if (v('m_fps') != null) s.fps = Number(v('m_fps')); if (v('m_colorsN') != null) s.colors = Number(v('m_colorsN')); }
  else if (t === 'audio') { s.method = v('m_method') || s.method; if (v('m_kbps') != null) s.audioKbps = Number(v('m_kbps')); if (v('m_percent') != null) s.percent = Number(v('m_percent')); if (v('m_mb') != null) s.targetMB = Number(v('m_mb')); if (v('m_sr') != null) s.sampleRate = Number(v('m_sr')); }
  else if (t === 'pdf') { if (v('m_preset') != null) s.preset = v('m_preset'); }
  else if (t === 'pdf2img') { if (v('m_dpi') != null) s.dpi = Number(v('m_dpi')); }
}
function applyModal() {
  const e = findEntry(state.modalJobId); if (!e) return closeModal();
  readModalInto(e.settings, e.mediaType);
  if ($('modalApplyAll').checked) for (const o of state.ws.list.values()) if (o.jobId !== e.jobId) { const of = o.settings.outputFormat; o.settings = JSON.parse(JSON.stringify(e.settings)); o.settings.outputFormat = of; }
  closeModal(); renderList();
}

// ---------- special tools ----------
function openSpecial(id) {
  hideAll(); $('toolHeader').classList.remove('hidden');
  const names = { youtube: 'Video Downloader', 'unit-converter': 'Unit Converter', 'time-converter': 'Time Converter', 'archive-converter': 'Archive Converter' };
  $('toolName').textContent = names[id] || '';
  // Track the current tool for the favorites heart. The Video Downloader is a
  // non-registry tool keyed 'downloader'; unit/time use their registry ids.
  if (id === 'youtube') state.currentTool = { id: 'downloader', label: 'Video Downloader' };
  else if (id === 'unit-converter' || id === 'time-converter') state.currentTool = { id, label: names[id] };
  updateFavBtn();
  if (id === 'youtube') { setHero('Video Downloader', "Paste a link and it'll download & convert — powered by yt-dlp"); $('ytPanel').classList.remove('hidden'); }
  else if (id === 'unit-converter') { setHero('Unit Converter', 'Convert between common units'); $('unitPanel').classList.remove('hidden'); }
  else if (id === 'time-converter') { setHero('Time Converter', 'Time zones and Unix timestamps'); $('timePanel').classList.remove('hidden'); }
  else if (id === 'archive-converter') { openItem(window.findConverter('archive-converter'), 'convert'); }
}

// ---------- Metadata editor ----------
const META_LABELS = { title: 'Title', artist: 'Artist', album: 'Album', album_artist: 'Album artist', composer: 'Composer', genre: 'Genre', date: 'Year', track: 'Track', comment: 'Comment', description: 'Description' };
const metaState = { path: null, original: {}, keys: [], kind: null, hasAudio: false, fileInfo: null, editable: [], readonly: [] };
function openMetaEditor() {
  hideAll(); state.section = 'tools';
  state.currentTool = { id: 'metadata', label: 'Metadata Editor' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Metadata Editor';
  setHero('Metadata Editor', 'Edit or scrub the metadata baked into a media file');
  $('metaPanel').classList.remove('hidden');
}
function mtbEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; let v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}
function fmtDate(ms) { if (!ms) return '—'; try { return new Date(ms).toLocaleString(); } catch { return '—'; } }
function renderMetaFields(tags) {
  const title = $('meFieldsTitle');
  if (metaState.kind === 'image') {
    // Images: one input per editable EXIF/IPTC/XMP/ICC/GPS/MakerNotes tag,
    // labelled by its prettified tag name, keyed by the full 'Group:Tag'.
    if (title) title.textContent = 'editable metadata (exif / iptc / xmp / icc)';
    const items = metaState.editable || [];
    if (!items.length) { $('meFields').innerHTML = '<p class="me-empty-note">No editable metadata found in this image.</p>'; return; }
    // Group the inputs under their exiftool group for readability.
    const byGroup = {};
    for (const it of items) { (byGroup[it.group] = byGroup[it.group] || []).push(it); }
    $('meFields').innerHTML = Object.keys(byGroup).map((g) => {
      const rows = byGroup[g].map((it) => `<label class="field"><span title="${mtbEsc(it.key)}">${mtbEsc(it.label)}</span><input type="text" data-mk="${mtbEsc(it.key)}" data-orig="${mtbEsc(it.value)}" value="${mtbEsc(it.value)}"/></label>`).join('');
      return `<div class="me-group"><div class="me-group-title">${mtbEsc(g)}</div><div class="me-group-fields">${rows}</div></div>`;
    }).join('');
    return;
  }
  // Audio/video: an input for every key the file surfaced (standard + own tags).
  if (title) title.textContent = 'editable tags';
  const keys = metaState.keys.length ? metaState.keys : Object.keys(META_LABELS);
  $('meFields').innerHTML = keys.map((k) => `<label class="field"><span>${mtbEsc(META_LABELS[k] || k)}</span><input type="text" data-mk="${mtbEsc(k)}" value="${mtbEsc(tags[k])}"/></label>`).join('');
}
function renderMetaReadonly() {
  // Image-only: computed/file fields (File/Composite/ExifTool) shown muted.
  const box = $('meReadonly'); if (!box) return;
  const items = (metaState.kind === 'image' && metaState.readonly) ? metaState.readonly : [];
  if (!items.length) { box.innerHTML = ''; return; }
  const rows = items.map((it) => `<div class="me-ro-row"><span class="me-ro-l">${mtbEsc(it.label)}</span><span class="me-ro-v">${mtbEsc(it.value)}</span></div>`).join('');
  box.innerHTML = `<div class="me-sec-title">computed / file fields (read-only)</div><div class="me-ro-list">${rows}</div>`;
}
function renderMetaQuick() {
  // Quick-actions, scoped to the detected media kind.
  const kind = metaState.kind; // 'video' | 'audio' | 'image'
  const cb = (id, label) => `<label class="me-check"><input type="checkbox" id="${id}"/> <span>${label}</span></label>`;
  let html = '';
  if (kind === 'video' || kind === 'image') html += cb('meqGps', 'Scrub GPS / location');
  if (kind === 'video' || kind === 'audio') html += cb('meqCreation', 'Clear creation app / device info');
  if (kind === 'video' && metaState.hasAudio) html += cb('meqNoAudio', 'Disable audio (drop audio stream)');
  $('meQuick').innerHTML = html ? `<div class="me-sec-title">quick actions</div><div class="me-checks">${html}</div>` : '';
}
function renderMetaFileInfo() {
  const fi = metaState.fileInfo; const box = $('meFileInfo');
  if (!fi) { box.innerHTML = ''; return; }
  const attrs = [];
  if (fi.readOnly) attrs.push('read-only');
  const rows = [
    ['Size', fmtBytes(fi.sizeBytes)],
    ['Size on disk (approx.)', fmtBytes(fi.sizeOnDisk)],
    ['Created', fmtDate(fi.createdMs)],
    ['Modified', fmtDate(fi.modifiedMs)],
    ['Accessed', fmtDate(fi.accessedMs)],
    ['Attributes', attrs.length ? attrs.join(', ') : 'none'],
  ];
  box.innerHTML = `<div class="me-sec-title">file info (read-only)</div><div class="me-info-grid">${rows.map(([l, v]) => `<div class="me-info-row"><span class="me-info-l">${l}</span><span class="me-info-v">${mtbEsc(v)}</span></div>`).join('')}</div>`;
}
function detectMetaKind(r, path) {
  if (r.codecType === 'video' || r.codecType === 'audio') return r.codecType;
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'jfif', 'gif', 'heic'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wma', 'aiff'].includes(ext)) return 'audio';
  return 'video';
}
function wireMetaEditor() {
  $('meLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths.length) return;
    metaState.path = paths[0]; $('meName').textContent = baseName(paths[0]);
    $('meStatus').textContent = ''; $('meStatus').className = 'fr-status';
    try {
      const r = await window.api.metaRead(paths[0]);
      metaState.original = r.tags || {}; metaState.keys = r.keys || [];
      metaState.kind = r.kind || detectMetaKind(r, paths[0]);
      metaState.hasAudio = !!r.hasAudio; metaState.fileInfo = r.fileInfo || null;
      metaState.editable = r.editable || []; metaState.readonly = r.readonly || [];
      renderMetaFields(metaState.original);
      renderMetaQuick();
      renderMetaReadonly();
      renderMetaFileInfo();
      $('meEmpty').classList.add('hidden'); $('meBody').classList.remove('hidden');
      $('meView').classList.remove('hidden');
    } catch (e) { toast('Could not read metadata', { kind: 'error' }); }
  });
  // View pop-out: show the loaded media in a full-screen lightbox on demand.
  const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F');
  const closeLightbox = () => { $('meLightbox').classList.add('hidden'); $('meLightboxStage').innerHTML = ''; };
  const openLightbox = () => {
    if (!metaState.path) return;
    const url = fileUrl(metaState.path);
    const k = metaState.kind;
    let el;
    if (k === 'video') el = `<video class="me-lb-media" src="${mtbEsc(url)}" controls autoplay></video>`;
    else if (k === 'audio') el = `<audio class="me-lb-audio" src="${mtbEsc(url)}" controls autoplay></audio>`;
    else el = `<img class="me-lb-media" src="${mtbEsc(url)}" alt="" />`;
    $('meLightboxStage').innerHTML = el;
    $('meLightbox').classList.remove('hidden');
  };
  $('meView').addEventListener('click', openLightbox);
  $('meLightbox').addEventListener('click', (e) => { if (e.target === $('meLightbox')) closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('meLightbox').classList.contains('hidden')) closeLightbox(); });
  const collect = () => {
    const t = {};
    document.querySelectorAll('#meFields input[data-mk]').forEach((el) => {
      if (metaState.kind === 'image') {
        // Images: only send tags the user actually changed (keyed Group:Tag).
        if (el.value !== (el.dataset.orig || '')) t[el.dataset.mk] = el.value;
      } else {
        t[el.dataset.mk] = el.value;
      }
    });
    return t;
  };
  const quick = () => ({
    clearGps: !!($('meqGps') && $('meqGps').checked),
    clearCreation: !!($('meqCreation') && $('meqCreation').checked),
    removeAudio: !!($('meqNoAudio') && $('meqNoAudio').checked),
  });
  const write = async (scrub) => {
    if (!metaState.path) return;
    $('meStatus').textContent = 'Saving…'; $('meStatus').className = 'fr-status';
    try {
      const q = scrub ? {} : quick();
      const res = await window.api.metaWrite({ inputPath: metaState.path, kind: metaState.kind, tags: scrub ? {} : collect(), scrub, outputDir: state.outputDir, ...q });
      $('meStatus').textContent = `Saved → ${baseName(res.outputPath)}`; $('meStatus').className = 'fr-status done';
      $('meStatus').onclick = () => window.api.showItem(res.outputPath);
      toast(scrub ? 'Metadata scrubbed' : 'Metadata saved', { path: res.outputPath });
    } catch (e) { $('meStatus').textContent = 'Error: ' + (e.message || e); $('meStatus').className = 'fr-status error'; }
  };
  $('meSave').addEventListener('click', () => write(false));
  $('meScrub').addEventListener('click', () => write(true));
  $('meReset').addEventListener('click', () => { renderMetaFields(metaState.original); renderMetaQuick(); renderMetaReadonly(); });
}

// ---------- Color Picker ----------
function openColorPicker() {
  hideAll(); $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Color Picker';
  setHero('Color Picker', 'Pick colors from an image'); $('colorPanel').classList.remove('hidden');
}
function wireColorPicker() {
  const canvas = $('cpCanvas'); const ctxc = canvas.getContext('2d', { willReadFrequently: true });
  $('cpLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths.length) return;
    const img = new Image();
    img.onload = () => { const maxW = 560; const sc = Math.min(1, maxW / img.width); canvas.width = img.width * sc; canvas.height = img.height * sc; ctxc.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = 'file:///' + paths[0].replace(/\\/g, '/');
  });
  const read = (e) => {
    const r = canvas.getBoundingClientRect(); const x = Math.floor((e.clientX - r.left) * canvas.width / r.width), y = Math.floor((e.clientY - r.top) * canvas.height / r.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const d = ctxc.getImageData(x, y, 1, 1).data; const hex = '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
    $('cpSwatch').style.background = hex; $('cpHex').value = hex; $('cpRgb').value = `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  };
  canvas.addEventListener('mousemove', read); canvas.addEventListener('click', read);
  // Pick from screen via the Chromium EyeDropper API (Electron renderer).
  const setColor = (hex) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const h = '#' + m[1].toLowerCase() + m[2].toLowerCase() + m[3].toLowerCase();
    $('cpSwatch').style.background = h; $('cpHex').value = h; $('cpRgb').value = `rgb(${r}, ${g}, ${b})`;
  };
  const screenBtn = $('cpScreen');
  if (screenBtn) {
    if (typeof window.EyeDropper === 'undefined') screenBtn.disabled = true;
    screenBtn.addEventListener('click', async () => {
      try { const eye = new EyeDropper(); const res = await eye.open(); setColor(res.sRGBHex); }
      catch { /* user canceled */ }
    });
  }
}

// ---------- YouTube ----------
const yt = { info: null, downloading: false };
function ytErr(m) { const el = $('ytError'); if (!m) { el.classList.add('hidden'); return; } el.textContent = m; el.classList.remove('hidden'); }
// Turn a Windows/Unix path into a file:/// URL the <video> tag can load (CSP allows file:).
function fileUrl(p) { return 'file:///' + String(p || '').replace(/\\/g, '/').replace(/^\/+/, ''); }
const PLAYABLE_EXT = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'aac'];
function isPlayable(p) { const ext = (String(p || '').split('.').pop() || '').toLowerCase(); return PLAYABLE_EXT.includes(ext); }
// Reveal the downloader preview <video> pointed at a local file (CSP allows file:).
function ytPlayFile(path, name) {
  const wrap = $('ytPreview'), v = $('ytVideo'); if (!wrap || !v) return;
  $('ytPreviewName').textContent = name || baseName(path);
  v.src = fileUrl(path);
  wrap.classList.remove('hidden');
  try { v.load(); } catch { /* */ }
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function ytClosePreview() { const wrap = $('ytPreview'), v = $('ytVideo'); if (!wrap || !v) return; try { v.pause(); } catch { /* */ } v.removeAttribute('src'); try { v.load(); } catch { /* */ } wrap.classList.add('hidden'); }
function ytRefreshSub() {
  const mode = $('ytMode').value, sub = $('ytSub'), subWrap = $('ytSubWrap');
  // Thumbnail mode has no format choice — hide the Format row entirely.
  if (subWrap) subWrap.classList.toggle('hidden', mode === 'thumbnail');
  if (mode === 'audio') sub.innerHTML = ['mp3', 'ogg', 'm4a', 'opus', 'wav'].map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
  else if (mode === 'video') sub.innerHTML = ['mp4', 'mkv', 'webm'].map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
  else if (mode === 'transcription') sub.innerHTML = ['with', 'without', 'captions'].map((f) => { const label = f === 'with' ? 'With timestamps (.srt)' : f === 'without' ? 'Without timestamps (.txt)' : 'Captions (.srt)'; return `<option value="${f}"${f === 'without' ? ' selected' : ''}>${label}</option>`; }).join('');
  if (sub._csRender) sub._csRender();
  ytRefreshQuality();
}
function ytRefreshQuality() {
  const mode = $('ytMode').value, sel = $('ytQuality'), wrap = $('ytQualityWrap');
  // No quality choice for transcription or thumbnail.
  if (mode === 'transcription' || mode === 'thumbnail') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if (mode === 'audio') { $('ytQualityLabel').textContent = 'Bitrate'; sel.innerHTML = [320, 256, 192, 128, 96].map((k) => `<option value="${k}">${k} kbps</option>`).join(''); }
  else { $('ytQualityLabel').textContent = 'Max resolution'; const hs = (yt.info && yt.info.heights.length) ? yt.info.heights : [2160, 1440, 1080, 720, 480, 360]; sel.innerHTML = `<option value="0">Best available</option>` + hs.map((h) => `<option value="${h}">${h}p</option>`).join(''); }
  if (sel._csRender) sel._csRender();
}
async function ytFetch() {
  if (isOffline()) { toast("You're offline — connect to the internet to download.", { kind: 'error' }); return; }
  const url = $('ytUrl').value.trim(); if (!url) return;
  ytErr(''); $('ytFetch').disabled = true; $('ytFetch').textContent = 'Fetching…';
  try { const info = await window.api.ytInfo(url); yt.info = info; $('ytThumb').src = info.thumbnail || ''; $('ytTitle').textContent = info.title; $('ytUploader').textContent = [info.uploader, fmtDur(info.durationSec)].filter(Boolean).join(' · '); ytRefreshSub(); $('ytInfo').classList.remove('hidden'); $('ytProgress').classList.add('hidden'); }
  catch (err) { ytErr(String(err.message || err)); $('ytInfo').classList.add('hidden'); }
  finally { $('ytFetch').disabled = false; $('ytFetch').textContent = 'Fetch'; }
}
async function ytDownload() {
  if (isOffline()) { toast("You're offline — connect to the internet to download.", { kind: 'error' }); return; }
  if (!yt.info || yt.downloading) return;
  yt.downloading = true; yt.canceling = false; $('ytDownload').disabled = true; $('ytCancel').classList.remove('hidden');
  $('ytProgress').classList.remove('hidden'); $('ytBar').style.width = '0%'; $('ytStatus').className = 'fr-status'; $('ytStatus').textContent = 'Starting…';
  const mode = $('ytMode').value, sub = $('ytSub').value;
  const opts = { url: yt.info.webpage, mode, outputDir: state.outputDir };
  if (mode === 'audio') { opts.audioFormat = sub; opts.audioKbps = Number($('ytQuality').value); }
  else if (mode === 'video') { opts.audioFormat = sub; opts.height = Number($('ytQuality').value); }
  else if (mode === 'transcription') { opts.subMode = sub; }
  // 'thumbnail' mode needs no extra options — the main process downloads only the image.
  try {
    const res = await window.api.ytDownload(opts);
    if (yt.canceling) return;   // user canceled mid-flight; UI already reset
    $('ytBar').style.width = '100%'; $('ytStatus').className = 'fr-status done';
    $('ytStatus').textContent = res.outSize ? `Done (${fmtBytes(res.outSize)}) — click to open` : 'Done — click to open';
    // Always clickable: open the file if we have its path, else open the folder.
    $('ytStatus').onclick = () => { if (res.outputPath) window.api.showItem(res.outputPath); else if (state.outputDir) window.api.openPath(state.outputDir); };
    if (res.outputPath) addRecent({ path: res.outputPath });
    // Let the user play a downloaded video right here in the app.
    if (mode === 'video' && res.outputPath) ytPlayFile(res.outputPath); else ytClosePreview();
    toast('Download complete', res.outputPath ? { path: res.outputPath } : {});
  }
  catch (err) { if (yt.canceling) return; const c = String(err.message).includes('canceled'); $('ytStatus').className = c ? 'fr-status' : 'fr-status error'; $('ytStatus').textContent = c ? 'Canceled' : ('Error: ' + String(err.message).split('\n')[0]); }
  finally { if (!yt.canceling) { yt.downloading = false; $('ytDownload').disabled = false; $('ytCancel').classList.add('hidden'); } }
}
// Cancel CLICK: reset the UI optimistically (don't wait for the process to exit),
// then ask the main process to kill the download. The in-flight ytDownload promise
// will reject with 'canceled'; its handler is a no-op once we've already reset here.
function ytCancelClick() {
  if (!yt.downloading) return;
  yt.canceling = true;
  yt.downloading = false;
  $('ytDownload').disabled = false;
  $('ytCancel').classList.add('hidden');
  $('ytProgress').classList.add('hidden');
  $('ytBar').style.width = '0%';
  $('ytStatus').className = 'fr-status'; $('ytStatus').textContent = 'Canceled';
  try { window.api.ytCancel(); } catch { /* */ }
}
// Domains yt-dlp supports for this app. Host matches if it equals the domain
// or ends with ".<domain>".
const YT_DOMAINS = ['youtube.com', 'youtu.be', 'bilibili.com', 'bsky.app', 'dailymotion.com', 'dai.ly', 'facebook.com', 'fb.watch', 'instagram.com', 'loom.com', 'ok.ru', 'pinterest.com', 'pin.it', 'newgrounds.com', 'reddit.com', 'rutube.ru', 'snapchat.com', 'soundcloud.com', 'streamable.com', 'tiktok.com', 'tumblr.com', 'twitch.tv', 'twitter.com', 'x.com', 'vimeo.com', 'vk.com'];
function ytHostOf(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''); // strip scheme
  s = s.replace(/^www\./i, '');
  s = s.split(/[/?#]/)[0]; // host up to first /, ? or #
  return s.toLowerCase();
}
function ytUrlSupported(raw) {
  const host = ytHostOf(raw);
  if (!host) return true; // empty = not invalid
  return YT_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}
function ytValidate() {
  const inp = $('ytUrl'); if (!inp) return;
  const val = inp.value.trim();
  const ok = ytUrlSupported(val);
  inp.classList.toggle('invalid', !ok && val.length > 0);
  const fb = $('ytFetch'); if (fb) fb.disabled = (!ok && val.length > 0);
}
const YT_SERVICES = ['youtube', 'bilibili', 'bluesky', 'dailymotion', 'facebook', 'instagram', 'loom', 'ok', 'pinterest', 'newgrounds', 'reddit', 'rutube', 'snapchat', 'soundcloud', 'streamable', 'tiktok', 'tumblr', 'twitch clips', 'twitter', 'vimeo', 'vk'];
function wireYoutube() {
  $('ytServicesChips').innerHTML = YT_SERVICES.map((s) => `<span class="yt-chip">${s}</span>`).join('');
  $('ytFetch').addEventListener('click', ytFetch);
  $('ytUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') ytFetch(); });
  $('ytUrl').addEventListener('input', ytValidate);
  $('ytMode').addEventListener('change', ytRefreshSub);
  $('ytSub').addEventListener('change', ytRefreshQuality);
  $('ytDownload').addEventListener('click', ytDownload);
  $('ytCancel').addEventListener('click', ytCancelClick);
  const pc = $('ytPreviewClose'); if (pc) pc.addEventListener('click', ytClosePreview);
  window.api.onYtProgress((p) => { if (yt.canceling || !yt.downloading) return; $('ytProgress').classList.remove('hidden'); $('ytBar').style.width = `${(p.percent || 0).toFixed(1)}%`; $('ytStatus').textContent = p.phase === 'processing' ? 'Converting…' : `${(p.percent || 0).toFixed(0)}%`; });
}

// ---------- Spotify Downloader ----------
// Reads a track's public Spotify embed metadata + cover, then finds the match on
// YouTube (yt-dlp) and tags the mp3 with the Spotify metadata + embedded cover.
const spot = { info: null, busy: false };
function spotErr(m) { const el = $('spotError'); if (!el) return; if (!m) { el.classList.add('hidden'); return; } el.textContent = m; el.classList.remove('hidden'); }
function openSpotify() {
  hideAll(); $('toolHeader').classList.remove('hidden');
  state.currentTool = { id: 'spotify', label: 'Spotify Downloader' }; updateFavBtn();
  $('toolName').textContent = 'Spotify Downloader';
  setHero('Spotify Downloader', 'Paste a Spotify track link — grab the song (as MP3) or just the album cover');
  $('spotifyPanel').classList.remove('hidden');
}
async function spotFetch() {
  if (isOffline()) { toast("You're offline — connect to the internet to download.", { kind: 'error' }); return; }
  const url = $('spotUrl').value.trim(); if (!url) return;
  spotErr(''); $('spotFetch').disabled = true; $('spotFetch').textContent = 'Fetching…';
  try {
    const info = await window.api.spotifyInfo(url);
    spot.info = info;
    if (info.coverDataUrl) { $('spotCover').src = info.coverDataUrl; $('spotCover').classList.remove('hidden'); }
    else $('spotCover').classList.add('hidden');
    $('spotTitle').textContent = info.title || '';
    $('spotArtist').textContent = info.artist || '';
    $('spotAlbum').textContent = [info.album, info.year].filter(Boolean).join(' · ');
    $('spotInfo').classList.remove('hidden');
    $('spotProgress').classList.add('hidden');
    $('spotStatus').textContent = ''; $('spotStatus').className = 'fr-status';
  } catch (err) { spotErr(String(err.message || err)); $('spotInfo').classList.add('hidden'); }
  finally { $('spotFetch').disabled = false; $('spotFetch').textContent = 'Fetch'; }
}
async function spotDownload(what) {
  if (isOffline()) { toast("You're offline — connect to the internet to download.", { kind: 'error' }); return; }
  if (!spot.info || spot.busy) return;
  spot.busy = true;
  $('spotSong').disabled = true; $('spotCoverBtn').disabled = true; $('spotCancel').classList.remove('hidden');
  $('spotProgress').classList.remove('hidden'); $('spotBar').style.width = '0%';
  $('spotStatus').className = 'fr-status'; $('spotStatus').textContent = 'Starting…';
  const opts = {
    spotifyUrl: $('spotUrl').value.trim(),
    what,
    withMetadata: !!$('spotMeta').checked,
    embedCover: !!$('spotEmbed').checked,
    outputDir: state.outputDir,
  };
  try {
    const res = await window.api.spotifyDownload(opts);
    $('spotBar').style.width = '100%'; $('spotStatus').className = 'fr-status done';
    $('spotStatus').textContent = res.outSize ? `Done (${fmtBytes(res.outSize)}) — click to open` : 'Done — click to open';
    $('spotStatus').onclick = () => { if (res.outputPath) window.api.showItem(res.outputPath); else if (state.outputDir) window.api.openPath(state.outputDir); };
    if (res.outputPath) addRecent({ path: res.outputPath });
    toast('Download complete', res.outputPath ? { path: res.outputPath } : {});
  } catch (err) {
    const c = String(err.message).includes('canceled');
    $('spotStatus').className = c ? 'fr-status' : 'fr-status error';
    $('spotStatus').textContent = c ? 'Canceled' : ('Error: ' + String(err.message).split('\n')[0]);
  } finally {
    spot.busy = false; $('spotSong').disabled = false; $('spotCoverBtn').disabled = false; $('spotCancel').classList.add('hidden');
  }
}
function spotValidate() {
  const inp = $('spotUrl'); if (!inp) return;
  const val = inp.value.trim();
  const ok = !val || /open\.spotify\.com\/.*track\/|spotify:track:/i.test(val);
  inp.classList.toggle('invalid', !ok);
  const fb = $('spotFetch'); if (fb) fb.disabled = !ok && val.length > 0;
}
function wireSpotify() {
  if (!$('spotifyPanel')) return;
  $('spotFetch').addEventListener('click', spotFetch);
  $('spotUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') spotFetch(); });
  $('spotUrl').addEventListener('input', spotValidate);
  $('spotSong').addEventListener('click', () => spotDownload('song'));
  $('spotCoverBtn').addEventListener('click', () => spotDownload('cover'));
  $('spotCancel').addEventListener('click', () => window.api.spotifyCancel());
  // "embed cover" only matters when metadata is on.
  $('spotMeta').addEventListener('change', () => { $('spotEmbed').disabled = !$('spotMeta').checked; });
  window.api.onSpotifyProgress((p) => {
    if (!spot.busy) return;
    $('spotProgress').classList.remove('hidden');
    $('spotBar').style.width = `${(p.percent || 0).toFixed(1)}%`;
    const labels = { info: 'Reading Spotify…', download: 'Downloading…', processing: 'Converting…', tagging: 'Tagging…', done: 'Done' };
    $('spotStatus').textContent = labels[p.phase] || `${(p.percent || 0).toFixed(0)}%`;
  });
}

// ---------- top-bar search (hover-expand, tag-aware) ----------
// Index every item across the three registries: label, category name, kind, tags.
let searchIndex = null;
function buildSearchIndex() {
  const out = [];
  const groups = [
    ['convert', window.CONVERT_CATEGORIES],
    ['compress', window.COMPRESS_CATEGORIES],
    ['tool', window.TOOL_CATEGORIES],
    // AI tools were delisted from the Tools accordion (they live in the Home AI
    // hub) but stay searchable; openItem routes them by engine like any tool.
    ['tool', window.AI_CATEGORIES],
  ];
  for (const [kind, cats] of groups) {
    if (!Array.isArray(cats)) continue;
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        // Skip items unsupported by this build (mirrors the accordion's filter).
        if (item.need && state.caps && !state.caps[item.need]) continue;
        const tags = Array.isArray(item.tags) ? item.tags : [];
        out.push({
          item, kind,
          label: item.label || '',
          cat: cat.name || '',
          tags,
          // Precomputed lowercase haystacks for ranking.
          lLabel: (item.label || '').toLowerCase(),
          lCat: (cat.name || '').toLowerCase(),
          lTags: tags.map((t) => String(t).toLowerCase()),
        });
      }
    }
  }
  searchIndex = out;
  return out;
}
// Score one entry against a lowercase query. Higher = better; <=0 = no match.
function searchScore(e, q) {
  let best = 0;
  if (e.lLabel === q) best = Math.max(best, 1000);
  else if (e.lLabel.startsWith(q)) best = Math.max(best, 800);
  else if (e.lLabel.includes(q)) best = Math.max(best, 500);
  // Tag matches (the other agent populates item.tags).
  for (const t of e.lTags) {
    if (t === q) best = Math.max(best, 700);
    else if (t.startsWith(q)) best = Math.max(best, 600);
    else if (t.includes(q)) best = Math.max(best, 400);
  }
  // Category hint match.
  if (e.lCat.includes(q)) best = Math.max(best, 300);
  if (e.kind.includes(q)) best = Math.max(best, 250);
  // Multi-word: every whitespace-separated token must appear somewhere.
  const toks = q.split(/\s+/).filter(Boolean);
  if (toks.length > 1) {
    const hay = e.lLabel + ' ' + e.lCat + ' ' + e.kind + ' ' + e.lTags.join(' ');
    const all = toks.every((t) => hay.includes(t));
    if (all) best = Math.max(best, 450);
    else if (best < 1000) best = 0; // partial multi-word → drop unless a stronger single hit
  }
  // Light fuzzy fallback: query chars appear in order within the label.
  if (best === 0 && q.length >= 3 && subseq(q, e.lLabel)) best = 120;
  return best;
}
function subseq(q, s) { let i = 0; for (const ch of s) { if (ch === q[i]) i++; if (i === q.length) return true; } return i === q.length; }
function searchQuery(raw) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return [];
  if (!searchIndex) buildSearchIndex();
  return searchIndex
    .map((e) => ({ e, s: searchScore(e, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.e.lLabel.localeCompare(b.e.lLabel))
    .slice(0, 10);
}
function renderSearchResults(results) {
  const box = $('navSearchResults'); if (!box) return;
  if (!results.length) { box.innerHTML = `<div class="navsearch-empty">no matches</div>`; box.classList.remove('hidden'); return; }
  const kindLbl = { convert: 'convert', compress: 'compress', tool: 'tool' };
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  box.innerHTML = results.map((r, i) =>
    `<button class="navsearch-opt" data-i="${i}"><span class="ns-label">${esc(r.e.label)}</span><span class="ns-hint">${esc(kindLbl[r.e.kind] || r.e.kind)} · ${esc(r.e.cat)}</span></button>`
  ).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.navsearch-opt').forEach((el) => el.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); // keep focus until we route
    const r = results[Number(el.dataset.i)]; if (r) searchOpen(r.e);
  }));
}
// Route a chosen entry exactly like the accordion does (openItem handles special engines).
function searchOpen(entry) {
  searchCollapse(true);
  openItem(entry.item, entry.kind);
}
function searchCollapse(clear) {
  const wrap = $('navSearch'), inp = $('navSearchInput'), box = $('navSearchResults');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  if (clear && inp) inp.value = '';
  if (wrap && (!inp || !inp.value)) wrap.classList.remove('open');
  if (inp) inp.blur();
}
function wireSearch() {
  const wrap = $('navSearch'), btn = $('navSearchBtn'), inp = $('navSearchInput'), box = $('navSearchResults');
  if (!wrap || !inp) return;
  buildSearchIndex();
  const run = () => { const r = searchQuery(inp.value); if (inp.value.trim()) renderSearchResults(r); else { box.classList.add('hidden'); box.innerHTML = ''; } };
  btn.addEventListener('click', () => { wrap.classList.add('open'); inp.focus(); });
  inp.addEventListener('focus', () => { wrap.classList.add('open'); if (inp.value.trim()) run(); });
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchCollapse(true); return; }
    if (e.key === 'Enter') { const first = box.querySelector('.navsearch-opt'); if (first) first.dispatchEvent(new MouseEvent('mousedown')); }
  });
  // Collapse when empty + blurred; stay open while focused.
  inp.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== inp) searchCollapse(false); }, 120); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) searchCollapse(false); });
}

// ---------- Unit / Time ----------
const UNITS = { Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 }, Weight: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.0283495231, ton: 1000 }, Data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }, Speed: { 'm/s': 1, 'km/h': 0.277778, mph: 0.44704, knot: 0.514444 } };
function unitInit() { const cat = $('unitCat'); cat.innerHTML = Object.keys(UNITS).concat(['Temperature']).map((c) => `<option>${c}</option>`).join(''); cat.addEventListener('change', unitFill); ['unitFrom', 'unitFromU', 'unitToU'].forEach((id) => $(id).addEventListener('input', unitCompute)); unitFill(); }
function unitFill() { const c = $('unitCat').value; const u = c === 'Temperature' ? ['C', 'F', 'K'] : Object.keys(UNITS[c]); $('unitFromU').innerHTML = u.map((x) => `<option>${x}</option>`).join(''); $('unitToU').innerHTML = u.map((x, i) => `<option ${i === 1 ? 'selected' : ''}>${x}</option>`).join(''); ['unitFromU', 'unitToU'].forEach((id) => { const el = $(id); if (el._csRender) el._csRender(); }); unitCompute(); }
function unitCompute() { const c = $('unitCat').value, val = parseFloat($('unitFrom').value), fu = $('unitFromU').value, tu = $('unitToU').value; if (isNaN(val)) { $('unitTo').value = ''; return; } let out; if (c === 'Temperature') { let k; if (fu === 'C') k = val + 273.15; else if (fu === 'F') k = (val - 32) * 5 / 9 + 273.15; else k = val; if (tu === 'C') out = k - 273.15; else if (tu === 'F') out = (k - 273.15) * 9 / 5 + 32; else out = k; } else out = val * UNITS[c][fu] / UNITS[c][tu]; $('unitTo').value = Number(out.toPrecision(8)).toString(); }
const TZS = [['UTC', 0], ['New York (ET)', -5], ['Chicago (CT)', -6], ['Denver (MT)', -7], ['Los Angeles (PT)', -8], ['London', 0], ['Paris/Berlin', 1], ['Dubai', 4], ['India', 5.5], ['Tokyo', 9], ['Sydney', 11]];
function timeInit() { const o = TZS.map(([n], i) => `<option value="${i}">${n}</option>`).join(''); $('timeFrom').innerHTML = o; $('timeTo').innerHTML = o; $('timeTo').value = '9'; ['timeInput', 'timeFrom', 'timeTo'].forEach((id) => $(id).addEventListener('input', timeCompute)); }
function timeCompute() { const raw = $('timeInput').value; if (!raw) { $('timeOut').innerHTML = '<span class="muted">Pick a date and time above.</span>'; return; } const [, fOff] = TZS[Number($('timeFrom').value)], [toName, tOff] = TZS[Number($('timeTo').value)]; const local = new Date(raw); const utcMs = local.getTime() - local.getTimezoneOffset() * 60000 - fOff * 3600000; const target = new Date(utcMs + tOff * 3600000); const pad = (n) => String(n).padStart(2, '0'); const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; $('timeOut').innerHTML = `In <b>${toName}</b>: ${fmt(target)}<br>Unix timestamp: <b>${Math.floor(utcMs / 1000)}</b>`; }

// ---------- toasts (persistent; hover for X; click opens the file location) ----------
function toast(msg, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast' + (opts.kind === 'error' ? ' err' : '') + (opts.path ? ' clickable' : '');
  el.innerHTML = `<span class="toast-msg"></span><button class="toast-x" title="Dismiss"><span class="ic">${icon('x')}</span></button>`;
  el.querySelector('.toast-msg').textContent = msg;
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); };
  el.querySelector('.toast-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  if (opts.path) el.addEventListener('click', () => window.api.showItem(opts.path));
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return close;
}

// ---------- first-run AI model setup feedback ----------
// The installer can record optional AI models to download on first launch
// (see build/installer.nsh + main.js). We surface that with lightweight
// toasts and reuse the existing aimodels progress channel for a live percent.
function wireFirstRun() {
  let active = false;       // true only while a first-run download is running
  let progressClose = null; // dismiss handle for the rolling progress toast
  window.api.onFirstRunStart((d) => {
    active = true;
    const n = (d && d.items && d.items.length) || 0;
    toast(`Setting up AI model${n === 1 ? '' : 's'}…`);
  });
  // Reuse the model-manager progress events for a single rolling notice.
  // Gated by `active` so manual downloads from Settings aren't affected — the
  // model-manager UI has its own onProgress listener for those.
  window.api.aimodels.onProgress((p) => {
    if (!active || !p) return;
    const pct = Math.round(p.percent || 0);
    if (progressClose) progressClose();
    progressClose = toast(`Downloading ${p.feature} model… ${pct}%`);
  });
  window.api.onFirstRunDone(() => {
    active = false;
    if (progressClose) { progressClose(); progressClose = null; }
    toast('AI models ready');
  });
}

// ---------- favorites / saved tools ----------
// Persisted in localStorage as an array of {id,label}; capped + deduped by id.
// Surfaced two ways: a heart toggle in #toolHeader (current tool) and a small
// appbar popover (modeled on the recents dropdown) listing every saved tool.
const FAVS_KEY = 'mtb_favorites';
const FAV_HEART_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.3 4.3 12.6a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l1.2 1.2 1.2-1.2a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5Z"/></svg>';
const FAV_HEART_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.3 4.3 12.6a4.6 4.6 0 0 1 0-6.5 4.6 4.6 0 0 1 6.5 0l1.2 1.2 1.2-1.2a4.6 4.6 0 0 1 6.5 0 4.6 4.6 0 0 1 0 6.5Z"/></svg>';

function loadFavs() { try { return JSON.parse(localStorage.getItem(FAVS_KEY)) || []; } catch { return []; } }
function saveFavs(arr) {
  // Dedupe by id (keep first occurrence) and cap at ~50.
  const seen = new Set(); const out = [];
  for (const f of arr) { if (!f || !f.id || seen.has(f.id)) continue; seen.add(f.id); out.push({ id: f.id, label: f.label }); }
  try { localStorage.setItem(FAVS_KEY, JSON.stringify(out.slice(0, 50))); } catch { /* */ }
}
function isFav(id) { return !!id && loadFavs().some((f) => f.id === id); }
function toggleFav(id, label) {
  if (!id) return false;
  let arr = loadFavs();
  const has = arr.some((f) => f.id === id);
  if (has) arr = arr.filter((f) => f.id !== id);
  else arr.unshift({ id, label: label || id }); // newest first
  saveFavs(arr);
  const now = !has;
  if ($('favsModal') && !$('favsModal').classList.contains('hidden')) renderFavs();
  return now;
}

// Reflect the current tool's favorite state on the #toolHeader heart; hide when
// there's no current tool (home/profile/settings).
function updateFavBtn() {
  const btn = $('favBtn'); if (!btn) return;
  const ct = state.currentTool;
  if (!ct || !ct.id) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  const on = isFav(ct.id);
  btn.classList.toggle('on', on);
  btn.innerHTML = on ? FAV_HEART_FILLED : FAV_HEART_OUTLINE;
  btn.title = on ? 'Remove from saved tools' : 'Save this tool';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// Open a saved tool by id: resolve through the registries, falling back to the
// non-registry special openers (metadata, downloader).
function openFavById(id, label) {
  state.backTo = 'home';
  toggleFavs(false);
  if (id === 'metadata') return openMetaEditor();
  if (id === 'downloader') return openSpecial('youtube');
  const fromConv = window.findConverter(id);
  if (fromConv) return openItem(fromConv, 'convert');
  const fromComp = window.findCompressor(id);
  if (fromComp) return openItem(fromComp, 'compress');
  const fromTool = window.findTool(id);
  if (fromTool) return openItem(fromTool, 'tool');
  const fromAi = window.findAiTool && window.findAiTool(id);
  if (fromAi) return openItem(fromAi, 'tool');
  toast(label ? `Couldn’t open “${label}”` : 'Tool not found', { kind: 'error' });
}

function renderFavs() {
  const body = $('favsBody'); if (!body) return;
  const arr = loadFavs();
  if (!arr.length) {
    body.innerHTML = '<div class="recent-empty">No saved tools yet — tap the heart on any tool</div>';
    return;
  }
  body.innerHTML = arr.map((f, i) => (
    `<div class="recent-row fav-row" data-i="${i}">` +
      `<button class="recent-open" data-open="${i}"><span class="recent-name">${mtbEsc(f.label)}</span></button>` +
      `<button class="fav-remove" data-remove="${i}" title="Remove from saved"><span class="ic">${FAV_HEART_FILLED}</span></button>` +
    '</div>'
  )).join('');
  body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => { const f = arr[Number(el.dataset.open)]; if (f) openFavById(f.id, f.label); }));
  body.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const f = arr[Number(el.dataset.remove)];
    if (f) { toggleFav(f.id, f.label); renderFavs(); updateFavBtn(); }
  }));
}
function toggleFavs(force) {
  const m = $('favsModal'); if (!m) return;
  const show = force != null ? force : m.classList.contains('hidden');
  if (show) { renderFavs(); m.classList.remove('hidden'); } else m.classList.add('hidden');
}
function wireFavs() {
  const fb = $('favBtn');
  if (fb) fb.addEventListener('click', () => {
    const ct = state.currentTool; if (!ct || !ct.id) return;
    toggleFav(ct.id, ct.label); updateFavBtn();
  });
  const navBtn = $('favsBtn');
  if (navBtn) navBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFavs(); });
  const closeBtn = $('favsClose');
  if (closeBtn) closeBtn.addEventListener('click', () => toggleFavs(false));
  // Close on backdrop click.
  const m = $('favsModal');
  if (m) m.addEventListener('click', (e) => { if (e.target === m) toggleFavs(false); });
  // Close on Esc.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('favsModal') && !$('favsModal').classList.contains('hidden')) toggleFavs(false);
  });
}

// ---------- recents / downloads menu ----------
const RECENTS_KEY = 'mtb_recents';
function loadRecents() { try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch { return []; } }
function saveRecents(arr) { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(arr.slice(0, 40))); } catch { /* */ } }
function addRecent({ name, path }) {
  if (!path) return;
  let arr = loadRecents().filter((r) => r.path !== path);
  arr.unshift({ name: name || baseName(path), path, at: Date.now() });
  saveRecents(arr);
  if ($('recentsPanel') && !$('recentsPanel').classList.contains('hidden')) renderRecents();
}
function dirOf(p) { return p.replace(/[\\/][^\\/]*$/, ''); }
function renderRecents() {
  const body = $('recentsBody'); if (!body) return;
  const arr = loadRecents();
  if (!arr.length) { body.innerHTML = `<div class="recent-empty">nothing yet</div>`; return; }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  body.innerHTML = arr.map((r, i) => {
    const playBtn = isPlayable(r.path) ? `<button class="recent-play" data-play="${i}" title="Play in app"><span class="ic">${icon('play')}</span></button>` : '';
    return `<div class="recent-row" data-i="${i}"><button class="recent-open" data-open="${i}"><span class="recent-name">${esc(r.name)}</span><span class="recent-loc">${esc(dirOf(r.path))}</span></button>${playBtn}</div>`;
  }).join('');
  injectIcons(body);
  body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => { const r = arr[Number(el.dataset.open)]; if (r) window.api.showItem(r.path); }));
  body.querySelectorAll('[data-play]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const r = arr[Number(el.dataset.play)]; if (r) { openSpecial('youtube'); state.backTo = state.backTo || 'home'; ytPlayFile(r.path, r.name); toggleRecents(false); } }));
}
function toggleRecents(force) {
  const p = $('recentsPanel'); if (!p) return;
  const show = force != null ? force : p.classList.contains('hidden');
  if (show) { renderRecents(); p.classList.remove('hidden'); } else p.classList.add('hidden');
}
function wireRecents() {
  const btn = $('recentsBtn'); if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); toggleRecents(); });
  const clr = $('recentsClear'); if (clr) clr.addEventListener('click', () => { saveRecents([]); renderRecents(); });
  document.addEventListener('click', (e) => { const p = $('recentsPanel'); if (p && !p.classList.contains('hidden') && !p.contains(e.target) && e.target !== $('recentsBtn') && !$('recentsBtn').contains(e.target)) p.classList.add('hidden'); });
}

// ---------- titlebar ----------
function wireTitlebar() {
  $('tbMin').addEventListener('click', () => window.api.winMinimize());
  $('tbMax').addEventListener('click', () => window.api.winMaximize());
  $('tbClose').addEventListener('click', () => window.api.winClose());
}

// ---------- settings + first-run ----------
const PERF_OPTS = [
  ['low', 'Low', 'Gentlest — 1 thread. Slowest, keeps your PC fully responsive.'],
  ['recommended', 'Recommended', 'Balanced — about half your CPU cores. Suggested for most people.'],
  ['full', 'Full', 'Fastest — all cores. Your PC may get hot/loud during big jobs.'],
];
function perfRadios(current, cores, threads) {
  let h = PERF_OPTS.map(([v, l, d]) => `<label class="perf-opt"><input type="radio" name="perf" value="${v}" ${current === v ? 'checked' : ''}/><div><div class="perf-l">${l}</div><div class="perf-d">${d}</div></div></label>`).join('');
  const cur = current === 'custom' ? (threads || 1) : Math.max(1, Math.floor((cores || 4) / 2));
  const customOn = current === 'custom';
  h += `<label class="perf-opt"><input type="radio" name="perf" value="custom" ${customOn ? 'checked' : ''}/><div style="flex:1">
      <div class="perf-l">Custom</div>
      <div class="perf-d">Pick exactly how many CPU threads to use.</div>
      <div class="perf-slider${customOn ? '' : ' hidden'}" id="perfSlider" style="margin-top:10px">
        <input type="range" class="perf-range" id="perfThreads" min="1" max="${cores || 8}" value="${cur}"/>
        <div class="perf-readout"><input type="number" id="perfThreadsN" value="${cur}" min="1" max="${cores || 8}"/><span class="perf-cores">/ ${cores || '?'} threads</span></div>
      </div>
    </div></label>`;
  return h;
}
function dlRadios(cur, customDir) {
  const opts = [['downloads', 'Downloads folder', 'Save everything to your Windows Downloads folder.'], ['source', 'Same as source file', 'Save next to the original file.'], ['custom', 'Custom folder', customDir || 'Pick a folder…']];
  let h = opts.map(([v, l, d]) => `<label class="perf-opt"><input type="radio" name="dl" value="${v}" ${cur === v ? 'checked' : ''}/><div style="flex:1"><div class="perf-l">${l}</div><div class="perf-d" id="${v === 'custom' ? 'dlCustomDesc' : ''}">${d}</div>${v === 'custom' ? '<button class="btn ghost" id="dlPick" style="margin-top:6px">Choose folder…</button>' : ''}</div></label>`).join('');
  return h;
}
// Apply theme + accessibility flags to the document.
function applyClientSettings(s) {
  const theme = s.theme || 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  document.body.classList.toggle('reduce-transparency', !!s.reduceTransparency);
}
async function persist(patch) { state.settings = await window.api.setSettings(patch); applyClientSettings(state.settings); }

const SETTINGS_CATS = [
  ['appearance', 'appearance', 'settings'],
  ['accessibility', 'accessibility', 'user'],
  ['performance', 'performance', 'tools'],
  ['localai', 'local ai', 'tools'],
  ['downloads', 'downloads', 'download'],
  ['updates', 'updates', 'download'],
  ['advanced', 'advanced', 'convert'],
];
// ---------- planned / future updates list (persisted) ----------
// Persisted in localStorage as an array of {text,done}; mirrors favorites/recents.
const PLANNED_KEY = 'mtb_planned';
function loadPlanned() { try { return JSON.parse(localStorage.getItem(PLANNED_KEY)) || []; } catch { return []; } }
function savePlanned(arr) { try { localStorage.setItem(PLANNED_KEY, JSON.stringify((arr || []).slice(0, 200))); } catch { /* */ } }
function addPlanned(text) {
  const t = String(text || '').trim();
  if (!t) return loadPlanned();
  const arr = loadPlanned();
  arr.push({ text: t, done: false });
  savePlanned(arr);
  return arr;
}
function removePlanned(i) { const arr = loadPlanned(); arr.splice(i, 1); savePlanned(arr); return arr; }
function togglePlanned(i) { const arr = loadPlanned(); if (arr[i]) arr[i].done = !arr[i].done; savePlanned(arr); return arr; }
function plannedListHtml(arr) {
  if (!arr.length) return '<div class="set-note">no planned updates yet — add one below.</div>';
  return arr.map((it, i) => `<div class="planned-row ${it.done ? 'done' : ''}" data-i="${i}">
    <label class="planned-check"><input type="checkbox" data-role="done" ${it.done ? 'checked' : ''} /><span></span></label>
    <span class="planned-text">${mtbEsc(it.text)}</span>
    <button class="planned-x" data-role="remove" title="remove" aria-label="remove">${icon('x')}</button>
  </div>`).join('');
}
function renderPlannedList() {
  const host = $('plannedList');
  if (host) host.innerHTML = plannedListHtml(loadPlanned());
}
// ---------- reusable component builders (HTML-string helpers) ----------
function seg(name, cur, opts, wrap) {
  return `<div class="seg ${wrap ? 'seg-wrap' : ''}" data-seg="${name}">${opts.map(([v, l]) => `<button class="seg-btn ${cur === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
function toggleRow(id, label, on, desc) {
  return `<div class="set-row"><div><div class="set-l">${label}</div>${desc ? `<div class="set-d">${desc}</div>` : ''}</div><button class="switch ${on ? 'on' : ''}" id="${id}"><span></span></button></div>`;
}
// Action button row: list of [id, label, iconName, destructive?]
function actionRow(buttons) {
  return `<div class="action-row">${buttons.map(([id, l, ic, danger]) => `<button class="act-btn ${danger ? 'danger' : ''}" id="${id}">${ic ? `<span class="ic">${icon(ic)}</span>` : ''}${l}</button>`).join('')}</div>`;
}
// ---- local ai model rows ----
function fmtModelSize(b) {
  if (!b) return '';
  if (b >= 1e9) return (b / 1e9).toFixed(1).replace(/\.0$/, '') + ' GB';
  return Math.round(b / 1e6) + ' MB';
}
// One row per model: label + size·tier on the left, state + action button right,
// plus a hidden per-row progress bar shown while that model is downloading.
function aiModelRow(feature, m) {
  const installed = m.installed;
  return `<div class="ai-row" data-feature="${feature}" data-id="${m.id}" data-installed="${installed ? '1' : '0'}">
    <div class="ai-row-main">
      <div class="ai-row-top">
        <span class="ai-name">${m.label}</span>
        <span class="ai-state ${installed ? 'on' : ''}" data-role="state">${installed ? 'installed' : 'not installed'}</span>
      </div>
      <div class="ai-meta">${fmtModelSize(m.sizeBytes)} · ${m.tier}</div>
      <div class="ai-bar hidden" data-role="bar"><span data-role="fill"></span></div>
    </div>
    <button class="act-btn ${installed ? 'danger' : ''}" data-role="btn">${installed ? 'remove' : 'download'}</button>
  </div>`;
}
// Human-readable heading per managed feature, shown above its model rows.
const AI_FEATURE_LABELS = {
  whisper: 'transcription models',
  bgremoval: 'background removal models',
  tts: 'text-to-speech voices',
};
function renderAiModels(status) {
  const host = $('aiModels');
  if (!host) return;
  const features = status && typeof status === 'object' ? Object.keys(status) : [];
  if (!features.length) { host.innerHTML = '<div class="set-note">No models available.</div>'; return; }
  host.innerHTML = features.map((feature) => {
    const list = status[feature] || [];
    if (!list.length) return '';
    const label = AI_FEATURE_LABELS[feature] || feature;
    return `<div class="ai-feature">
      <h4 class="ai-feature-h">${mtbEsc(label)}</h4>
      ${list.map((m) => aiModelRow(feature, m)).join('')}
    </div>`;
  }).join('');
  wireAiModelRows();
}
// Wire each row's download/remove button + keep references for progress updates.
function wireAiModelRows() {
  document.querySelectorAll('#aiModels .ai-row').forEach((row) => {
    const feature = row.dataset.feature, id = row.dataset.id;
    const btn = row.querySelector('[data-role="btn"]');
    if (!btn || btn._wired) return; btn._wired = true;
    btn.addEventListener('click', async () => {
      const isInstalled = row.querySelector('[data-role="state"]').classList.contains('on');
      if (isInstalled) {
        if (!(await confirmModal('Remove model?', 'This deletes the downloaded model file. You can download it again later.'))) return;
        const ok = await window.api.aimodels.remove(feature, id);
        if (ok) { setAiRowInstalled(row, false); toast('Model removed'); }
        else toast('Could not remove model', { kind: 'error' });
        return;
      }
      // Download (requires internet).
      if (isOffline()) { toast("You're offline — connect to the internet to download.", { kind: 'error' }); return; }
      const bar = row.querySelector('[data-role="bar"]');
      const fill = row.querySelector('[data-role="fill"]');
      btn.disabled = true; btn.textContent = 'downloading…';
      bar.classList.remove('hidden'); fill.style.width = '0%';
      row.querySelector('[data-role="state"]').textContent = 'downloading…';
      try {
        await window.api.aimodels.download(feature, id);
        setAiRowInstalled(row, true);
        toast('Model downloaded');
      } catch (e) {
        row.querySelector('[data-role="state"]').textContent = 'not installed';
        btn.disabled = false; btn.textContent = 'download'; btn.className = 'act-btn';
        toast('Download failed: ' + ((e && e.message) || e), { kind: 'error' });
      } finally {
        bar.classList.add('hidden');
      }
    });
  });
}
function setAiRowInstalled(row, installed) {
  const state = row.querySelector('[data-role="state"]');
  const btn = row.querySelector('[data-role="btn"]');
  row.dataset.installed = installed ? '1' : '0';
  state.classList.toggle('on', installed);
  state.textContent = installed ? 'installed' : 'not installed';
  btn.disabled = false;
  btn.textContent = installed ? 'remove' : 'download';
  btn.className = 'act-btn' + (installed ? ' danger' : '');
}

function settingsHtml(cat, s) {
  if (cat === 'appearance') return `
    <h3 class="set-h">theme</h3>
    ${seg('theme', s.theme, [['auto', 'auto'], ['light', 'light'], ['dark', 'dark']])}
    <p class="set-note">auto theme switches between light and dark themes depending on your device's display mode.</p>`;

  if (cat === 'accessibility') return `
    <h3 class="set-h">visual</h3>
    ${toggleRow('setMotion', 'reduce motion', s.reduceMotion, 'animations and transitions will be disabled whenever possible.')}
    ${toggleRow('setTransp', 'reduce visual transparency', s.reduceTransparency, 'transparency of surfaces is reduced and blur effects are disabled. may also improve UI performance on less powerful devices.')}`;

  if (cat === 'performance') return `
    <h3 class="set-h">cpu usage limit</h3>
    <div class="perf-list">${perfRadios(s.performance, s.cores, s.threads)}</div>
    <p class="set-note">${s.cores} cores detected. this caps how hard the app pushes your CPU during encoding.</p>`;

  if (cat === 'localai') {
    const caps = state.caps || {};
    const whisperReady = caps.hasWhisper;
    const bgReady = caps.hasBgRemoval;
    const upscalerReady = caps.hasRealesrgan;
    const piperReady = caps.hasPiper;
    return `
    <h3 class="set-h">on-device models</h3>
    <p class="set-note">download models for the local AI tools (transcription, background removal). models run entirely on your device — nothing is uploaded. larger models are slower but more accurate. you can remove any model to free up disk space.</p>
    <div class="ai-engine">
      <span class="ai-dot ${whisperReady ? 'on' : 'off'}"></span>
      <span>whisper engine — ${whisperReady ? 'engine ready' : 'not found'}</span>
    </div>
    <div class="ai-engine">
      <span class="ai-dot ${bgReady ? 'on' : 'off'}"></span>
      <span>background removal engine — ${bgReady ? 'engine ready' : 'not found'}</span>
    </div>
    <div class="ai-engine">
      <span class="ai-dot ${upscalerReady ? 'on' : 'off'}"></span>
      <span>upscaler (Real-ESRGAN) — ${upscalerReady ? 'bundled · ready (no download needed)' : 'not found'}</span>
    </div>
    <div class="ai-engine">
      <span class="ai-dot ${piperReady ? 'on' : 'off'}"></span>
      <span>piper engine (text-to-speech) — ${piperReady ? 'engine ready' : 'not found'}</span>
    </div>
    <div class="ai-models" id="aiModels"><div class="set-note">loading models…</div></div>`;
  }

  if (cat === 'downloads') return `
    <h3 class="set-h">default download location</h3>
    <div class="perf-list">${dlRadios(s.downloadLocation, s.customDownloadDir)}</div>
    <p class="set-note">where converted, compressed, and downloaded files are saved by default. you can still override the output folder per job.</p>`;

  if (cat === 'updates') {
    const ver = s.appVersion || (state.caps && state.caps.appVersion) || '1.0.0';
    const hasCheck = typeof checkForUpdate === 'function';
    return `
    <h3 class="set-h">current version</h3>
    <div class="set-note">media toolbox v${mtbEsc(ver)}</div>
    ${hasCheck
      ? actionRow([['setCheckUpdate', 'check for updates', 'download']]) + '<p class="set-note">checks GitHub for a newer release. you\'ll be notified in-app if one is available.</p>'
      : '<p class="set-note">you\'re running the latest bundled version.</p>'}
    <h3 class="set-h">planned / future updates</h3>
    <p class="set-note">jot down features and improvements you want to build. saved on this device.</p>
    <div class="planned-add">
      <input type="text" id="plannedInput" class="planned-input" placeholder="add a planned update…" maxlength="200" />
      <button class="act-btn" id="plannedAdd"><span class="ic">${icon('plus')}</span>add</button>
    </div>
    <div class="planned-list" id="plannedList">${plannedListHtml(loadPlanned())}</div>`;
  }

  if (cat === 'advanced') return `
    <div class="set-advanced">
    <h3 class="set-h">network</h3>
    ${toggleRow('setOffline', 'offline mode', s.offlineMode, "Disables the app's internet features (downloader, model downloads). On-device tools keep working. (This doesn't change your system Wi-Fi.)")}
    <h3 class="set-h">about</h3>
    <div class="set-note">media toolbox v${s.appVersion || (state.caps && state.caps.appVersion) || '1.0.0'}</div>
    <h3 class="set-h">settings data</h3>
    ${actionRow([['setReset', 'reset all settings', 'trash', true]])}
    <p class="set-note">reset all settings back to their default values.</p>
    <h3 class="set-h">local storage</h3>
    ${actionRow([['setClearCache', 'clear cache', 'trash', true]])}
    <p class="set-note">clears locally stored app cache/data. this is a destructive action.</p>
    <h3 class="set-h">debug</h3>
    ${actionRow([['setDevTools', 'open developer tools', 'search'], ['setDiag', 'copy diagnostics', 'download']])}
    <p class="set-note">developer tools open chromium devtools for troubleshooting. copy diagnostics puts app version, available binaries, and key paths on your clipboard.</p>
    </div>`;

  return '';
}
// Generic segmented-control wiring → persist patch under given key.
function wireSeg(name, key, after) {
  const sg = document.querySelector(`[data-seg="${name}"]`);
  if (!sg) return;
  sg.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    sg.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    persist({ [key]: b.dataset.v });
    if (after) after(b.dataset.v);
  }));
}
function wireToggle(id, key, after) {
  const el = $(id); if (!el) return;
  el.addEventListener('click', () => { el.classList.toggle('on'); const on = el.classList.contains('on'); persist({ [key]: on }); if (after) after(on); });
}
function wireSelect(id, key) {
  const el = $(id); if (!el) return;
  el.addEventListener('change', () => persist({ [key]: el.value }));
}
// Small confirmation modal helper. Returns a Promise<boolean>.
function confirmModal(title, body) {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent = body;
    const modal = $('confirmModal');
    const ok = $('confirmOk'), cancel = $('confirmCancel');
    const done = (val) => { modal.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(val); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    modal.classList.remove('hidden');
  });
}
function wireSettingsCat(cat, s) {
  if (cat === 'appearance') {
    wireSeg('theme', 'theme');
  } else if (cat === 'accessibility') {
    wireToggle('setMotion', 'reduceMotion');
    wireToggle('setTransp', 'reduceTransparency');
  } else if (cat === 'performance') {
    syncPair('perfThreads', 'perfThreadsN');
    const toggleSlider = (v) => { const sl = $('perfSlider'); if (sl) sl.classList.toggle('hidden', v !== 'custom'); };
    document.querySelectorAll('#settingsContent input[name="perf"]').forEach((r) => r.addEventListener('change', () => { const v = r.value; toggleSlider(v); persist(v === 'custom' ? { performance: 'custom', threads: Number(($('perfThreadsN') || {}).value) || 1 } : { performance: v }); }));
    const tn = $('perfThreadsN'); if (tn) tn.addEventListener('change', () => { const r = document.querySelector('#settingsContent input[name="perf"][value="custom"]'); if (r) r.checked = true; toggleSlider('custom'); persist({ performance: 'custom', threads: Number(tn.value) || 1 }); });
  } else if (cat === 'localai') {
    // Register a single progress listener once; it routes per-model events to
    // the matching row's bar (rows may re-render, so we look them up live).
    if (!state._aiProgressWired) {
      state._aiProgressWired = true;
      window.api.aimodels.onProgress((p) => {
        if (!p) return;
        const row = document.querySelector(`#aiModels .ai-row[data-feature="${p.feature}"][data-id="${p.id}"]`);
        if (!row) return;
        const bar = row.querySelector('[data-role="bar"]');
        const fill = row.querySelector('[data-role="fill"]');
        const st = row.querySelector('[data-role="state"]');
        if (bar) bar.classList.remove('hidden');
        if (fill) fill.style.width = `${(p.percent || 0).toFixed(1)}%`;
        if (st) st.textContent = `downloading… ${(p.percent || 0).toFixed(0)}%`;
      });
    }
    window.api.aimodels.list().then(renderAiModels).catch(() => {
      const host = $('aiModels'); if (host) host.innerHTML = '<div class="set-warn">Could not load models.</div>';
    });
  } else if (cat === 'downloads') {
    document.querySelectorAll('#settingsContent input[name="dl"]').forEach((r) => r.addEventListener('change', () => persist({ downloadLocation: r.value })));
    const pick = $('dlPick'); if (pick) pick.addEventListener('click', async (e) => { e.preventDefault(); const d = await window.api.pickOutputDir(); if (d) { state._customDir = d; $('dlCustomDesc').textContent = d; const r = document.querySelector('#settingsContent input[name="dl"][value="custom"]'); if (r) r.checked = true; persist({ downloadLocation: 'custom', customDownloadDir: d }); } });
  } else if (cat === 'updates') {
    const chk = $('setCheckUpdate');
    if (chk) chk.addEventListener('click', async () => {
      if (isOffline()) { toast("You're offline — connect to the internet to check for updates.", { kind: 'error' }); return; }
      chk.disabled = true;
      try { await checkForUpdate(); toast('Checked for updates'); }
      finally { chk.disabled = false; }
    });
    const input = $('plannedInput');
    const addBtn = $('plannedAdd');
    const commitAdd = () => {
      if (!input) return;
      if (!input.value.trim()) return;
      addPlanned(input.value);
      input.value = '';
      renderPlannedList();
      input.focus();
    };
    if (addBtn) addBtn.addEventListener('click', commitAdd);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } });
    const list = $('plannedList');
    if (list) list.addEventListener('click', (e) => {
      const row = e.target.closest('.planned-row'); if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-role="remove"]')) { removePlanned(i); renderPlannedList(); }
    });
    if (list) list.addEventListener('change', (e) => {
      if (!e.target.matches('[data-role="done"]')) return;
      const row = e.target.closest('.planned-row'); if (!row) return;
      togglePlanned(Number(row.dataset.i)); renderPlannedList();
    });
  } else if (cat === 'advanced') {
    // Manual "offline mode" toggle — app-level only; immediately re-apply the offline UI.
    wireToggle('setOffline', 'offlineMode', () => applyOnlineState());
    $('setReset').addEventListener('click', async () => {
      if (!(await confirmModal('Reset all settings?', 'This will restore every setting to its default value.'))) return;
      state.settings = await window.api.resetSettings();
      applyClientSettings(state.settings);
      toast('Settings reset');
      openSettings('appearance');
    });
    $('setClearCache').addEventListener('click', async () => {
      if (!(await confirmModal('Clear cache?', 'This will remove locally stored cached data.'))) return;
      await window.api.clearCache();
      toast('Cache cleared');
    });
    $('setDevTools').addEventListener('click', () => { window.api.openDevTools(); });
    $('setDiag').addEventListener('click', async () => {
      const c = state.caps || {};
      const lines = [
        `media toolbox v${c.appVersion || s.appVersion || '1.0.0'}`,
        `platform: ${navigator.platform}`,
        `ffmpeg: ${c.ffmpeg ? 'available' : 'missing'}`,
        `ffprobe: ${c.ffprobe ? 'available' : 'missing'}`,
        `ytdlp: ${c.ytdlp ? 'available' : 'missing'}`,
        `exiftool: ${c.exiftool ? 'available' : 'missing'}`,
        c.paths ? `paths: ${JSON.stringify(c.paths)}` : '',
      ].filter(Boolean);
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('Diagnostics copied'); }
      catch { toast('Could not copy diagnostics', { kind: 'error' }); }
    });
  }
  enhanceSelects($('settingsContent'));
}
async function openSettings(initial) {
  const s = await window.api.getSettings();
  state._customDir = s.customDownloadDir || '';
  const cat = initial || 'appearance';
  $('settingsBody').innerHTML = `<div class="settings-pane">
    <nav class="settings-nav">${SETTINGS_CATS.map(([id, label, ic]) => `<button class="set-cat ${id === cat ? 'on' : ''}" data-cat="${id}"><span class="ic">${icon(ic)}</span> ${label}</button>`).join('')}</nav>
    <div class="settings-content" id="settingsContent"></div></div>`;
  const renderCat = (c) => { $('settingsContent').innerHTML = settingsHtml(c, s); wireSettingsCat(c, s); };
  $('settingsBody').querySelectorAll('.set-cat').forEach((b) => b.addEventListener('click', () => { $('settingsBody').querySelectorAll('.set-cat').forEach((x) => x.classList.remove('on')); b.classList.add('on'); renderCat(b.dataset.cat); }));
  renderCat(cat);
  $('settingsModal').classList.remove('hidden');
}
async function maybeFirstRun() {
  state.settings = await window.api.getSettings();
  applyClientSettings(state.settings);
  if (state.settings.firstRun) {
    $('setupBody').innerHTML = `<div class="perf-list">${perfRadios(state.settings.performance, state.settings.cores, state.settings.threads)}</div>`;
    syncPair('perfThreads', 'perfThreadsN');
    $('setupModal').classList.remove('hidden');
  }
}
async function finishSetup() {
  const sel = document.querySelector('#setupBody input[name="perf"]:checked');
  state.settings = await window.api.setSettings({ performance: sel ? sel.value : 'recommended', firstRun: false });
  $('setupModal').classList.add('hidden');
}

// ---------- Stretch tool (live preview) ----------
const STRETCH_PRESETS = [
  ['TikTok / Reels / Shorts (9:16)', 1080, 1920],
  ['YouTube (16:9)', 1920, 1080],
  ['Square (1:1)', 1080, 1080],
  ['Portrait 4:5', 1080, 1350],
  ['Classic 4:3', 1440, 1080],
  ['Custom', 0, 0],
];
const stretch = { path: null, meta: null };
function openStretch() {
  hideAll(); state.section = 'tools'; state.ws = null;
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Stretch Video';
  setHero('Stretch Video', 'Squeeze a video to a new resolution — live preview, then render');
  $('stPreset').innerHTML = STRETCH_PRESETS.map(([l, w, h], i) => `<option value="${i}">${l}</option>`).join('');
  if ($('stPreset')._csRender) $('stPreset')._csRender();
  $('stretchPanel').classList.remove('hidden');
  applyStretchPreview();
}
function applyStretchPreview() {
  const w = Number($('stW').value) || 1080, h = Number($('stH').value) || 1920;
  const v = $('stVideo');
  // Force the element's box to the target aspect; object-fit:fill squeezes content.
  const maxH = 360; const scale = Math.min(1, maxH / h);
  v.style.width = (w * scale) + 'px'; v.style.height = (h * scale) + 'px'; v.style.objectFit = 'fill';
}
function wireStretch() {
  $('stLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths.length) return;
    stretch.path = paths[0]; $('stName').textContent = baseName(paths[0]);
    try { stretch.meta = await window.api.probe(paths[0], 'videoop'); } catch { stretch.meta = null; }
    const v = $('stVideo'); v.src = 'file:///' + paths[0].replace(/\\/g, '/'); v.play().catch(() => {});
    $('stRender').disabled = false; applyStretchPreview();
  });
  $('stPreset').addEventListener('change', () => {
    const [, w, h] = STRETCH_PRESETS[Number($('stPreset').value)];
    if (w > 0) { $('stW').value = w; $('stH').value = h; }
    applyStretchPreview();
  });
  ['stW', 'stH'].forEach((id) => $(id).addEventListener('input', applyStretchPreview));
  $('stRender').addEventListener('click', async () => {
    if (!stretch.path) return;
    const w = Number($('stW').value) || 1080, h = Number($('stH').value) || 1920;
    $('stRender').disabled = true; $('stProgress').classList.remove('hidden'); $('stBar').style.width = '0%'; $('stStatus').textContent = 'Rendering…'; $('stStatus').className = 'fr-status';
    const jobId = uid();
    try {
      await window.api.startJob({ jobId, mediaType: 'videoop', inputPath: stretch.path, settings: { op: 'stretch', outputFormat: 'mp4', stretchW: w, stretchH: h }, meta: stretch.meta || { durationSec: 0, video: {} }, outputDir: state.outputDir, convert: true });
      state._stretchJob = jobId;
    } catch (e) { $('stStatus').textContent = 'Error: ' + (e.message || e); $('stStatus').className = 'fr-status error'; $('stRender').disabled = false; }
  });
}

// ---------- FPS Changer (preview before export) ----------
// Renders to a temp cache file the user can preview inline, then exports a copy
// to the chosen output dir. Lazy-wired on first open (like Batch Rename).
const fpsState = { path: null, tempPath: null, wired: false };
function openFpsPreview() {
  hideAll(); state.section = 'tools'; state.ws = null;
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'FPS Changer';
  setHero('FPS Changer', 'Change frame rate — render a preview, watch it, then export');
  $('fpsPanel').classList.remove('hidden');
  if (!fpsState.wired) { wireFpsPreview(); fpsState.wired = true; }
}
function wireFpsPreview() {
  // Live progress for the temp render.
  window.api.onFpsProgress((d) => {
    if (!d) return;
    $('fpsProgress').classList.remove('hidden');
    if (d.indeterminate) { $('fpsBar').classList.add('indet'); $('fpsStatus').textContent = 'Rendering…'; }
    else { $('fpsBar').classList.remove('indet'); $('fpsBar').style.width = `${(d.percent || 0).toFixed(1)}%`; $('fpsStatus').textContent = `Rendering… ${(d.percent || 0).toFixed(0)}%`; }
    $('fpsStatus').className = 'fr-status';
  });
  $('fpsLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    fpsState.path = paths[0]; fpsState.tempPath = null;
    $('fpsName').textContent = baseName(paths[0]);
    const v = $('fpsVideo'); v.src = 'file:///' + paths[0].replace(/\\/g, '/'); v.play().catch(() => {});
    $('fpsRender').disabled = false; $('fpsExport').disabled = true;
    $('fpsProgress').classList.add('hidden'); $('fpsStatus').textContent = '';
  });
  $('fpsRender').addEventListener('click', async () => {
    if (!fpsState.path) return;
    const fps = Math.min(240, Math.max(1, Number($('fpsValue').value) || 60));
    const interpolate = $('fpsInterp').checked;
    $('fpsRender').disabled = true; $('fpsExport').disabled = true;
    $('fpsProgress').classList.remove('hidden'); $('fpsBar').classList.remove('indet'); $('fpsBar').style.width = '0%';
    $('fpsStatus').textContent = 'Rendering…'; $('fpsStatus').className = 'fr-status';
    try {
      const { tempPath } = await window.api.fpsRender({ inputPath: fpsState.path, fps, interpolate });
      fpsState.tempPath = tempPath;
      const v = $('fpsVideo'); v.src = 'file:///' + tempPath.replace(/\\/g, '/') + '?t=' + Date.now(); v.play().catch(() => {});
      $('fpsBar').classList.remove('indet'); $('fpsBar').style.width = '100%';
      $('fpsStatus').textContent = 'Preview ready — review, then export'; $('fpsStatus').className = 'fr-status done'; $('fpsStatus').onclick = null;
      $('fpsExport').disabled = false;
    } catch (e) {
      $('fpsStatus').textContent = 'Error: ' + ((e && e.message) || e); $('fpsStatus').className = 'fr-status error';
    } finally { $('fpsRender').disabled = false; }
  });
  $('fpsExport').addEventListener('click', async () => {
    if (!fpsState.tempPath) return;
    $('fpsExport').disabled = true;
    try {
      const res = await window.api.fpsExport({ tempPath: fpsState.tempPath, outputDir: state.outputDir });
      $('fpsStatus').textContent = `Exported (${fmtBytes(res.outSize)}) — click to open`; $('fpsStatus').className = 'fr-status done';
      $('fpsStatus').onclick = () => window.api.showItem(res.outputPath);
      toast('FPS export complete', { path: res.outputPath });
      try { addRecent({ path: res.outputPath }); } catch { /* */ }
    } catch (e) {
      $('fpsStatus').textContent = 'Error: ' + ((e && e.message) || e); $('fpsStatus').className = 'fr-status error';
    } finally { $('fpsExport').disabled = false; }
  });
}

// Re-query installed models and refresh any AI surface currently on screen:
// the open AI tool's model dropdown / "no model" notice, and the Settings →
// Local AI manager rows. Called on the aimodel:changed broadcast so installing
// (or removing) a model in Settings takes effect in the tools with no restart.
function refreshAiModelState() {
  try {
    if (!$('transcribePanel').classList.contains('hidden')) trRefreshModels();
  } catch { /* */ }
  try {
    if (!$('removebgPanel').classList.contains('hidden')) rbRefreshModels();
  } catch { /* */ }
  try {
    if (!$('ttsPanel').classList.contains('hidden')) ttsRefreshVoices();
  } catch { /* */ }
  // Settings manager (only present while the Local AI tab is rendered).
  try {
    const host = $('aiModels');
    if (host && window.api.aimodels) {
      window.api.aimodels.list().then(renderAiModels).catch(() => { /* */ });
    }
  } catch { /* */ }
}

// ---------- AI Tools hub ----------
// A simple on-brand landing for the three local AI tools (delisted from the
// Tools accordion). Cards route into each tool with state.backTo='ai' so Back
// returns here; Back from the hub itself (toolHeader) goes Home.
let _aiHubWired = false;
function openAiHub() {
  hideAll(); state.section = 'ai'; state.ws = null;
  state.currentTool = null; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'AI Tools';
  setHero('AI Tools', 'On-device AI — transcribe, upscale and cut out backgrounds, all locally');
  $('aiHubPanel').classList.remove('hidden');
  // Back from the hub returns Home.
  state.backTo = 'home';
  if (!_aiHubWired) {
    _aiHubWired = true;
    $('aiHubPanel').querySelectorAll('.home-card[data-ai]').forEach((card) => {
      card.addEventListener('click', () => {
        state.backTo = 'ai';
        const which = card.dataset.ai;
        if (which === 'transcribe') openTranscribe();
        else if (which === 'upscale') openUpscaleAi();
        else if (which === 'removebg') openRemoveBg();
        else if (which === 'tts') openTts();
      });
    });
  }
  injectIcons($('aiHubPanel'));
}

// ---------- Subtitle / Transcript Extractor (whisper) ----------
// Lazy-wired on first open. Model dropdown is filled from window.api.aimodels.list()
// showing only INSTALLED whisper models; if none, a notice is shown and Run is disabled.
const trState = { path: null, wired: false };
// Show a small delete (trash) button next to an AI tool's status line. Clicking
// it removes the produced file via window.api.deleteFile, then greys the result
// area and hides the button. `statusId` is the .fr-status element id.
function aiResultDelete(statusId, outputPath) {
  const status = $(statusId);
  if (!status || !outputPath) return;
  const wrap = status.parentElement; if (!wrap) return;
  let btn = wrap.querySelector('.ai-del');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'ai-del';
    btn.type = 'button';
    btn.title = 'Delete this file';
    btn.innerHTML = `<span class="ic">${icon('trash')}</span>`;
    wrap.appendChild(btn);
  }
  btn.classList.remove('hidden');
  btn.onclick = async (e) => {
    e.stopPropagation();
    try {
      await window.api.deleteFile(outputPath);
      status.textContent = 'Deleted';
      status.className = 'fr-status muted';
      status.onclick = null;
      btn.classList.add('hidden');
      toast('File deleted');
    } catch (err) {
      toast('Could not delete: ' + ((err && err.message) || err), { kind: 'error' });
    }
  };
}
function aiResultDeleteHide(statusId) {
  const status = $(statusId); if (!status || !status.parentElement) return;
  const btn = status.parentElement.querySelector('.ai-del');
  if (btn) btn.classList.add('hidden');
}

async function openTranscribe() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'transcribe', label: 'Subtitle / Transcript Extractor' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Subtitle / Transcript Extractor';
  setHero('Subtitle / Transcript Extractor', 'Local speech-to-text — generate SRT, TXT or VTT from any video or audio');
  $('transcribePanel').classList.remove('hidden');
  if (!trState.wired) { wireTranscribe(); trState.wired = true; }
  enhanceSelects($('transcribePanel'));
  await trRefreshModels();
}
async function trRefreshModels() {
  const sel = $('trModel');
  const engineOk = !state.caps || state.caps.hasWhisper !== false;
  let installed = [];
  try {
    const all = (window.api.aimodels && await window.api.aimodels.list()) || [];
    const list = Array.isArray(all) ? all : (all.whisper || all.models || []);
    installed = list.filter((m) => (m.feature === 'whisper' || m.kind === 'whisper' || !m.feature) && (m.installed || m.isInstalled));
  } catch { installed = []; }
  const none = !engineOk || !installed.length;
  $('trNoModel').classList.toggle('hidden', !none);
  $('trNoModel').textContent = !engineOk
    ? 'Transcription engine (whisper) isn’t available in this build.'
    : 'No transcription model — download one in Settings → Local AI.';
  if (none) {
    sel.innerHTML = '<option value="">— none installed —</option>';
  } else {
    sel.innerHTML = installed.map((m) => `<option value="${mtbEsc(m.id)}">${mtbEsc(m.label || m.name || m.id)}</option>`).join('');
  }
  if (sel._csRender) sel._csRender();
  trUpdateRun();
}
function trUpdateRun() {
  const hasModel = !!($('trModel').value);
  const anyFmt = $('trFmtSrt').checked || $('trFmtTxt').checked || $('trFmtVtt').checked;
  $('trRun').disabled = !(trState.path && hasModel && anyFmt);
}
function wireTranscribe() {
  window.api.onAiTranscribeProgress((d) => {
    if (!d) return;
    $('trProgress').classList.remove('hidden');
    if (d.stage === 'extract') { $('trBar').classList.add('indet'); $('trStatus').textContent = 'Extracting audio…'; }
    else if (d.indeterminate) { $('trBar').classList.add('indet'); $('trStatus').textContent = 'Transcribing…'; }
    else { $('trBar').classList.remove('indet'); $('trBar').style.width = `${(d.percent || 0).toFixed(1)}%`; $('trStatus').textContent = `Transcribing… ${(d.percent || 0).toFixed(0)}%`; }
    $('trStatus').className = 'fr-status';
  });
  $('trLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    trState.path = paths[0]; $('trName').textContent = baseName(paths[0]);
    $('trProgress').classList.add('hidden'); $('trStatus').textContent = '';
    trUpdateRun();
  });
  $('trModel').addEventListener('change', trUpdateRun);
  // The "no model" notice is a shortcut to the model manager.
  const trNotice = $('trNoModel');
  if (trNotice) { trNotice.classList.add('clickable'); trNotice.addEventListener('click', () => openSettings('localai')); }
  ['trFmtSrt', 'trFmtTxt', 'trFmtVtt'].forEach((id) => $(id).addEventListener('change', trUpdateRun));
  $('trRun').addEventListener('click', async () => {
    if (!trState.path) return;
    const modelId = $('trModel').value; if (!modelId) return;
    const formats = [];
    if ($('trFmtSrt').checked) formats.push('srt');
    if ($('trFmtTxt').checked) formats.push('txt');
    if ($('trFmtVtt').checked) formats.push('vtt');
    if (!formats.length) return;
    $('trRun').disabled = true;
    $('trProgress').classList.remove('hidden'); $('trBar').classList.add('indet');
    $('trStatus').textContent = 'Extracting audio…'; $('trStatus').className = 'fr-status'; $('trStatus').onclick = null;
    aiResultDeleteHide('trStatus');
    try {
      const res = await window.api.aiTranscribe({ inputPath: trState.path, modelId, lang: $('trLang').value, formats, outputDir: state.outputDir });
      $('trBar').classList.remove('indet'); $('trBar').style.width = '100%';
      const first = res.outputs[0];
      const label = res.outputs.map((o) => o.ext.toUpperCase()).join(' + ');
      $('trStatus').textContent = `Saved ${label} — click to open`; $('trStatus').className = 'fr-status done';
      $('trStatus').onclick = () => window.api.showItem(first.path);
      aiResultDelete('trStatus', first.path);
      toast('Transcript ready', { path: first.path });
      try { addRecent({ path: first.path }); } catch { /* */ }
    } catch (e) {
      $('trBar').classList.remove('indet');
      $('trStatus').textContent = 'Error: ' + ((e && e.message) || e); $('trStatus').className = 'fr-status error';
    } finally { trUpdateRun(); }
  });
}

// ---------- Text to Speech (Piper) ----------
// Lazy-wired on first open. Voice dropdown is filled from window.api.aimodels.list()
// showing only INSTALLED tts voices; if none, a notice links to the model manager.
// Generation runs on-device (works offline); only voice downloads need the network.
const ttsState = { wired: false };
async function openTts() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'tts', label: 'Text to Speech' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Text to Speech';
  setHero('Text to Speech', 'On-device narration with Piper voices — export WAV or MP3, fully offline');
  $('ttsPanel').classList.remove('hidden');
  if (!ttsState.wired) { wireTts(); ttsState.wired = true; }
  enhanceSelects($('ttsPanel'));
  const engineOk = !state.caps || state.caps.hasPiper !== false;
  $('ttsNoEngine').classList.toggle('hidden', engineOk);
  await ttsRefreshVoices();
}
async function ttsRefreshVoices() {
  const sel = $('ttsVoice');
  const engineOk = !state.caps || state.caps.hasPiper !== false;
  let installed = [];
  try {
    const all = (window.api.aimodels && await window.api.aimodels.list()) || [];
    const list = Array.isArray(all)
      ? all.filter((m) => m.feature === 'tts' || m.kind === 'tts')
      : (all.tts || []);
    installed = (list || []).filter((m) => m && (m.installed === true || m.isInstalled === true));
  } catch { installed = []; }
  // The no-voice notice only shows when the engine itself is OK (otherwise the
  // engine notice covers it).
  $('ttsNoModel').classList.toggle('hidden', !(engineOk && !installed.length));
  if (!engineOk || !installed.length) {
    sel.innerHTML = '<option value="">— none installed —</option>';
  } else {
    sel.innerHTML = installed.map((m) => `<option value="${mtbEsc(m.id)}">${mtbEsc(m.label || m.id)}</option>`).join('');
  }
  if (sel._csRender) sel._csRender();
  ttsUpdateRun();
}
function ttsUpdateRun() {
  const engineOk = !state.caps || state.caps.hasPiper !== false;
  const hasVoice = !!($('ttsVoice').value);
  const hasText = !!($('ttsText').value.trim());
  $('ttsRun').disabled = !(engineOk && hasVoice && hasText);
}
function wireTts() {
  window.api.onAiTtsProgress((d) => {
    if (!d) return;
    $('ttsProgress').classList.remove('hidden'); $('ttsBar').classList.add('indet');
    $('ttsStatus').textContent = d.stage === 'encode' ? 'Encoding MP3…' : 'Synthesizing speech…';
    $('ttsStatus').className = 'fr-status';
  });
  $('ttsText').addEventListener('input', ttsUpdateRun);
  $('ttsVoice').addEventListener('change', ttsUpdateRun);
  // The "no voice" notice is a shortcut to the model manager.
  const ttsNotice = $('ttsNoModel');
  if (ttsNotice) { ttsNotice.classList.add('clickable'); ttsNotice.addEventListener('click', () => openSettings('localai')); }
  $('ttsRun').addEventListener('click', async () => {
    const text = $('ttsText').value.trim(); if (!text) return;
    const voiceId = $('ttsVoice').value; if (!voiceId) return;
    const format = $('ttsFormat').value || 'wav';
    $('ttsRun').disabled = true;
    $('ttsProgress').classList.remove('hidden'); $('ttsBar').classList.add('indet');
    $('ttsStatus').textContent = 'Synthesizing speech…'; $('ttsStatus').className = 'fr-status'; $('ttsStatus').onclick = null;
    aiResultDeleteHide('ttsStatus');
    try {
      const res = await window.api.aiTts({ text, voiceId, format, outputDir: state.outputDir });
      $('ttsBar').classList.remove('indet'); $('ttsBar').style.width = '100%';
      $('ttsStatus').textContent = `Saved (${fmtBytes(res.outSize)}) — click to open`; $('ttsStatus').className = 'fr-status done';
      $('ttsStatus').onclick = () => window.api.showItem(res.outputPath);
      aiResultDelete('ttsStatus', res.outputPath);
      toast('Speech ready', { path: res.outputPath });
      try { addRecent({ path: res.outputPath }); } catch { /* */ }
    } catch (e) {
      $('ttsBar').classList.remove('indet');
      $('ttsStatus').textContent = 'Error: ' + ((e && e.message) || e); $('ttsStatus').className = 'fr-status error';
    } finally { ttsUpdateRun(); }
  });
}

// ---------- AI Image Upscaler (Real-ESRGAN) ----------
const upState = { path: null, wired: false };
function openUpscaleAi() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'image-upscaler-ai', label: 'AI Image Upscaler' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'AI Image Upscaler';
  setHero('AI Image Upscaler', 'Real-ESRGAN super-resolution — enlarge and enhance images locally');
  $('upscalePanel').classList.remove('hidden');
  if (!upState.wired) { wireUpscaleAi(); upState.wired = true; }
  enhanceSelects($('upscalePanel'));
  const engineOk = !state.caps || state.caps.hasRealesrgan !== false;
  $('upNoEngine').classList.toggle('hidden', engineOk);
  upUpdateScale();
  upUpdateRun();
}
function upUpdateScale() {
  // x4plus models are x4-native; force scale 4 and lock the control for them.
  const model = $('upModel').value;
  const sel = $('upScale');
  const fixed = model !== 'realesr-animevideov3';
  if (fixed) {
    sel.value = '4';
    [...sel.options].forEach((o) => { o.disabled = o.value !== '4'; });
    $('upScaleHint').textContent = 'This model upscales 4× natively. Switch to “Anime fast” for 2× / 3×.';
  } else {
    [...sel.options].forEach((o) => { o.disabled = false; });
    $('upScaleHint').textContent = 'animevideov3 supports 2× / 3× / 4×.';
  }
  if (sel._csRender) sel._csRender();
}
function upUpdateRun() {
  const engineOk = !state.caps || state.caps.hasRealesrgan !== false;
  $('upRun').disabled = !(upState.path && engineOk);
}
function wireUpscaleAi() {
  window.api.onAiUpscaleProgress((d) => {
    if (!d) return;
    $('upProgress').classList.remove('hidden');
    if (d.indeterminate) { $('upBar').classList.add('indet'); $('upStatus').textContent = d.retry === 'cpu' ? 'GPU failed — retrying on CPU…' : 'Upscaling…'; }
    else { $('upBar').classList.remove('indet'); $('upBar').style.width = `${(d.percent || 0).toFixed(1)}%`; $('upStatus').textContent = `Upscaling… ${(d.percent || 0).toFixed(0)}%`; }
    $('upStatus').className = 'fr-status';
  });
  $('upLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    upState.path = paths[0]; $('upName').textContent = baseName(paths[0]);
    const img = $('upPreview'); img.src = 'file:///' + paths[0].replace(/\\/g, '/'); img.classList.remove('hidden');
    $('upProgress').classList.add('hidden'); $('upStatus').textContent = '';
    upUpdateRun();
  });
  $('upModel').addEventListener('change', () => { upUpdateScale(); upUpdateRun(); });
  $('upRun').addEventListener('click', async () => {
    if (!upState.path) return;
    const model = $('upModel').value;
    let scale = Number($('upScale').value) || 4;
    if (model !== 'realesr-animevideov3') scale = 4;
    $('upRun').disabled = true;
    $('upProgress').classList.remove('hidden'); $('upBar').classList.add('indet');
    $('upStatus').textContent = 'Upscaling…'; $('upStatus').className = 'fr-status'; $('upStatus').onclick = null;
    aiResultDeleteHide('upStatus');
    try {
      const res = await window.api.aiUpscale({ inputPath: upState.path, model, scale, outputDir: state.outputDir });
      $('upBar').classList.remove('indet'); $('upBar').style.width = '100%';
      $('upStatus').textContent = `Saved (${fmtBytes(res.outSize)}) — click to open`; $('upStatus').className = 'fr-status done';
      $('upStatus').onclick = () => window.api.showItem(res.outputPath);
      aiResultDelete('upStatus', res.outputPath);
      toast('Upscale complete', { path: res.outputPath });
      try { addRecent({ path: res.outputPath }); } catch { /* */ }
    } catch (e) {
      $('upBar').classList.remove('indet');
      $('upStatus').textContent = 'Error: ' + ((e && e.message) || e); $('upStatus').className = 'fr-status error';
    } finally { upUpdateRun(); }
  });
}

// ---------- AI Background Removal (U²-Net / IS-Net, onnxruntime-node) ----------
// Inference runs in MAIN (the ORT forward pass only); all image I/O — preprocess
// to a 320x320 NCHW tensor, then composite the returned mask back onto the
// original at full resolution — happens here on <canvas>. Output is a PNG.
const rbState = { path: null, img: null, wired: false };
const RB_SIZE = 320;
const RB_MEAN = [0.485, 0.456, 0.406];
const RB_STD = [0.229, 0.224, 0.225];

async function openRemoveBg() {
  hideAll(); state.section = 'tools'; state.ws = null;
  state.currentTool = { id: 'remove-bg', label: 'Background Removal' }; updateFavBtn();
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Background Removal';
  setHero('Background Removal', 'AI cutout — remove an image background locally and export a transparent PNG');
  $('removebgPanel').classList.remove('hidden');
  if (!rbState.wired) { wireRemoveBg(); rbState.wired = true; }
  enhanceSelects($('removebgPanel'));
  const engineOk = !state.caps || state.caps.hasBgRemoval !== false;
  $('rbNoEngine').classList.toggle('hidden', engineOk);
  await rbRefreshModels();
}
async function rbRefreshModels() {
  const sel = $('rbModel');
  const engineOk = !state.caps || state.caps.hasBgRemoval !== false;
  let installed = [];
  try {
    const all = (window.api.aimodels && await window.api.aimodels.list()) || [];
    // status() returns { whisper:[...], bgremoval:[...] }. Be resilient to a flat
    // array too (discriminated by feature/kind), mirroring the whisper path.
    const list = Array.isArray(all)
      ? all.filter((m) => m.feature === 'bgremoval' || m.kind === 'bgremoval')
      : (all.bgremoval || all.bgRemoval || []);
    installed = (list || []).filter((m) => m && (m.installed === true || m.isInstalled === true));
  } catch { installed = []; }
  const none = !engineOk || !installed.length;
  // The no-model notice only shows when the engine itself is OK (otherwise the
  // engine notice covers it).
  $('rbNoModel').classList.toggle('hidden', !(engineOk && !installed.length));
  if (none) {
    sel.innerHTML = '<option value="">— none installed —</option>';
  } else {
    sel.innerHTML = installed.map((m) => `<option value="${mtbEsc(m.id)}">${mtbEsc(m.label || m.id)}</option>`).join('');
  }
  if (sel._csRender) sel._csRender();
  rbUpdateRun();
}
function rbUpdateRun() {
  const engineOk = !state.caps || state.caps.hasBgRemoval !== false;
  const hasModel = !!($('rbModel').value);
  $('rbRun').disabled = !(rbState.path && rbState.img && hasModel && engineOk);
}
function rbResolveBg() {
  const choice = $('rbBg').value;
  if (choice === 'transparent') return null;
  if (choice === 'white') return '#ffffff';
  if (choice === 'black') return '#000000';
  return $('rbColor').value || '#ffffff';
}
// Build the normalized 1x3x320x320 NCHW Float32 tensor (R plane, then G, then B)
// from a 320x320 ImageData, matching rembg/U²-Net preprocessing.
function rbBuildTensor(imageData) {
  const { data } = imageData; // RGBA, length 320*320*4
  const n = RB_SIZE * RB_SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    out[i] = (r - RB_MEAN[0]) / RB_STD[0];
    out[n + i] = (g - RB_MEAN[1]) / RB_STD[1];
    out[2 * n + i] = (b - RB_MEAN[2]) / RB_STD[2];
  }
  return out;
}
// Background removal exports the PNG via a browser download (to the user's
// Downloads folder), so the renderer has the filename but not a guaranteed
// absolute path. The delete button clears/greys the result + preview and, when
// the saved file resolves on disk, removes it via window.api.deleteFile.
function rbShowDelete(fname) {
  const status = $('rbStatus');
  const wrap = status && status.parentElement; if (!wrap) return;
  let btn = wrap.querySelector('.ai-del');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'ai-del'; btn.type = 'button'; btn.title = 'Delete this file';
    btn.innerHTML = `<span class="ic">${icon('trash')}</span>`;
    wrap.appendChild(btn);
  }
  btn.classList.remove('hidden');
  btn.onclick = async (e) => {
    e.stopPropagation();
    // Best-effort: try to delete the saved file from the Downloads folder.
    try {
      if (window.api.deleteFile) await window.api.deleteFile(fname);
    } catch { /* file path may be unknown; still clear the result below */ }
    const cv = $('rbPreview');
    if (cv) { try { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); } catch { /* */ } cv.classList.add('hidden'); }
    status.textContent = 'Deleted'; status.className = 'fr-status muted'; status.onclick = null;
    btn.classList.add('hidden');
    toast('Result cleared');
  };
}
function wireRemoveBg() {
  $('rbBg').addEventListener('change', () => {
    $('rbColorField').style.display = $('rbBg').value === 'custom' ? '' : 'none';
  });
  $('rbModel').addEventListener('change', rbUpdateRun);
  // The "no model" notice is a shortcut to the model manager.
  const rbNotice = $('rbNoModel');
  if (rbNotice) { rbNotice.classList.add('clickable'); rbNotice.addEventListener('click', () => openSettings('localai')); }
  $('rbLoad').addEventListener('click', async () => {
    const paths = await window.api.pickFiles(); if (!paths || !paths.length) return;
    rbState.path = paths[0]; $('rbName').textContent = baseName(paths[0]);
    $('rbProgress').classList.add('hidden'); $('rbStatus').textContent = ''; $('rbStatus').onclick = null;
    const img = new Image();
    img.onload = () => {
      rbState.img = img;
      // Show the source on the preview canvas (fit within a sane preview box).
      const cv = $('rbPreview');
      const maxW = 640, maxH = 480;
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
      cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.classList.remove('hidden');
      rbUpdateRun();
    };
    img.onerror = () => { rbState.img = null; toast('Could not load image', { kind: 'error' }); rbUpdateRun(); };
    img.src = 'file:///' + paths[0].replace(/\\/g, '/');
  });
  $('rbRun').addEventListener('click', async () => {
    if (!rbState.path || !rbState.img) return;
    const modelId = $('rbModel').value; if (!modelId) return;
    const bg = rbResolveBg();
    $('rbRun').disabled = true;
    $('rbProgress').classList.remove('hidden'); $('rbBar').classList.add('indet');
    $('rbStatus').textContent = 'Removing background…'; $('rbStatus').className = 'fr-status'; $('rbStatus').onclick = null;
    { const b = $('rbStatus').parentElement && $('rbStatus').parentElement.querySelector('.ai-del'); if (b) b.classList.add('hidden'); }
    try {
      const img = rbState.img;
      const W = img.naturalWidth, H = img.naturalHeight;

      // 1) Downscale source to 320x320 → ImageData → normalized tensor.
      const small = document.createElement('canvas');
      small.width = RB_SIZE; small.height = RB_SIZE;
      const sctx = small.getContext('2d');
      sctx.drawImage(img, 0, 0, RB_SIZE, RB_SIZE);
      const tensor = rbBuildTensor(sctx.getImageData(0, 0, RB_SIZE, RB_SIZE));

      // 2) Run the ORT forward pass in main → 320x320 mask (0..1).
      const { mask } = await window.api.aiRemoveBg({ modelId, data: tensor, size: RB_SIZE });

      // 3) Paint the mask onto a 320x320 canvas (alpha channel), then scale it up
      //    to the original dimensions for compositing.
      const maskCv = document.createElement('canvas');
      maskCv.width = RB_SIZE; maskCv.height = RB_SIZE;
      const mctx = maskCv.getContext('2d');
      const mImg = mctx.createImageData(RB_SIZE, RB_SIZE);
      for (let i = 0; i < RB_SIZE * RB_SIZE; i++) {
        const a = Math.max(0, Math.min(255, Math.round(mask[i] * 255)));
        mImg.data[i * 4] = a; mImg.data[i * 4 + 1] = a; mImg.data[i * 4 + 2] = a; mImg.data[i * 4 + 3] = 255;
      }
      mctx.putImageData(mImg, 0, 0);

      const maskFull = document.createElement('canvas');
      maskFull.width = W; maskFull.height = H;
      const mfctx = maskFull.getContext('2d');
      mfctx.imageSmoothingEnabled = true;
      mfctx.drawImage(maskCv, 0, 0, W, H);
      const maskData = mfctx.getImageData(0, 0, W, H).data;

      // 4) Composite: original RGB with alpha = mask value.
      const outCv = document.createElement('canvas');
      outCv.width = W; outCv.height = H;
      const octx = outCv.getContext('2d');
      octx.drawImage(img, 0, 0, W, H);
      const od = octx.getImageData(0, 0, W, H);
      for (let i = 0, n = W * H; i < n; i++) {
        // mask is grayscale → take the red channel as the alpha multiplier.
        od.data[i * 4 + 3] = Math.round(od.data[i * 4 + 3] * (maskData[i * 4] / 255));
      }
      octx.putImageData(od, 0, 0);

      // 5) If a background color was chosen, paint it BEHIND the cutout.
      let finalCv = outCv;
      if (bg) {
        const bgCv = document.createElement('canvas');
        bgCv.width = W; bgCv.height = H;
        const bctx = bgCv.getContext('2d');
        bctx.fillStyle = bg; bctx.fillRect(0, 0, W, H);
        bctx.drawImage(outCv, 0, 0);
        finalCv = bgCv;
      }

      // 6) Show the result on the preview + export as a PNG.
      const cv = $('rbPreview');
      const scale = Math.min(1, 640 / W, 480 / H);
      cv.width = Math.max(1, Math.round(W * scale));
      cv.height = Math.max(1, Math.round(H * scale));
      const pctx = cv.getContext('2d');
      pctx.clearRect(0, 0, cv.width, cv.height);
      pctx.drawImage(finalCv, 0, 0, cv.width, cv.height);

      const dataUrl = finalCv.toDataURL('image/png');
      const fname = 'MTB_' + baseName(rbState.path).replace(/\.[^.]+$/, '') + '_nobg.png';
      const a = document.createElement('a');
      a.href = dataUrl; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();

      $('rbBar').classList.remove('indet'); $('rbBar').style.width = '100%';
      $('rbStatus').textContent = `Saved ${fname} (in Downloads)`; $('rbStatus').className = 'fr-status done';
      rbShowDelete(fname);
      toast('Background removed');
    } catch (e) {
      $('rbBar').classList.remove('indet');
      $('rbStatus').textContent = 'Error: ' + ((e && e.message) || e); $('rbStatus').className = 'fr-status error';
    } finally { rbUpdateRun(); }
  });
}

// ---------- Profile (GitHub live) ----------
const GH_USER = 'pipelinear';
const GH_REPO = 'pipelinear/media-toolbox';
const STAR_GOALS = [5, 10, 15, 25];
let profileLoaded = false;
let lastContribs = null;   // cached so the calendar can re-theme on reopen
let lastStars = null;      // cached star count for the flight card
function openProfile() {
  hideAll(); state.section = 'profile'; state.ws = null;
  state.currentTool = null; updateFavBtn();
  document.body.classList.add('on-profile'); // hides hero, tightens layout
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = '';
  $('profilePanel').classList.remove('hidden');
  $('ghLink').textContent = `github.com/${GH_USER}`;
  startPixelCanvas(); animateSignature();
  retintPlayer();           // re-apply the album-art tint for the CURRENT theme (dark/light)
  if (!profileLoaded) loadGithub();
  else {
    // Re-render the theme-aware bits with cached data (e.g. after a theme switch).
    if (lastContribs) renderCalendar(lastContribs);
    if (lastStars != null) renderFlightCard(lastStars);
  }
}
async function loadGithub() {
  // Offline: skip the GitHub fetches silently, but still render offline-safe placeholders.
  if (isOffline()) { renderFlightCard(null); return; }
  try {
    const u = await (await fetch(`https://api.github.com/users/${GH_USER}`)).json();
    if (u && u.avatar_url) $('ghAvatar').src = u.avatar_url;
    if (u && u.login) { $('ghName').textContent = u.name || u.login; }
    if (u) $('ghStats').textContent = `${u.public_repos || 0} repos · ${u.followers || 0} followers · ${u.following || 0} following`;
  } catch { /* */ }
  // Repo stars → flight status card. Offline-safe (handled in renderFlightCard).
  try {
    const repo = await (await fetch(`https://api.github.com/repos/${GH_REPO}`)).json();
    lastStars = (repo && typeof repo.stargazers_count === 'number') ? repo.stargazers_count : null;
  } catch { lastStars = null; }
  renderFlightCard(lastStars);
  try {
    const data = await (await fetch(`https://github-contributions-api.jogruber.de/v4/${GH_USER}?y=last`)).json();
    renderCalendar((data && data.contributions) || []);
    profileLoaded = true;
  } catch { $('ghCal').innerHTML = '<span class="muted">Could not load contributions (offline?).</span>'; }
}
// Build the GitHub-stars "flight status" card. Maps stars onto the STAR_GOALS ladder.
function renderFlightCard(stars) {
  const el = $('ghFlight'); if (!el) return;
  if (stars == null) { el.innerHTML = '<div class="gh-fl-offline muted">Star status unavailable (offline?).</div>'; return; }
  const maxed = stars >= STAR_GOALS[STAR_GOALS.length - 1];
  let origin, dest, pct;
  if (maxed) {
    origin = STAR_GOALS[STAR_GOALS.length - 1]; dest = origin; pct = 100;
  } else {
    const goal = STAR_GOALS.find((g) => stars < g);
    origin = STAR_GOALS.filter((g) => g <= stars).pop() || 0;
    dest = goal;
    pct = dest > origin ? Math.max(0, Math.min(100, Math.round(((stars - origin) / (dest - origin)) * 100))) : 100;
  }
  const reduce = document.body.classList.contains('reduce-motion');
  el.innerHTML = `
    <div class="gh-fl-head">
      <span class="gh-fl-label">star status</span>
      <span class="gh-fl-pct">${pct}%</span>
    </div>
    <div class="gh-fl-track">
      <span class="gh-fl-node gh-fl-from"><span class="gh-fl-star">★</span>${origin}</span>
      <span class="gh-fl-line"><span class="gh-fl-fill" style="width:${reduce ? pct : 0}%"></span><span class="gh-fl-plane">✦</span></span>
      <span class="gh-fl-node gh-fl-to"><span class="gh-fl-star">★</span>${maxed ? 'MAX' : dest}</span>
    </div>
    <div class="gh-fl-foot">
      <span>${stars} ${stars === 1 ? 'star' : 'stars'}</span>
      <span>${maxed ? 'all goals reached' : `next goal · ${dest}`}</span>
    </div>`;
  if (!reduce) {
    const fill = el.querySelector('.gh-fl-fill');
    const plane = el.querySelector('.gh-fl-plane');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (fill) fill.style.width = pct + '%';
      if (plane) plane.style.left = pct + '%';
    }));
  } else {
    const plane = el.querySelector('.gh-fl-plane'); if (plane) plane.style.left = pct + '%';
  }
}
function renderCalendar(contribs) {
  lastContribs = contribs;
  // Colors live in CSS via .gh-l0….gh-l4 (light) and their body[data-theme="dark"]
  // overrides — so toggling the theme recolors the calendar instantly, no JS re-render.
  const cells = contribs.map((c) => `<span class="gh-day gh-l${c.level || 0}" title="${c.date}: ${c.count}"></span>`).join('');
  $('ghCal').innerHTML = `<div class="gh-grid">${cells}</div>`;
}
function animateSignature() {
  const p = $('sigPath'); if (!p) return;
  // Theme-aware stroke: white on the dark canvas; a non-black accent (--link) in light mode.
  const dark = document.body.dataset.theme === 'dark';
  const link = getComputedStyle(document.body).getPropertyValue('--link').trim() || '#0071bb';
  p.setAttribute('stroke', dark ? '#ffffff' : link);
  const len = p.getTotalLength();
  p.style.transition = 'none'; p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
  void p.getBoundingClientRect();
  p.style.transition = 'stroke-dashoffset 1.6s ease'; p.style.strokeDashoffset = '0';
}
let pixelRaf = 0;
const pixelMouse = { x: -9999, y: -9999 };
function startPixelCanvas() {
  const c = $('pixelCanvas'); if (!c) return;
  const ctxp = c.getContext('2d');
  const panel = $('profilePanel');
  const size = () => { c.width = panel.clientWidth; c.height = panel.clientHeight; };
  // Track the cursor across the WHOLE panel (not just the canvas element).
  panel.onmousemove = (e) => { const r = c.getBoundingClientRect(); pixelMouse.x = e.clientX - r.left; pixelMouse.y = e.clientY - r.top; };
  panel.onmouseleave = () => { pixelMouse.x = -9999; pixelMouse.y = -9999; };
  window.addEventListener('resize', size);
  cancelAnimationFrame(pixelRaf);
  const gap = 14, radius = 90;
  function draw() {
    if (c.width !== panel.clientWidth || c.height !== panel.clientHeight) size();
    // Theme-aware dots: light on the dark canvas, dark in light mode.
    const dark = document.body.dataset.theme === 'dark';
    const dot = dark ? '241,241,239' : '15,14,18';
    const faint = dark ? 'rgba(241,241,239,0.08)' : 'rgba(0,0,0,0.06)';
    ctxp.clearRect(0, 0, c.width, c.height);
    for (let y = gap / 2; y < c.height; y += gap) {
      for (let x = gap / 2; x < c.width; x += gap) {
        const d = Math.hypot(x - pixelMouse.x, y - pixelMouse.y);
        if (d < radius) {
          const t = 1 - d / radius;            // 0..1 falloff
          const s = 1.5 + t * 3;               // grow toward cursor (smaller, denser)
          ctxp.fillStyle = `rgba(${dot},${(0.12 + t * 0.78).toFixed(2)})`;
          ctxp.fillRect(x - s / 2, y - s / 2, s, s);
        } else {
          ctxp.fillStyle = faint;              // faint dots everywhere
          ctxp.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
    pixelRaf = requestAnimationFrame(draw);
  }
  // Let layout settle before first size so the canvas fills the panel.
  requestAnimationFrame(() => { size(); draw(); });
}

// ---------- audio player (profile) ----------
// Playlist model — add more tracks here later; the player handles any length.
const PLAYLIST = [
  { src: '../songs/song.mp3', title: 'You Are in My System', cover: '../songs/cover.jpg' },
];
// Exposed so openProfile() can re-tint the player for the current theme when About opens.
let retintPlayer = () => {};
function wireAudioPlayer() {
  const a = $('apAudio'); if (!a) return;
  const fmt = (s) => { s = s || 0; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
  let current = 0;
  let fadeRaf = 0;            // in-flight fade handle
  let endFading = false;      // true while the 3s end-fade is running

  // Reusable volume ramp. Cancels any in-flight fade before starting a new one.
  function fadeTo(target, ms, done) {
    cancelAnimationFrame(fadeRaf);
    const start = a.volume, delta = target - start, t0 = performance.now();
    if (ms <= 0) { a.volume = Math.max(0, Math.min(1, target)); if (done) done(); return; }
    function step(now) {
      const k = Math.min(1, (now - t0) / ms);
      a.volume = Math.max(0, Math.min(1, start + delta * k));
      if (k < 1) fadeRaf = requestAnimationFrame(step);
      else if (done) done();
    }
    fadeRaf = requestAnimationFrame(step);
  }

  // Quick "pop" on a control click: toggle a CSS class that runs a ~150ms scale
  // keyframe, then remove it on animationend so it can re-fire on the next click.
  function pop(el) {
    if (!el || document.body.classList.contains('reduce-motion')) return;
    el.classList.remove('ap-pop');
    void el.offsetWidth;                 // reflow so re-adding restarts the animation
    el.classList.add('ap-pop');
    el.addEventListener('animationend', () => el.classList.remove('ap-pop'), { once: true });
  }

  // Load a track, paint UI + tint, and (optionally) start playback with a fade-in.
  function loadTrack(i, autoplay) {
    current = ((i % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length;
    const tr = PLAYLIST[current];
    endFading = false;
    cancelAnimationFrame(fadeRaf);
    $('apCover').src = tr.cover;
    $('apTitle').textContent = tr.title;
    a.src = tr.src;
    tintFromCover(tr.cover);
    if (autoplay) {
      a.volume = 0;                            // reset so a previous end-fade can't leave it muted
      a.play().then(() => fadeTo(1, 300)).catch(() => {});   // fade in over 300ms
    }
  }

  // Average the cover's pixels → a tinted card bg. Light mode tints toward white;
  // dark mode tints toward a dark shade so the card stays dark (not white) with light text.
  function tintFromCover(src) {
    const card = document.querySelector('.aplayer');
    const apply = (rgb) => { if (card) card.style.background = rgb; };
    const dark = () => document.body.dataset.theme === 'dark';
    const fallback = () => apply(dark() ? '#1c1c22' : '#f0f1f3');
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let r = 0, gg = 0, b = 0, n = 0;
        for (let p = 0; p < d.length; p += 4) { r += d[p]; gg += d[p + 1]; b += d[p + 2]; n++; }
        r /= n; gg /= n; b /= n;
        if (dark()) {
          // Mix ~80% toward a near-black so a hint of the cover hue survives.
          const mix = 0.80, base = 22;           // base ≈ #16
          const tr = Math.round(r * (1 - mix) + base * mix), tg = Math.round(gg * (1 - mix) + base * mix), tb = Math.round(b * (1 - mix) + base * mix);
          apply(`rgb(${tr}, ${tg}, ${tb})`);
        } else {
          const mix = 0.82;                      // ~82% toward white for a whiter card
          const tr = Math.round(r + (255 - r) * mix), tg = Math.round(gg + (255 - gg) * mix), tb = Math.round(b + (255 - b) * mix);
          apply(`rgb(${tr}, ${tg}, ${tb})`);
        }
      } catch { fallback(); }
    };
    img.onerror = fallback;
    img.src = src;
  }

  const setPlayIcon = () => { $('apPlay').querySelector('.ic').innerHTML = icon(a.paused ? 'play' : 'pause'); };

  $('apPlay').addEventListener('click', () => {
    pop($('apPlay'));
    if (a.paused) {
      endFading = false;
      a.volume = 0; a.play().then(() => fadeTo(1, 300)).catch(() => {});   // fade in over 300ms
    } else {
      endFading = true;                                  // block the timeupdate end-fade from fighting us
      fadeTo(0, 300, () => { a.pause(); endFading = false; });            // fade out over 300ms, then pause
    }
  });
  a.addEventListener('play', setPlayIcon); a.addEventListener('pause', setPlayIcon);

  a.addEventListener('ended', () => {
    if ($('apRepeat').classList.contains('active')) { a.currentTime = 0; a.volume = 0; a.play().then(() => fadeTo(1, 300)).catch(() => {}); }
    else loadTrack(current + 1, true);           // advance; wraps to 0 at the end
  });

  a.addEventListener('timeupdate', () => {
    const p = a.duration ? (a.currentTime / a.duration) * 100 : 0;
    $('apFill').style.width = p + '%'; $('apCur').textContent = fmt(a.currentTime); $('apDur').textContent = fmt(a.duration);
    // 3-second end fade (skip when repeat is on — it restarts instead).
    if (a.duration && !$('apRepeat').classList.contains('active')) {
      const left = a.duration - a.currentTime;
      if (left <= 3 && left > 0 && !endFading) { endFading = true; fadeTo(0, left * 1000); }
    }
  });
  a.addEventListener('loadedmetadata', () => { $('apDur').textContent = fmt(a.duration); });

  $('apSlider').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(); const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (a.duration) { a.currentTime = pct * a.duration; if (endFading && (a.duration - a.currentTime) > 3) { endFading = false; fadeTo(1, 300); } }
  });
  $('apShuffle').addEventListener('click', () => $('apShuffle').classList.toggle('active'));
  $('apRepeat').addEventListener('click', () => $('apRepeat').classList.toggle('active'));

  // Skip = 300ms fade-out, then load neighbour with a fade-in.
  $('apPrev').addEventListener('click', () => {
    pop($('apPrev'));
    const restart = a.currentTime > 3 || PLAYLIST.length === 1;
    fadeTo(0, 300, () => loadTrack(restart ? current : current - 1, true));
  });
  $('apNext').addEventListener('click', () => {
    pop($('apNext'));
    fadeTo(0, 300, () => loadTrack(current + 1, true));   // wraps to first track
  });

  // Re-tint the current track's cover (used when About opens so the live theme is honored).
  // Also re-sync the play/pause icon + progress to the ALREADY-PLAYING audio so reopening
  // About never resets or restarts the track — it just reflects the current state.
  retintPlayer = () => {
    tintFromCover(PLAYLIST[current].cover);
    setPlayIcon();
    const p = a.duration ? (a.currentTime / a.duration) * 100 : 0;
    $('apFill').style.width = p + '%';
    $('apCur').textContent = fmt(a.currentTime); $('apDur').textContent = fmt(a.duration);
  };

  loadTrack(0, false);
}

// ---------- dither drop effect ----------
let ditherRaf = 0;
function startDither() {
  const c = $('ditherCanvas'); if (!c) return;
  c.width = c.offsetWidth; c.height = c.offsetHeight;
  const ctxd = c.getContext('2d');
  let t = 0;
  cancelAnimationFrame(ditherRaf);
  function draw() {
    t += 0.04; ctxd.clearRect(0, 0, c.width, c.height);
    const cell = 8;
    for (let y = 0; y < c.height; y += cell) {
      for (let x = 0; x < c.width; x += cell) {
        const v = (Math.sin((x * 0.03) + t) + Math.cos((y * 0.04) - t) + 2) / 4;
        const th = ((x / cell + y / cell) % 4) / 4;
        if (v > th) { ctxd.fillStyle = `rgba(99,91,255,${(v * 0.5).toFixed(2)})`; ctxd.fillRect(x, y, cell - 1, cell - 1); }
      }
    }
    ditherRaf = requestAnimationFrame(draw);
  }
  draw();
}
function stopDither() { cancelAnimationFrame(ditherRaf); const c = $('ditherCanvas'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }

// ---------- drag & drop ----------
function wireDnd() {
  const dz = $('dropZone');
  const box = $('emptyHint');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (!dz.classList.contains('drag')) startDither(); dz.classList.add('drag'); if (box) box.classList.add('drag'); }));
  ['dragleave'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (e.relatedTarget && dz.contains(e.relatedTarget)) return; dz.classList.remove('drag'); if (box) box.classList.remove('drag'); stopDither(); }));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag'); if (box) box.classList.remove('drag'); stopDither();
    // Electron 33: File.path is gone — resolve via webUtils through preload.
    const paths = [...(e.dataTransfer.files || [])].map((f) => window.api.getDroppedPath(f)).filter(Boolean);
    if (paths.length && state.ws) { dropSplash(); addPaths(paths); }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// Brief splash burst when files land in the drop zone.
function dropSplash() {
  const box = $('emptyHint');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.remove('splash'); void box.offsetWidth; box.classList.add('splash');
  setTimeout(() => box.classList.remove('splash'), 600);
}

// ---------- init ----------
async function pick() { if (!state.ws) return; const paths = await window.api.pickFiles(); if (paths.length) addPaths(paths); }
async function init() {
  state.caps = await window.api.capabilities();
  // Load settings early so offline detection (manual + network) is ready before
  // the GitHub/update fetches fire at the end of init.
  try { state.settings = await window.api.getSettings(); } catch { /* */ }
  // Track connectivity: react to the OS going on/offline.
  window.addEventListener('online', applyOnlineState);
  window.addEventListener('offline', applyOnlineState);
  applyOnlineState();
  $('logoIcon').innerHTML = icon('home'); injectIcons(document);
  $('homeBtn').addEventListener('click', showHome);
  $('profileBtn').addEventListener('click', openProfile);
  $('settingsBtn').addEventListener('click', () => openSettings('appearance'));
  document.querySelectorAll('#homeView .home-card').forEach((c) => c.addEventListener('click', () => { if (c.dataset.tool === 'metadata') { state.backTo = 'home'; openMetaEditor(); } else if (c.dataset.tool === 'downloader') { state.backTo = 'home'; openSpecial('youtube'); } else if (c.dataset.tool === 'photofx') { state.backTo = 'home'; openPhotoEffects(); } else if (c.dataset.tool === 'ai') { state.backTo = 'home'; openAiHub(); } else if (c.dataset.tool === 'spotify') { state.backTo = 'home'; openSpotify(); } else showSection(c.dataset.section); }));
  wireTitlebar(); wireStretch(); wireMetaEditor();
  $('settingsClose').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('settingsModal').addEventListener('click', (e) => { if (e.target === $('settingsModal')) $('settingsModal').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ['settingsModal', 'modalOverlay'].forEach((id) => $(id).classList.add('hidden')); } });
  $('setupSave').addEventListener('click', finishSetup);
  $('ghLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(`https://github.com/${GH_USER}`); });
  const rl = $('repoLink'); if (rl) rl.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(`https://github.com/${GH_USER}/media-toolbox`); });
  $('btnAdd').addEventListener('click', pick);
  $('btnAdd2').addEventListener('click', pick);
  $('btnCompress').addEventListener('click', runActive);
  $('btnCancelAll').addEventListener('click', () => { if ($('btnCancelAll').classList.contains('inert')) return; window.api.cancelAll(); });
  $('btnOutDir').addEventListener('click', async () => { const d = await window.api.pickOutputDir(); if (d) { state.outputDir = d; $('outDirLabel').textContent = d; } });
  $('backBtn').addEventListener('click', backToMenu);
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });
  $('modalApply').addEventListener('click', applyModal);
  $('modalReset').addEventListener('click', () => { const e = findEntry(state.modalJobId); if (e) { const of = e.settings.outputFormat; e.settings = { ...defaultSettingsFor(e.mediaType), ...(state.ws ? state.ws.base : {}) }; e.settings.outputFormat = of; $('modalBody').innerHTML = buildModalBody(e); wireModalBody(e); injectIcons($('modalBody')); } });
  wireDnd(); wireJobEvents(); wireYoutube(); wireSpotify(); wireColorPicker(); wireRecents(); wireFavs(); wireSearch(); unitInit(); timeInit(); wireAudioPlayer();
  enhanceSelects(document);
  // Single-instance "open another?" prompt.
  window.api.onSecondInstance(() => $('instanceModal').classList.remove('hidden'));
  // Live model-state updates: when a model finishes downloading or is removed in
  // any window, refresh whichever AI tool screen is open + the Settings manager.
  if (window.api.aimodels && window.api.aimodels.onAimodelChanged) {
    window.api.aimodels.onAimodelChanged(() => refreshAiModelState());
  }
  wireFirstRun();
  $('instCancel').addEventListener('click', () => $('instanceModal').classList.add('hidden'));
  $('instOpen').addEventListener('click', () => { window.api.newWindow(); $('instanceModal').classList.add('hidden'); });
  // Update notice.
  $('unDismiss').addEventListener('click', () => $('updateNotice').classList.add('hidden'));
  showHome();
  maybeFirstRun();
  loadGithub();
  checkForUpdate();
}

// Compare bundled version against the latest GitHub release.
async function checkForUpdate() {
  if (isOffline()) return; // silently skip the GitHub release check when offline
  try {
    const cur = (state.caps && state.caps.appVersion) || '1.0.0';
    const r = await (await fetch('https://api.github.com/repos/pipelinear/media-toolbox/releases/latest')).json();
    if (!r || !r.tag_name) return;
    const latest = String(r.tag_name).replace(/^v/, '');
    if (cmpVer(latest, cur) > 0) {
      $('unBody').textContent = `v${latest} is out (you have v${cur}).`;
      const url = r.html_url || 'https://github.com/pipelinear/media-toolbox/releases/latest';
      $('unDownload').onclick = () => window.api.openExternal(url);
      $('updateNotice').classList.remove('hidden');
    }
  } catch { /* offline — ignore */ }
}
function cmpVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
init();
