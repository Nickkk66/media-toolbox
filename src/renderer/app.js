'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  caps: null,
  section: 'compress',
  ws: null, // active workspace (file-based tool)
  outputDir: null,
  modalJobId: null,
  openMenuItem: null, // remember last opened item per section
};

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
function setHero(title, sub) { $('heroTitle').textContent = title; $('heroSub').textContent = sub; }

const PANELS = ['homeView', 'convertMenu', 'compressMenu', 'toolsMenu', 'toolHeader', 'dropZone', 'colorPanel', 'ytPanel', 'unitPanel', 'timePanel'];
function hideAll() { PANELS.forEach((id) => $(id).classList.add('hidden')); }

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
  let activeIdx = 0; // first open by default

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
  state.section = 'home'; state.ws = null;
  hideAll();
  setHero('Media Toolbox', 'Convert, compress and edit media — all on your machine');
  $('homeView').classList.remove('hidden');
}
function showSection(section) {
  state.section = section;
  state.ws = null;
  hideAll();
  if (section === 'convert') { setHero('Convert', 'Pick a converter'); $('convertMenu').classList.remove('hidden'); bouncyAccordion($('convertMenu'), window.CONVERT_CATEGORIES, (it) => openItem(it, 'convert')); }
  else if (section === 'compress') { setHero('Compress', 'Pick a compressor'); $('compressMenu').classList.remove('hidden'); bouncyAccordion($('compressMenu'), window.COMPRESS_CATEGORIES, (it) => openItem(it, 'compress')); }
  else if (section === 'tools') { setHero('Tools', 'Pick a tool'); $('toolsMenu').classList.remove('hidden'); bouncyAccordion($('toolsMenu'), window.TOOL_CATEGORIES, (it) => openItem(it, 'tool')); }
}

function backToMenu() {
  if (['convert', 'compress', 'tools'].includes(state.section)) showSection(state.section);
  else showHome();
}

