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
      '--sub-langs', 'en.*,en', '--convert-subs', 'srt', '--no-simulate',
      // Be gentle so YouTube doesn't 429 the (many) caption requests, and don't let
      // one failed track abort the whole job.
      '--ignore-errors', '--no-abort-on-error',
      '--sleep-subtitles', '2', '--extractor-retries', '3', '--retries', '5');
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
  let settled = false;
  let rejectPromise = null;
  let finalPath = '';
  let stderrTail = '';
  const startedAt = Date.now();

  // Remove any partial/temp output files yt-dlp may have written for this job.
  function cleanupPartials() {
    try {
      const re = /\.(part|ytdl|temp|tmp)$/i;
      for (const f of fs.readdirSync(outDir)) {
        try {
          const p = path.join(outDir, f);
          const st = fs.statSync(p);
          if (st.mtimeMs >= startedAt - 1000 && (re.test(f) || /\.part-Frag\d+/i.test(f))) {
            fs.unlinkSync(p);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
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

    proc.on('error', (err) => { if (settled) return; settled = true; reject(new Error(`Failed to start yt-dlp: ${err.message}`)); });
    proc.on('close', (code) => {
      if (settled) return;
      if (canceled) { settled = true; return reject(new Error('canceled')); }
      settled = true;

      // yt-dlp can exit non-zero (e.g. a 429 on ONE caption track) while still
      // having written a usable file. So locate the output FIRST and only treat a
      // non-zero exit as fatal when nothing was produced.
      if (mode === 'thumbnail') {
        // --skip-download means the --print line won't fire; find the newest image.
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
      } else if (mode === 'transcription') {
        if (!finalPath || !/\.srt$/i.test(finalPath)) {
          try {
            const srt = fs.readdirSync(outDir).filter((f) => /\.srt$/i.test(f))
              .map((f) => ({ p: path.join(outDir, f), t: fs.statSync(path.join(outDir, f)).mtimeMs }))
              .filter((o) => o.t >= startedAt - 1000)
              .sort((a, b) => b.t - a.t)[0];
            if (srt) finalPath = srt.p;
          } catch { /* */ }
        }
        if (finalPath && subMode === 'without' && /\.srt$/i.test(finalPath)) {
          const srtSrc = finalPath;
          const txt = stripTimestamps(srtSrc);
          // Only one file should remain: delete the source .srt so just the .txt is returned.
          if (txt !== srtSrc) { try { fs.unlinkSync(srtSrc); } catch { /* ignore */ } }
          finalPath = txt;
        } else if (finalPath && /\.srt$/i.test(finalPath)) {
          // with / captions → keep only the .srt; remove any stray sibling .txt.
          const stray = finalPath.replace(/\.srt$/i, '.txt');
          if (stray !== finalPath) { try { if (fs.existsSync(stray)) fs.unlinkSync(stray); } catch { /* ignore */ } }
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

      // Got a usable file → success, even if the exit code was non-zero.
      if (finalPath && fs.existsSync(finalPath)) {
        let outSize = 0;
        try { outSize = fs.statSync(finalPath).size; } catch { /* */ }
        return resolve({ outputPath: finalPath, outSize });
      }

      // Nothing produced → a helpful error (rate-limit gets a friendly message).
      if (/429|Too Many Requests/i.test(stderrTail)) {
        return reject(new Error(mode === 'transcription'
          ? 'YouTube rate-limited the caption requests (HTTP 429). Wait a few minutes and try again — or download the video and use the Subtitle / Transcript Extractor tool (runs on-device, no rate limits).'
          : 'YouTube rate-limited this request (HTTP 429). Wait a few minutes and try again.'));
      }
      if (mode === 'transcription') return reject(new Error('No captions/transcript available for this video.'));
      if (mode === 'thumbnail') return reject(new Error('No thumbnail available for this video.'));
      return reject(new Error(`yt-dlp failed (code ${code})\n${(stderrTail || '').split('\n').slice(-3).join('\n')}`));
    });
  });

  function cancel() {
    canceled = true;
    // Force-kill the whole process tree promptly. On Windows yt-dlp spawns child
    // processes (ffmpeg, etc.) so a plain kill on the parent isn't enough.
    if (proc) {
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch { /* ignore */ }
      }
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    // Reject the in-flight promise immediately rather than waiting for 'close',
    // then clean up any partial output once the process has had a moment to release files.
    if (!settled) {
      settled = true;
      if (rejectPromise) rejectPromise(new Error('canceled'));
    }
    cleanupPartials();
    setTimeout(cleanupPartials, 400);
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

