'use strict';

// Manual sanity check (not part of `npm test`): prints generated ffmpeg arg
// arrays for several scenarios so we can eyeball correctness.

const { build } = require('../src/main/ffmpeg/buildArgs');
const { plan } = require('../src/main/ffmpeg/bitrate');

const meta = {
  durationSec: 600,
  sizeBytes: 1000 * 1024 * 1024,
  video: { width: 1920, height: 1080 },
  hasAudio: true,
  audios: [{ channels: 2 }],
};

const detected = {
  h264: { cpu: 'libx264', nvenc: 'h264_nvenc', amf: 'h264_amf', qsv: 'h264_qsv' },
  hevc: { cpu: 'libx265', nvenc: 'hevc_nvenc', amf: 'hevc_amf', qsv: 'hevc_qsv' },
};

function show(title, settings) {
  const p = plan(settings, meta);
  const b = build({
    plan: p,
    settings,
    meta,
    detected,
    inputPath: 'C:\\vids\\in.mp4',
    outputPath: 'C:\\vids\\out.mp4',
    passlogPrefix: 'C:\\tmp\\vc_job1',
  });
  console.log(`\n=== ${title} === (encoder=${b.encoder}, passes=${b.passes.length})`);
  b.passes.forEach((pass, i) => console.log(`  pass${i + 1}: ffmpeg ${pass.join(' ')}`));
}

show('MB target, H.264 CPU two-pass', {
  codec: 'h264', encoder: 'cpu', method: 'mb', targetMB: 200, audioKbps: 128,
});
show('Percent target, H.265 NVENC', {
  codec: 'hevc', encoder: 'nvenc', method: 'percent', percent: 50, audioKbps: 128,
});
show('Resolution 720p, H.264 CPU CRF', {
  codec: 'h264', encoder: 'cpu', method: 'resolution', scaleHeight: 720, audioKbps: 128,
});
show('Max bitrate 4000k, H.264 NVENC', {
  codec: 'h264', encoder: 'nvenc', method: 'bitrate', videoKbps: 4000, audioKbps: 128,
});
show('MB target + 720p + hard subs, H.264 CPU', {
  codec: 'h264', encoder: 'cpu', method: 'mb', targetMB: 150, scaleHeight: 720,
  audioKbps: 128, subtitle: { path: 'C:\\subs\\my movie.srt', mode: 'hard' },
});
show('Percent + soft subs + compatibility, H.264 CPU', {
  codec: 'h264', encoder: 'cpu', method: 'percent', percent: 60, audioKbps: 128,
  compatibility: true, subtitle: { path: 'C:\\subs\\s.srt', mode: 'soft' },
});