// ---------- open an item ----------
function openItem(item, kind) {
  if (item.engine === 'special') return openSpecial(item.id);
  if (item.engine === 'colorpicker') return openColorPicker();
  if (item.engine === 'stretch') return openStretch();
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

// ---------- tool options bar (for op tools) ----------
function renderToolOptions() {
  const bar = $('toolOptions');
  const ws = state.ws;
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
  else if (op === 'extract') html = field('First page', `<input type="number" data-k="firstPage" value="${b.firstPage || 1}" min="1">`) + field('Last page (0=end)', `<input type="number" data-k="lastPage" value="${b.lastPage || 0}" min="0">`);
  else if (op === 'protect') html = field('Password', `<input type="text" data-k="password" value="${b.password || ''}" placeholder="set a password">`);
  else if (op === 'remove') html = field('Remove from page', `<input type="number" data-k="removeFirst" value="${b.removeFirst || 1}" min="1">`) + field('to page', `<input type="number" data-k="removeLast" value="${b.removeLast || 1}" min="1">`);
  else if (op === 'rotate') html = field('Rotate by', `<select data-k="angle"><option value="90" ${b.angle == 90 ? 'selected' : ''}>90° CW</option><option value="180" ${b.angle == 180 ? 'selected' : ''}>180°</option><option value="270" ${b.angle == 270 ? 'selected' : ''}>270° CW</option></select>`);
  else if (op === 'unlock') html = field('Current password', `<input type="text" data-k="password" value="${b.password || ''}" placeholder="leave blank if none">`);
  else if (op === 'resize') html = field('Page size', `<select data-k="paper"><option value="a4" ${b.paper === 'a4' ? 'selected' : ''}>A4</option><option value="letter" ${b.paper === 'letter' ? 'selected' : ''}>Letter</option><option value="legal" ${b.paper === 'legal' ? 'selected' : ''}>Legal</option><option value="a3" ${b.paper === 'a3' ? 'selected' : ''}>A3</option></select>`);
  else { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  const note = op === 'crop' ? '<div class="hint" style="margin-top:10px">Common sizes — TikTok/Reels 1080×1920 · YouTube 1920×1080 · Square 1080×1080 · Story 1080×1920</div>' : '';
  bar.innerHTML = `<div class="to-title">Options</div><div class="to-fields">${html}</div>${note}`;
  bar.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => {
    const k = el.dataset.k; b[k] = el.type === 'number' ? Number(el.value) : el.value;
    for (const e of ws.list.values()) e.settings[k] = b[k];
  }));
  bar.classList.remove('hidden');
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

  for (const entry of ws.list.values()) {
    const row = document.createElement('div'); row.className = 'file-row';
    const fmtOpts = formats.map((f) => `<option value="${f.value}" ${entry.settings.outputFormat === f.value ? 'selected' : ''}>${f.label}</option>`).join('');
    const outCtl = ws.lockFmt
      ? `<span class="fr-format locked">${String(entry.settings.outputFormat || ws.item.out || '').toUpperCase()}</span>`
      : `<select class="fr-format">${fmtOpts}</select>`;
    row.innerHTML = `
      <div class="fr-info"><div class="fr-name"></div><div class="fr-meta"></div></div>
      <div class="fr-controls">
        ${ws.isMerge ? '' : `<span class="lbl">${ws.convert ? 'To:' : 'Output:'}</span>${outCtl}`}
        ${showCog ? `<button class="icon-btn fr-cog" title="Advanced options"><span class="ic">${icon('settings')}</span></button>` : ''}
        <button class="icon-btn fr-del" title="Remove"><span class="ic">${icon('x')}</span></button>
      </div>
      <div class="fr-progress hidden"><div class="bar"><div class="bar-fill"></div></div><div class="fr-status"></div></div>`;
    row.querySelector('.fr-name').textContent = entry.name;
    row.querySelector('.fr-meta').textContent = metaLine(entry);
    const sel = row.querySelector('select.fr-format'); if (sel) sel.addEventListener('change', () => { entry.settings.outputFormat = sel.value; });
    const cog = row.querySelector('.fr-cog'); if (cog) cog.addEventListener('click', () => openModal(entry.jobId));
    row.querySelector('.fr-del').addEventListener('click', () => { if (entry.status === 'running') window.api.cancelJob(entry.jobId); ws.list.delete(entry.jobId); renderList(); });
    row.addEventListener('dblclick', () => { if (entry.status === 'done' && entry.outputPath) window.api.showItem(entry.outputPath); });
    entry.els = { row, progress: row.querySelector('.fr-progress'), bar: row.querySelector('.bar-fill'), status: row.querySelector('.fr-status') };
    if (['running', 'done', 'error'].includes(entry.status)) entry.els.progress.classList.remove('hidden');
    container.appendChild(row);
  }
  const ready = [...ws.list.values()].filter((e) => e.status === 'ready' || e.status === 'error').length;
  $('footerCount').textContent = `Added ${ws.list.size} file${ws.list.size === 1 ? '' : 's'}`;
  $('btnCompress').disabled = ws.isMerge ? ws.list.size < 2 : ready === 0;
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
    if (entry.els) { entry.els.progress.classList.remove('hidden'); entry.els.status.textContent = 'Queued'; entry.els.status.className = 'fr-status'; }
    try {
      const { outputPath } = await window.api.startJob({ jobId: entry.jobId, mediaType: entry.mediaType, inputPath: entry.path, settings: entry.settings, meta: entry.meta, outputDir: state.outputDir, convert: !!entry.convert });
      entry.outputPath = outputPath;
    } catch (err) { entry.status = 'error'; if (entry.els) { entry.els.status.textContent = 'Failed: ' + (err.message || err); entry.els.status.className = 'fr-status error'; } }
  }
  renderList();
}
function wireJobEvents() {
  window.api.onJobProgress((d) => {
    const e = findEntry(d.jobId); if (!e || !e.els) return;
    e.status = 'running'; e.els.progress.classList.remove('hidden');
    if (d.indeterminate) { e.els.bar.classList.add('indet'); e.els.status.textContent = 'Processing…'; }
    else { e.els.bar.classList.remove('indet'); e.els.bar.style.width = `${d.percent.toFixed(1)}%`; e.els.status.textContent = `${d.percent.toFixed(0)}%${d.speed ? ` · ${d.speed.toFixed(1)}x` : ''}`; }
    e.els.status.className = 'fr-status';
  });
  window.api.onJobDone((d) => {
    // Stretch tool job (no file row).
    if (d.jobId === state._stretchJob) {
      $('stBar').style.width = '100%'; $('stStatus').className = 'fr-status done'; $('stStatus').textContent = `Done (${fmtBytes(d.outSize)}) — click to open`; $('stStatus').onclick = () => window.api.showItem(d.outputPath); $('stRender').disabled = false; toast('Stretch complete'); state._stretchJob = null; return;
    }
    const e = findEntry(d.jobId); if (!e || !e.els) { toast('Done'); return; }
    e.status = 'done'; e.outputPath = d.outputPath; e.els.bar.classList.remove('indet'); e.els.bar.style.width = '100%';
    const was = e.meta ? `, was ${fmtBytes(e.meta.sizeBytes)}` : '';
    e.els.status.textContent = `Done (${fmtBytes(d.outSize)}${was}) — double-click to open`; e.els.status.className = 'fr-status done';
    toast(`Done: ${e.name}`);
  });
  window.api.onJobError((d) => {
    const e = findEntry(d.jobId); if (!e || !e.els) return;
    const c = String(d.message).includes('canceled');
    e.status = c ? 'ready' : 'error'; e.els.bar.classList.remove('indet'); e.els.bar.style.width = '0%';
    e.els.status.textContent = c ? 'Canceled' : ('Error: ' + d.message.split('\n')[0]); e.els.status.className = c ? 'fr-status' : 'fr-status error';
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
  $('modalBody').innerHTML = buildModalBody(e); wireModalBody(e); injectIcons($('modalBody'));
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
    const rm = () => { $('m_methodFields').innerHTML = methodFieldsHtml(s); syncPair('m_percent', 'm_percentN'); syncPair('m_crf', 'm_crfN'); };
    const rs = () => { $('m_subFields').innerHTML = subFieldsHtml(s); const pk = $('m_subPick'); if (pk) pk.addEventListener('click', async () => { const p = await window.api.pickSubtitle(); if (p) { s.subtitle = s.subtitle || { mode: 'hard' }; s.subtitle.path = p; $('m_subName').textContent = baseName(p); } }); };
    rm(); rs(); syncPair('m_vol', 'm_volN');
    $('m_method').addEventListener('change', (ev) => { s.method = ev.target.value; rm(); });
    $('m_subAdd').addEventListener('change', (ev) => { s.subtitle = ev.target.value === 'upload' ? (s.subtitle || { path: null, mode: 'hard' }) : undefined; rs(); });
  } else if (t === 'audio') { const m = $('m_method'); if (m) m.addEventListener('change', (ev) => { s.method = ev.target.value; $('modalBody').innerHTML = audioModal(s); wireModalBody(e); }); }
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
  const names = { youtube: 'YouTube Downloader', 'unit-converter': 'Unit Converter', 'time-converter': 'Time Converter', 'archive-converter': 'Archive Converter' };
  $('toolName').textContent = names[id] || '';
  if (id === 'youtube') { setHero('YouTube Downloader', 'Download and convert videos with yt-dlp'); $('ytPanel').classList.remove('hidden'); }
  else if (id === 'unit-converter') { setHero('Unit Converter', 'Convert between common units'); $('unitPanel').classList.remove('hidden'); }
  else if (id === 'time-converter') { setHero('Time Converter', 'Time zones and Unix timestamps'); $('timePanel').classList.remove('hidden'); }
  else if (id === 'archive-converter') { openItem(window.findConverter('archive-converter'), 'convert'); }
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
}

// ---------- YouTube ----------
const yt = { info: null, downloading: false };
function ytErr(m) { const el = $('ytError'); if (!m) { el.classList.add('hidden'); return; } el.textContent = m; el.classList.remove('hidden'); }
function ytRefreshSub() {
  const mode = $('ytMode').value, sub = $('ytSub');
  if (mode === 'audio') sub.innerHTML = ['mp3', 'ogg', 'm4a', 'opus', 'wav'].map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
  else if (mode === 'video') sub.innerHTML = ['mp4', 'mkv', 'webm'].map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
  else sub.innerHTML = ['with', 'without', 'captions'].map((f) => `<option value="${f}">${f === 'with' ? 'With timestamps' : f === 'without' ? 'Without timestamps (.txt)' : 'Captions (.srt)'}</option>`).join('');
  ytRefreshQuality();
}
function ytRefreshQuality() {
  const mode = $('ytMode').value, sel = $('ytQuality'), wrap = $('ytQualityWrap');
  if (mode === 'transcription') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if (mode === 'audio') { $('ytQualityLabel').textContent = 'Bitrate'; sel.innerHTML = [320, 256, 192, 128, 96].map((k) => `<option value="${k}">${k} kbps</option>`).join(''); }
  else { $('ytQualityLabel').textContent = 'Max resolution'; const hs = (yt.info && yt.info.heights.length) ? yt.info.heights : [2160, 1440, 1080, 720, 480, 360]; sel.innerHTML = `<option value="0">Best available</option>` + hs.map((h) => `<option value="${h}">${h}p</option>`).join(''); }
}
async function ytFetch() {
  const url = $('ytUrl').value.trim(); if (!url) return;
  ytErr(''); $('ytFetch').disabled = true; $('ytFetch').textContent = 'Fetching…';
  try { const info = await window.api.ytInfo(url); yt.info = info; $('ytThumb').src = info.thumbnail || ''; $('ytTitle').textContent = info.title; $('ytUploader').textContent = [info.uploader, fmtDur(info.durationSec)].filter(Boolean).join(' · '); ytRefreshSub(); $('ytInfo').classList.remove('hidden'); $('ytProgress').classList.add('hidden'); }
  catch (err) { ytErr(String(err.message || err)); $('ytInfo').classList.add('hidden'); }
  finally { $('ytFetch').disabled = false; $('ytFetch').textContent = 'Fetch'; }
}
async function ytDownload() {
  if (!yt.info || yt.downloading) return;
  yt.downloading = true; $('ytDownload').disabled = true; $('ytCancel').classList.remove('hidden');
  $('ytProgress').classList.remove('hidden'); $('ytBar').style.width = '0%'; $('ytStatus').className = 'fr-status'; $('ytStatus').textContent = 'Starting…';
  const mode = $('ytMode').value, sub = $('ytSub').value;
  const opts = { url: yt.info.webpage, mode, outputDir: state.outputDir };
  if (mode === 'audio') { opts.audioFormat = sub; opts.audioKbps = Number($('ytQuality').value); }
  else if (mode === 'video') { opts.audioFormat = sub; opts.height = Number($('ytQuality').value); }
  else { opts.subMode = sub; }
  try { const res = await window.api.ytDownload(opts); $('ytBar').style.width = '100%'; $('ytStatus').className = 'fr-status done'; $('ytStatus').textContent = `Done (${fmtBytes(res.outSize)}) — click to open`; $('ytStatus').onclick = () => res.outputPath && window.api.showItem(res.outputPath); toast('YouTube download complete'); }
  catch (err) { const c = String(err.message).includes('canceled'); $('ytStatus').className = c ? 'fr-status' : 'fr-status error'; $('ytStatus').textContent = c ? 'Canceled' : ('Error: ' + String(err.message).split('\n')[0]); }
  finally { yt.downloading = false; $('ytDownload').disabled = false; $('ytCancel').classList.add('hidden'); }
}
function wireYoutube() {
  $('ytFetch').addEventListener('click', ytFetch);
  $('ytUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') ytFetch(); });
  $('ytMode').addEventListener('change', ytRefreshSub);
  $('ytSub').addEventListener('change', ytRefreshQuality);
  $('ytDownload').addEventListener('click', ytDownload);
  $('ytCancel').addEventListener('click', () => window.api.ytCancel());
  window.api.onYtProgress((p) => { $('ytProgress').classList.remove('hidden'); $('ytBar').style.width = `${(p.percent || 0).toFixed(1)}%`; $('ytStatus').textContent = p.phase === 'processing' ? 'Converting…' : `${(p.percent || 0).toFixed(0)}%`; });
}

