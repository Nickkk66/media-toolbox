'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { plan, videoKbpsForTargetBytes } = require('../src/main/ffmpeg/bitrate');

const meta = {
  durationSec: 600,
  sizeBytes: 1000 * 1024 * 1024, // 1000 MiB
  video: { width: 1920, height: 1080 },
  hasAudio: true,
  audios: [{ channels: 2 }],
};

test('700MB / 600s / 128kbps audio -> ~9365 kbps (plan-doc example)', () => {
  const targetBytes = 700 * 1024 * 1024;
  const kbps = videoKbpsForTargetBytes(targetBytes, 600, 128);
  assert.ok(kbps >= 9300 && kbps <= 9420, `expected ~9365, got ${kbps}`);
});

test('percent method targets correct size', () => {
  const p = plan({ method: 'percent', percent: 50, audioKbps: 128 }, meta);
  assert.equal(p.mode, 'size');
  assert.equal(p.twoPass, true);
  // 50% of 1000MiB = 500MiB over 600s.
  const expected = videoKbpsForTargetBytes(500 * 1024 * 1024, 600, 128);
  assert.equal(p.videoKbps, expected);
});

test('mb method uses MiB target', () => {
  const p = plan({ method: 'mb', targetMB: 200, audioKbps: 128 }, meta);
  assert.equal(p.videoKbps, videoKbpsForTargetBytes(200 * 1024 * 1024, 600, 128));
});

test('bitrate method passes kbps through, single pass', () => {
  const p = plan({ method: 'bitrate', videoKbps: 4000 }, meta);
  assert.equal(p.mode, 'bitrate');
  assert.equal(p.videoKbps, 4000);
  assert.equal(p.twoPass, false);
});

test('resolution method is crf single-pass and never upscales', () => {
  const up = plan({ method: 'resolution', scaleHeight: 2160 }, meta);
  assert.equal(up.mode, 'crf');
  assert.equal(up.scaleHeight, null, '2160 > 1080 source should be skipped');

  const down = plan({ method: 'resolution', scaleHeight: 720 }, meta);
  assert.equal(down.scaleHeight, 720);
});

test('throws when target too small for audio', () => {
  assert.throws(() => videoKbpsForTargetBytes(1 * 1024 * 1024, 600, 128));
});

test('throws when duration unknown', () => {
  assert.throws(() => videoKbpsForTargetBytes(100 * 1024 * 1024, 0, 128));
});
