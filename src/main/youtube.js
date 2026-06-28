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
  const { url, mode, height, audioFormat, audioKbps, subMode, thumbnail, outputDir } = opts;
  const outDir = outputDir || process.cwd();
  const outTmpl = path.join(outDir, 'MTB_%(title).180B [%(id)s].%(ext)s');

  const args = [
    '--no-playlist', '--no-warnings', '--newline',
    '--ffmpeg-location', ffmpegDir(),
    '-o', outTmpl,
    '--print', 'after_move:filepath',
  ];
  // Also save the thumbnail as a separate image file (legacy "also download" flag).
  if (thumbnail && mode !== 'transcription' && mode !== 'thumbnail') args.push('--write-thumbnail');

  if (mode === 'thumbnail') {
    // Download ONLY the thumbnail image (no media). Convert to jpg for broad
    // compatibility (webp thumbnails don't open everywhere on Windows).
    args.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg');
  } else if (mode === 'transcription') {
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
    // Container: default mp4 (broadly compatible). Honor an explicit webm/mkv choice.
    const container = (audioFormat === 'webm' || audioFormat === 'mkv') ? audioFormat : 'mp4';
    let sel;
    if (container === 'mp4') {
      // Prefer H.264 (avc1) video + AAC (m4a) audio in MP4 so Windows Media Player
      // (and most players/devices) can play it. AV1/Opus/VP9 are avoided by default.
      const hc = h > 0 ? `[height<=${h}]` : '';
      sel = `bv*[vcodec^=avc1]${hc}+ba[acodec^=mp4a]/bv*[ext=mp4]${hc}+ba[ext=m4a]/b[ext=mp4]${hc}/bv*${hc}+ba/b${hc}`;
    } else {
      // User explicitly asked for webm/mkv — just respect a height cap if any.
      sel = h > 0 ? `bv*[height<=${h}]+ba/b[height<=${h}]` : 'bv*+ba/b';
    }
    args.push('-f', sel, '--merge-output-format', container);
  }
  args.push(url);

  let proc = null;
  let canceled = false;
  let finalPath = '';
  let stderrTail = '';
  const startedAt = Date.now();

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
      // Thumbnail file written (thumbnail mode). After --convert-thumbnails the
      // final file is the .jpg; capture it if yt-dlp prints the path.
      if (mode === 'thumbnail') {
        const thm = /thumbnail .*? to:\s*(.+\.(?:jpg|jpeg|png|webp))\s*$/i.exec(line)
          || /Destination:\s*(.+\.(?:jpg|jpeg|png|webp))\s*$/i.exec(line);
        if (thm && fs.existsSync(thm[1].trim())) { finalPath = thm[1].trim(); return; }
      }
      // --print after_move:filepath emits the final path on its own line.
      if (line && !line.startsWith('[') && /\.[A-Za-z0-9]{2,4}$/.test(line) && fs.existsSync(line)) {
        finalPath = line;
      }
    }

    proc.on('error', (err) => reject(new Error(`Failed to start yt-dlp: ${err.message}`)));
    proc.on('close', (code) => {
      if (canceled) return reject(new Error('canceled'));
      if (code !== 0) return reject(new Error(`yt-dlp failed (code ${code})\n${stderrTail}`));

      // Thumbnail-only: the --print line won't fire (--skip-download), so locate
      // the newest image file written to outDir.
      if (mode === 'thumbnail') {
        if (!finalPath || !/\.(jpg|jpeg|png|webp)$/i.test(finalPath)) {
          try {
            const imgs = fs.readdirSync(outDir)
              .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
              .map((f) => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
              .filter((o) => o.t >= startedAt - 1000)
              .sort((a, b) => b.t - a.t)[0];
            if (imgs) finalPath = imgs.p;
          } catch { /* */ }
        }
        if (!finalPath) return reject(new Error('No thumbnail available for this video.'));
        let tSize = 0;
        try { tSize = fs.statSync(finalPath).size; } catch { /* */ }
        return resolve({ outputPath: finalPath, outSize: tSize });
      }

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
      } else if (!finalPath || !fs.existsSync(finalPath)) {
        // Video/audio: the --print after_move:filepath line wasn't captured.
        // Fall back to the newest non-thumbnail media file in outDir.
        try {
          const cand = fs.readdirSync(outDir)
            .filter((f) => !/\.(jpg|jpeg|png|webp)$/i.test(f))
            .map((f) => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
            .filter((o) => o.t >= startedAt - 1000)
            .sort((a, b) => b.t - a.t)[0];
          if (cand) finalPath = cand.p;
        } catch { /* */ }
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