// ---------- Unit / Time ----------
const UNITS = { Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 }, Weight: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.0283495231, ton: 1000 }, Data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }, Speed: { 'm/s': 1, 'km/h': 0.277778, mph: 0.44704, knot: 0.514444 } };
function unitInit() { const cat = $('unitCat'); cat.innerHTML = Object.keys(UNITS).concat(['Temperature']).map((c) => `<option>${c}</option>`).join(''); cat.addEventListener('change', unitFill); ['unitFrom', 'unitFromU', 'unitToU'].forEach((id) => $(id).addEventListener('input', unitCompute)); unitFill(); }
function unitFill() { const c = $('unitCat').value; const u = c === 'Temperature' ? ['C', 'F', 'K'] : Object.keys(UNITS[c]); $('unitFromU').innerHTML = u.map((x) => `<option>${x}</option>`).join(''); $('unitToU').innerHTML = u.map((x, i) => `<option ${i === 1 ? 'selected' : ''}>${x}</option>`).join(''); unitCompute(); }
function unitCompute() { const c = $('unitCat').value, val = parseFloat($('unitFrom').value), fu = $('unitFromU').value, tu = $('unitToU').value; if (isNaN(val)) { $('unitTo').value = ''; return; } let out; if (c === 'Temperature') { let k; if (fu === 'C') k = val + 273.15; else if (fu === 'F') k = (val - 32) * 5 / 9 + 273.15; else k = val; if (tu === 'C') out = k - 273.15; else if (tu === 'F') out = (k - 273.15) * 9 / 5 + 32; else out = k; } else out = val * UNITS[c][fu] / UNITS[c][tu]; $('unitTo').value = Number(out.toPrecision(8)).toString(); }
const TZS = [['UTC', 0], ['New York (ET)', -5], ['Chicago (CT)', -6], ['Denver (MT)', -7], ['Los Angeles (PT)', -8], ['London', 0], ['Paris/Berlin', 1], ['Dubai', 4], ['India', 5.5], ['Tokyo', 9], ['Sydney', 11]];
function timeInit() { const o = TZS.map(([n], i) => `<option value="${i}">${n}</option>`).join(''); $('timeFrom').innerHTML = o; $('timeTo').innerHTML = o; $('timeTo').value = '9'; ['timeInput', 'timeFrom', 'timeTo'].forEach((id) => $(id).addEventListener('input', timeCompute)); }
function timeCompute() { const raw = $('timeInput').value; if (!raw) { $('timeOut').innerHTML = '<span class="muted">Pick a date and time above.</span>'; return; } const [, fOff] = TZS[Number($('timeFrom').value)], [toName, tOff] = TZS[Number($('timeTo').value)]; const local = new Date(raw); const utcMs = local.getTime() - local.getTimezoneOffset() * 60000 - fOff * 3600000; const target = new Date(utcMs + tOff * 3600000); const pad = (n) => String(n).padStart(2, '0'); const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; $('timeOut').innerHTML = `In <b>${toName}</b>: ${fmt(target)}<br>Unix timestamp: <b>${Math.floor(utcMs / 1000)}</b>`; }

