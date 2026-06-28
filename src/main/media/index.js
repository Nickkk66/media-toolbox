'use strict';

// Media-type registry. Maps file extensions to media modules and exposes the
// per-type module by name.

const video = require('./video');
const image = require('./image');
const gif = require('./gif');
const audio = require('./audio');
const pdf = require('./pdf');
const pdf2img = require('./pdf2img');
const img2pdf = require('./img2pdf');
const archive = require('./archive');
const imageop = require('./imageop');
const videoop = require('./videoop');
const audioop = require('./audioop');
const pdfop = require('./pdfop');

// All processable modules (by type). The converter/tool-only modules are
// invoked explicitly by id, not by drag-detection.
const MODULES = { video, image, gif, audio, pdf, pdf2img, img2pdf, archive, imageop, videoop, audioop, pdfop };

// Build extension -> type lookup for drag/drop auto-detection (compress tabs).
// Only the natural media types participate here.
const EXT_TYPE = {};
for (const mod of [video, image, audio, gif, pdf]) {
  for (const ext of mod.extensions) EXT_TYPE[ext] = mod.type;
}

function typeForPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  return EXT_TYPE[ext] || null;
}

function getByType(type) {
  return MODULES[type] || null;
}

// Settings shape for the renderer (output formats + defaults per type).
function describe() {
  const out = {};
  for (const [type, mod] of Object.entries(MODULES)) {
    out[type] = {
      type,
      extensions: mod.extensions,
      outputFormats: mod.outputFormats,
      defaults: mod.defaultSettings(),
    };
  }
  return out;
}

module.exports = { MODULES, typeForPath, getByType, describe, EXT_TYPE };
