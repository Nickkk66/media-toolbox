'use strict';

// Parses ffmpeg `-progress pipe:1` output (key=value blocks on stdout, each
// terminated by a `progress=continue|end` line) into progress events.

const readline = require('readline');

// Attach a progress parser to a child process. `durationSec` is the clip length;
// `onUpdate({percent, speed, fps, outTimeSec})` is called per block. `phase`
// maps the 0-100 into a sub-range (e.g. [0,50] for pass 1).
function attach(proc, durationSec, onUpdate, range = [0, 100]) {
  const rl = readline.createInterface({ input: proc.stdout });
  let acc = {};
  const [lo, hi] = range;

  rl.on('line', (line) => {
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    acc[key] = val;

    if (key === 'progress') {
      let outTimeSec = 0;
      if (acc.out_time_us) outTimeSec = parseInt(acc.out_time_us, 10) / 1e6;
      else if (acc.out_time_ms) outTimeSec = parseInt(acc.out_time_ms, 10) / 1e3; // older builds: us mislabeled? keep both
      else if (acc.out_time) outTimeSec = hmsToSec(acc.out_time);

      const speed = acc.speed ? parseFloat(acc.speed) : 0;
      const fps = acc.fps ? parseFloat(acc.fps) : 0;

      let frac = durationSec > 0 ? outTimeSec / durationSec : 0;
      frac = Math.max(0, Math.min(1, frac));
      const percent = lo + frac * (hi - lo);

      onUpdate({
        percent: Math.max(0, Math.min(100, percent)),
        speed,
        fps,
        outTimeSec,
        done: val === 'end',
      });
      acc = {};
    }
  });

  return () => rl.close();
}

function hmsToSec(str) {
  // HH:MM:SS.ms
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(str);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

module.exports = { attach, hmsToSec };