// ---------- toasts ----------
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' err' : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3600);
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
function perfRadios(current) {
  return PERF_OPTS.map(([v, l, d]) => `<label class="perf-opt"><input type="radio" name="perf" value="${v}" ${current === v ? 'checked' : ''}/><div><div class="perf-l">${l}</div><div class="perf-d">${d}</div></div></label>`).join('');
}
async function openSettings() {
  const s = await window.api.getSettings();
  $('settingsBody').innerHTML = `<div class="perf-list">${perfRadios(s.performance)}</div>`;
  $('settingsCores').textContent = `Current cap: ${s.threads === 0 ? 'all cores' : s.threads + ' thread(s)'}`;
  $('settingsModal').classList.remove('hidden');
}
async function saveSettings() {
  const sel = document.querySelector('#settingsBody input[name="perf"]:checked');
  if (sel) { state.settings = await window.api.setSettings({ performance: sel.value }); toast(`Usage limit set to ${sel.value}`); }
  $('settingsModal').classList.add('hidden');
}
async function maybeFirstRun() {
  state.settings = await window.api.getSettings();
  if (state.settings.firstRun) {
    $('setupBody').innerHTML = `<div class="perf-list">${perfRadios(state.settings.performance)}</div>`;
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

// ---------- Profile (GitHub live) ----------
const GH_USER = 'pipelinear';
let profileLoaded = false;
function openProfile() {
  hideAll(); state.section = 'profile'; state.ws = null;
  $('toolHeader').classList.remove('hidden'); $('toolName').textContent = 'Profile';
  setHero('Profile', '');
  $('profilePanel').classList.remove('hidden');
  $('ghLink').textContent = `github.com/${GH_USER}`;
  startPixelCanvas(); animateSignature();
  if (!profileLoaded) loadGithub();
}
async function loadGithub() {
  try {
    const u = await (await fetch(`https://api.github.com/users/${GH_USER}`)).json();
    if (u && u.avatar_url) $('ghAvatar').src = u.avatar_url;
    if (u && u.login) { $('ghName').textContent = u.name || u.login; }
    if (u) $('ghStats').textContent = `${u.public_repos || 0} repos · ${u.followers || 0} followers · ${u.following || 0} following`;
  } catch { /* */ }
  try {
    const data = await (await fetch(`https://github-contributions-api.jogruber.de/v4/${GH_USER}?y=last`)).json();
    renderCalendar((data && data.contributions) || []);
    profileLoaded = true;
  } catch { $('ghCal').innerHTML = '<span class="muted">Could not load contributions (offline?).</span>'; }
}
function renderCalendar(contribs) {
  const levels = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  // group into weeks (columns of 7)
  const cells = contribs.map((c) => `<span class="gh-day" title="${c.date}: ${c.count}" style="background:${levels[c.level] || levels[0]}"></span>`).join('');
  $('ghCal').innerHTML = `<div class="gh-grid">${cells}</div>`;
}
function animateSignature() {
  const p = $('sigPath'); if (!p) return;
  const len = p.getTotalLength();
  p.style.transition = 'none'; p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
  void p.getBoundingClientRect();
  p.style.transition = 'stroke-dashoffset 1.6s ease'; p.style.strokeDashoffset = '0';
}
let pixelRaf = 0;
function startPixelCanvas() {
  const c = $('pixelCanvas'); if (!c) return;
  const ctxp = c.getContext('2d');
  const resize = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
  resize();
  const gap = 16; const mouse = { x: -999, y: -999 };
  c.onmousemove = (e) => { const r = c.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
  c.onmouseleave = () => { mouse.x = -999; mouse.y = -999; };
  cancelAnimationFrame(pixelRaf);
  function draw() {
    ctxp.clearRect(0, 0, c.width, c.height);
    for (let y = gap / 2; y < c.height; y += gap) {
      for (let x = gap / 2; x < c.width; x += gap) {
        const d = Math.hypot(x - mouse.x, y - mouse.y);
        const on = d < 80;
        const s = on ? 4 : 2;
        ctxp.fillStyle = on ? 'rgba(0,0,0,' + (1 - d / 80).toFixed(2) + ')' : '#e5e5e5';
        ctxp.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    pixelRaf = requestAnimationFrame(draw);
  }
  draw();
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
  $('logoIcon').innerHTML = icon('home'); injectIcons(document);
  $('homeBtn').addEventListener('click', showHome);
  $('profileBtn').addEventListener('click', openProfile);
  $('settingsBtn').addEventListener('click', openSettings);
  document.querySelectorAll('.home-card').forEach((c) => c.addEventListener('click', () => showSection(c.dataset.section)));
  wireTitlebar(); wireStretch();
  $('settingsClose').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('settingsSave').addEventListener('click', saveSettings);
  $('setupSave').addEventListener('click', finishSetup);
  $('ghLink').addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(`https://github.com/${GH_USER}`); });
  const rl = $('repoLink'); if (rl) rl.addEventListener('click', (e) => { e.preventDefault(); window.api.openExternal(`https://github.com/${GH_USER}/media-toolbox`); });
  $('btnAdd').addEventListener('click', pick);
  $('btnAdd2').addEventListener('click', pick);
  $('btnCompress').addEventListener('click', runActive);
  $('btnCancelAll').addEventListener('click', () => window.api.cancelAll());
  $('btnOutDir').addEventListener('click', async () => { const d = await window.api.pickOutputDir(); if (d) { state.outputDir = d; $('outDirLabel').textContent = d; } });
  $('backBtn').addEventListener('click', backToMenu);
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });
  $('modalApply').addEventListener('click', applyModal);
  $('modalReset').addEventListener('click', () => { const e = findEntry(state.modalJobId); if (e) { const of = e.settings.outputFormat; e.settings = { ...defaultSettingsFor(e.mediaType), ...(state.ws ? state.ws.base : {}) }; e.settings.outputFormat = of; $('modalBody').innerHTML = buildModalBody(e); wireModalBody(e); injectIcons($('modalBody')); } });
  wireDnd(); wireJobEvents(); wireYoutube(); wireColorPicker(); unitInit(); timeInit();
  showHome();
  maybeFirstRun();
}
init();
