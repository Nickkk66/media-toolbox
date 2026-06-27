'use strict';

// YouTube (and other yt-dlp-supported sites) downloader/converter.
// Uses bundled yt-dlp + ffmpeg to fetch info and download as MP4 or extract MP3.

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('./ffmpeg/ffmpegPath');

function ffmpegDir() {
  return path.dirname(ffmpegPath.ffmpeg);
}

// Fetch metadata for a URL (single video, no playlist).
function info(url) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath.hasYtdlp()) return reject(new Error('yt-dlp is not available in this build.'));
    execFile(
      ffmpegPath.ytdlp,
      ['-J', '--no-playlist', '--no-warnings', url],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`Couldn't read that URL: ${(stderr || err.message).split('\n')[0]}`));
        let d;
        try { d = JSON.parse(stdout); } catch { return reject(new Error('Could not parse video info.')); }
        // Distinct video heights available.
        const heights = [...new Set((d.formats || [])
          .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
          .map((f) => f.height))].sort((a, b) => b - a);
        resolve({
          id: d.id,
          title: d.title || 'video',
          uploader: d.uploader || d.channel || '',
          durationSec: d.duration || 0,
          thumbnail: d.thumbnail || '',
          heights,
          webpage: d.webpage_url || url,
        });
      }
    );
  });
}

// opts: { url, mode:'video'|'audio', height, audioFormat, audioKbps, outputDir }
// Returns a controller { promise, cancel }.
function download(opts, onProgress) {
  const { url, mode, height, audioFormat, audioKbps, subMode, outputDir } = opts;
  const outDir = outputDir || process.cwd();
  const outTmpl = path.join(outDir, 'MTB_%(title).180B [%(id)s].%(ext)s');

  const args = [
    '--no-playlist', '--no-warnings', '--newline',
    '--ffmpeg-location', ffmpegDir(),
    '-o', outTmpl,
    '--print', 'after_move:filepath',
  ];

  if (mode === 'transcription') {
    // Download captions / transcript as .srt (manual subs, else auto-generated).
    args.push('--skip-download', '--write-subs', '--write-auto-subs',
      '--sub-langs', 'en.*,en', '--convert-subs', 'srt', '--no-simulate');
    // 'captions' = keep the .srt as-is; 'with'/'without' handled after download.
  } else if (mode === 'audio') {
    args.push('--no-simulate', '-x', '--audio-format', audioFormat || 'mp3');
    if (audioKbps) args.push('--audio-quality', `${audioKbps}K`);
  } else {
    args.push('--no-simulate');
    const h = Number(height) || 0;
    const sel = h > 0 ? `bv*[height<=${h}]+ba/b[height<=${h}]` : 'bv*+ba/b';
    args.push('-f', sel, '--merge-output-format', audioFormat || 'mp4');
  }
  args.push(url);

  let proc = null;
  let canceled = false;
  let finalPath = '';
  let stderrTail = '';

  const promise = new Promise((resolve, reject) => {
    proc = spawn(ffmpegPath.ytdlp, args, { windowsHide: true });

    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });
    proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-3000); });

    function handleLine(line) {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) { onProgress && onProgress({ percent: parseFloat(m[1]), phase: 'download' }); return; }
      if (/\[(ExtractAudio|Merger|VideoConvertor|Embed)/.test(line)) {
        onProgress && onProgress({ percent: 99, phase: 'processing' });
        return;
      }
      // Subtitle file written (transcription mode).
      const sub = /Writing video subtitles to:\s*(.+\.srt)\s*$/.exec(line) || /Destination:\s*(.+\.srt)\s*$/.exec(line);
      if (sub && fs.existsSync(sub[1].trim())) { finalPath = sub[1].trim(); return; }
      // --print after_move:filepath emits the final path on its own line.
      if (line && !line.startsWith('[') && /\.[A-Za-z0-9]{2,4}$/.test(line) && fs.existsSync(line)) {
        finalPath = line;
      }
    }

    proc.on('error', (err) => reject(new Error(`Failed to start yt-dlp: ${err.message}`)));
    proc.on('close', (code) => {
      if (canceled) return reject(new Error('canceled'));
      if (code !== 0) return reject(new Error(`yt-dlp failed (code ${code})\n${stderrTail}`));

      // Transcription: locate the .srt if not captured, and optionally strip timestamps.
      if (mode === 'transcription') {
        if (!finalPath || !/\.srt$/i.test(finalPath)) {
          try {
            const srt = fs.readdirSync(outDir).filter((f) => /\.srt$/i.test(f))
              .map((f) => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
              .sort((a, b) => b.t - a.t)[0];
            if (srt) finalPath = path.join(outDir, srt.f);
          } catch { /* */ }
        }
        if (!finalPath) return reject(new Error('No captions/transcript available for this video.'));
        if (subMode === 'without' && /\.srt$/i.test(finalPath)) {
          finalPath = stripTimestamps(finalPath);
        }
      }
      let outSize = 0;
      try { if (finalPath) outSize = fs.statSync(finalPath).size; } catch { /* ignore */ }
      return resolve({ outputPath: finalPath, outSize });
    });
  });

  function cancel() {
    canceled = true;
    if (proc && !proc.killed) {
      proc.kill();
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ignore */ }
      }
    }
  }

  return { promise, cancel };
}

// Strip SRT indices + timestamps → plain text transcript (.txt).
function stripTimestamps(srtPath) {
  const txtPath = srtPath.replace(/\.srt$/i, '.txt');
  try {
    const text = fs.readFileSync(srtPath, 'utf8');
    const lines = text.split(/\r?\n/);
    const out = [];
    let prev = '';
    for (const ln of lines) {
      if (/^\d+$/.test(ln.trim())) continue;
      if (/-->/.test(ln)) continue;
      const clean = ln.replace(/<[^>]+>/g, '').trim();
      if (clean && clean !== prev) { out.push(clean); prev = clean; }
    }
    fs.writeFileSync(txtPath, out.join('\n'));
    return txtPath;
  } catch { return srtPath; }
}

module.exports = { info, download };

