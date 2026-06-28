'use strict';

// Spotify Downloader — replicates spotDL's approach with the BUNDLED yt-dlp +
// ffmpeg. We do NOT pull audio from Spotify. Instead we:
//   1) read a track's public metadata + album art from Spotify's open embed page
//      (no API key, no login), then
//   2) find the matching track on YouTube via yt-dlp's ytsearch, download the
//      audio, and tag it with the Spotify metadata + embedded cover.
//
// Legal/ToS note: this matches the track on YouTube and downloads from there —
// it does NOT access Spotify's protected audio stream. This is the same method
// spotDL uses. Only download content you have the rights to.

const https = require('https');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegPath = require('./ffmpeg/ffmpegPath');

function ffmpegDir() {
  return path.dirname(ffmpegPath.ffmpeg);
}

// ---- URL / id handling --------------------------------------------------

// Accept a track URL (https://open.spotify.com/track/<id>, with optional ?si=…),
// a spotify:track:<id> URI, or a bare id → return the 22-char base62 id.
function trackId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // spotify:track:<id>
  let m = /spotify:track:([A-Za-z0-9]+)/.exec(s);
  if (m) return m[1];
  // open.spotify.com/.../track/<id>  (handles /intl-xx/ locale prefixes too)
  m = /track[/:]([A-Za-z0-9]{6,})/.exec(s);
  if (m) return m[1];
  // Bare id.
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s;
  return '';
}

// ---- HTTP GET (follows redirects) --------------------------------------

function httpGet(url, { binary = false, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // A browser-ish UA so Spotify serves the full embed markup.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: '*/*',
      },
    }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpGet(next, { binary, redirects: redirects - 1 }));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} from ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(binary ? buf : buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('Request timed out.')); });
  });
}

// ---- metadata extraction -----------------------------------------------

function metaTag(html, prop) {
  // <meta property="og:title" content="…"> (property or name).
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = re.exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return m ? decodeEntities(m[1]) : '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return _; } });
}

// Pick the largest image URL from a coverArt / visualIdentity sources array.
function largestImage(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  let best = null;
  for (const s of sources) {
    if (!s || !s.url) continue;
    const area = (s.width || 0) * (s.height || 0);
    if (!best || area > best.area) best = { url: s.url, area };
  }
  return best ? best.url : (sources[0] && sources[0].url) || '';
}

// Recursively hunt for a node that looks like the track entity inside the
// __NEXT_DATA__ blob (its shape changes over time; be defensive).
function findEntity(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.name && (obj.artists || obj.subtitle || obj.coverArt || obj.visualIdentity) && obj.type !== 'album') {
    return obj;
  }
  for (const k of Object.keys(obj)) {
    const found = findEntity(obj[k]);
    if (found) return found;
  }
  return null;
}

function parseNextData(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const entity = findEntity(data);
  if (!entity) return null;

  const name = entity.name || entity.title || '';
  // artists: [{ name }] | subtitle string | artist names array
  let artists = [];
  if (Array.isArray(entity.artists)) {
    artists = entity.artists.map((a) => (a && (a.name || a.profile && a.profile.name)) || '').filter(Boolean);
  }
  if (!artists.length && entity.subtitle) artists = [entity.subtitle];

  // album: prefer an explicit album field; else leave blank.
  let album = '';
  if (entity.album && entity.album.name) album = entity.album.name;
  else if (typeof entity.album === 'string') album = entity.album;

  // release date / year
  let date = '';
  const rd = entity.releaseDate || (entity.album && entity.album.date) || entity.date;
  if (rd) {
    if (typeof rd === 'string') date = rd;
    else if (rd.isoString) date = rd.isoString;
    else if (rd.year) date = String(rd.year);
  }

  // duration (ms)
  let durationSec = 0;
  if (entity.duration && entity.duration.totalMilliseconds) durationSec = Math.round(entity.duration.totalMilliseconds / 1000);
  else if (typeof entity.duration === 'number') durationSec = Math.round(entity.duration / 1000);
  else if (entity.durationMs) durationSec = Math.round(entity.durationMs / 1000);

  // cover art: visualIdentity.image[] or coverArt.sources[]
  let coverUrl = '';
  if (entity.visualIdentity && Array.isArray(entity.visualIdentity.image)) coverUrl = largestImage(entity.visualIdentity.image);
  if (!coverUrl && entity.coverArt && Array.isArray(entity.coverArt.sources)) coverUrl = largestImage(entity.coverArt.sources);

  return { name, artists, album, date, durationSec, coverUrl };
}

// oEmbed fallback (title + thumbnail only, no album/artist split).
async function oembed(url) {
  try {
    const json = JSON.parse(await httpGet(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`));
    return { title: json.title || '', coverUrl: json.thumbnail_url || '' };
  } catch { return null; }
}

// info(spotifyUrl) → { id, title, artists, artist, album, year, durationSec, coverUrl, coverDataUrl }
async function info(spotifyUrl) {
  const id = trackId(spotifyUrl);
  if (!id) throw new Error('That doesn\'t look like a Spotify track link.');
  const embedUrl = `https://open.spotify.com/embed/track/${id}`;

  let parsed = null;
  let html = '';
  try { html = await httpGet(embedUrl); } catch { /* fall through to fallbacks */ }

  if (html) parsed = parseNextData(html);

  // Fallback 1: og: meta tags from the embed (or normal) page.
  if (!parsed && html) {
    const ogTitle = metaTag(html, 'og:title');
    const ogDesc = metaTag(html, 'og:description'); // often "Song · Artist · Year"
    const ogImage = metaTag(html, 'og:image');
    if (ogTitle || ogImage) {
      let artists = [];
      let album = '';
      let date = '';
      if (ogDesc) {
        const parts = ogDesc.split('·').map((s) => s.trim()).filter(Boolean);
        // Common shapes: "Song · Artist · Album · Year" or "Artist · Song".
        if (parts.length >= 2) artists = [parts[1]];
        if (parts.length >= 3) album = parts[2];
        const ym = /\b(19|20)\d{2}\b/.exec(ogDesc);
        if (ym) date = ym[0];
      }
      parsed = { name: ogTitle, artists, album, date, durationSec: 0, coverUrl: ogImage };
    }
  }

  // Fallback 2: oEmbed.
  if (!parsed) {
    const oe = await oembed(`https://open.spotify.com/track/${id}`);
    if (oe) parsed = { name: oe.title, artists: [], album: '', date: '', durationSec: 0, coverUrl: oe.coverUrl };
  }

  if (!parsed || !parsed.name) throw new Error('Could not read this track from Spotify.');

  const year = (parsed.date && /(\d{4})/.exec(parsed.date)) ? /(\d{4})/.exec(parsed.date)[1] : '';
  const artists = (parsed.artists && parsed.artists.length) ? parsed.artists : [];
  const artist = artists.join(', ');

  // Download the cover bytes → data URL for the renderer preview (CSP-safe).
  let coverDataUrl = '';
  if (parsed.coverUrl) {
    try {
      const buf = await httpGet(parsed.coverUrl, { binary: true });
      const ext = /\.png(\?|$)/i.test(parsed.coverUrl) ? 'png' : 'jpeg';
      coverDataUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
    } catch { /* preview is optional */ }
  }

  return {
    id,
    title: parsed.name,
    artists,
    artist,
    album: parsed.album || '',
    year,
    date: parsed.date || '',
    durationSec: parsed.durationSec || 0,
    coverUrl: parsed.coverUrl || '',
    coverDataUrl,
  };
}

// ---- download helpers ---------------------------------------------------

// Sanitize a string for use in a filename.
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'track';
}

function uniqueOutput(dir, base, ext) {
  let candidate = path.join(dir, `MTB_${base}.${ext}`);
  let n = 1;
  while (fs.existsSync(candidate)) { candidate = path.join(dir, `MTB_${base} (${n}).${ext}`); n += 1; }
  return candidate;
}

// Download the cover image to a temp jpg (convert via ffmpeg if it isn't jpg).
async function fetchCoverJpg(coverUrl, tmpDir) {
  if (!coverUrl) return '';
  const raw = await httpGet(coverUrl, { binary: true });
  const isJpg = /\.jpe?g(\?|$)/i.test(coverUrl) || (raw[0] === 0xff && raw[1] === 0xd8);
  const srcPath = path.join(tmpDir, `cover_src_${Date.now()}${isJpg ? '.jpg' : '.img'}`);
  fs.writeFileSync(srcPath, raw);
  if (isJpg) return srcPath;
  // Convert to jpg with ffmpeg for broad compatibility.
  const jpgPath = path.join(tmpDir, `cover_${Date.now()}.jpg`);
  await new Promise((resolve, reject) => {
    execFile(ffmpegPath.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', srcPath, jpgPath],
      { windowsHide: true }, (err) => err ? reject(new Error('Cover conversion failed.')) : resolve());
  });
  try { fs.unlinkSync(srcPath); } catch { /* */ }
  return jpgPath;
}

// download(opts, onProgress) → { promise, cancel }
// opts: { spotifyUrl, what:'song'|'cover', withMetadata, embedCover, outputDir }
function download(opts, onProgress) {
  const { spotifyUrl, what = 'song', withMetadata = true, embedCover = true, outputDir } = opts || {};
  const outDir = outputDir || process.cwd();

  let proc = null;          // the active yt-dlp/ffmpeg child
  let canceled = false;
  const tmpFiles = [];
  let tmpDir = '';

  const killProc = () => {
    if (proc && !proc.killed) {
      try { proc.kill(); } catch { /* */ }
      if (process.platform === 'win32' && proc.pid) {
        try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch { /* */ }
      }
    }
  };

  const cleanup = () => {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* */ } }
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } }
  };

  const promise = (async () => {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* */ }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtb-spot-'));

    onProgress && onProgress({ percent: 1, phase: 'info' });
    const meta = await info(spotifyUrl);
    if (canceled) throw new Error('canceled');

    const baseName = safeName(`${meta.artist || 'Unknown'} - ${meta.title}`);

    // ---- cover-only ----
    if (what === 'cover') {
      onProgress && onProgress({ percent: 30, phase: 'download' });
      const jpg = await fetchCoverJpg(meta.coverUrl, tmpDir);
      if (!jpg || !fs.existsSync(jpg)) throw new Error('No album cover found for this track.');
      const outPath = uniqueOutput(outDir, `${baseName} cover`, 'jpg');
      fs.copyFileSync(jpg, outPath);
      onProgress && onProgress({ percent: 100, phase: 'done' });
      let outSize = 0; try { outSize = fs.statSync(outPath).size; } catch { /* */ }
      return { outputPath: outPath, outSize };
    }

    // ---- song: find + download from YouTube ----
    if (!ffmpegPath.hasYtdlp()) throw new Error('yt-dlp is not available in this build.');

    // Pre-fetch the cover (for embedding) while we have the metadata.
    let coverJpg = '';
    if (embedCover && withMetadata && meta.coverUrl) {
      try { coverJpg = await fetchCoverJpg(meta.coverUrl, tmpDir); } catch { coverJpg = ''; }
    }
    if (canceled) throw new Error('canceled');

    // Search query biases toward the official "Artist - Topic" auto audio.
    const query = `ytsearch1:${meta.artist} ${meta.title} audio`;
    const rawTmpl = path.join(tmpDir, 'dl.%(ext)s');
    const args = [
      '--no-playlist', '--no-warnings', '--newline',
      '--ffmpeg-location', ffmpegDir(),
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '-o', rawTmpl,
      '--print', 'after_move:filepath',
      query,
    ];

    const dlPath = await new Promise((resolve, reject) => {
      let finalPath = '';
      let buf = '';
      let stderrTail = '';
      proc = spawn(ffmpegPath.ytdlp, args, { windowsHide: true });

      proc.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          const m = /\[download\]\s+([\d.]+)%/.exec(line);
          if (m) { onProgress && onProgress({ percent: parseFloat(m[1]) * 0.85, phase: 'download' }); continue; }
          if (/\[(ExtractAudio|Merger|VideoConvertor)/.test(line)) { onProgress && onProgress({ percent: 88, phase: 'processing' }); continue; }
          if (line && !line.startsWith('[') && /\.[A-Za-z0-9]{2,4}$/.test(line) && fs.existsSync(line)) finalPath = line;
        }
      });
      proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-3000); });
      proc.on('error', (err) => reject(new Error(`Failed to start yt-dlp: ${err.message}`)));
      proc.on('close', (code) => {
        proc = null;
        if (canceled) return reject(new Error('canceled'));
        // Fallback: newest .mp3 in tmpDir.
        if (!finalPath || !fs.existsSync(finalPath)) {
          try {
            const cand = fs.readdirSync(tmpDir).filter((f) => /\.mp3$/i.test(f))
              .map((f) => path.join(tmpDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
            if (cand) finalPath = cand;
          } catch { /* */ }
        }
        if (finalPath && fs.existsSync(finalPath)) return resolve(finalPath);
        if (/429|Too Many Requests/i.test(stderrTail)) return reject(new Error('YouTube rate-limited this request (HTTP 429). Wait a few minutes and try again.'));
        return reject(new Error(`Couldn't find/download a matching track (code ${code}).`));
      });
    });
    tmpFiles.push(dlPath);
    if (canceled) throw new Error('canceled');

    const outPath = uniqueOutput(outDir, baseName, 'mp3');

    // No metadata → just move the plain mp3 to the output.
    if (!withMetadata) {
      fs.copyFileSync(dlPath, outPath);
      onProgress && onProgress({ percent: 100, phase: 'done' });
      let outSize = 0; try { outSize = fs.statSync(outPath).size; } catch { /* */ }
      return { outputPath: outPath, outSize };
    }

    onProgress && onProgress({ percent: 92, phase: 'tagging' });

    // Tag (and optionally embed the cover) with ffmpeg in one pass.
    const tagArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', dlPath];
    const hasCover = embedCover && coverJpg && fs.existsSync(coverJpg);
    if (hasCover) tagArgs.push('-i', coverJpg);
    if (hasCover) {
      tagArgs.push('-map', '0:a', '-map', '1', '-c', 'copy', '-id3v2_version', '3',
        '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)',
        '-disposition:v', 'attached_pic');
    } else {
      tagArgs.push('-map', '0:a', '-c', 'copy', '-id3v2_version', '3');
    }
    tagArgs.push('-metadata', `title=${meta.title}`);
    if (meta.artist) tagArgs.push('-metadata', `artist=${meta.artist}`);
    if (meta.album) tagArgs.push('-metadata', `album=${meta.album}`);
    if (meta.artist) tagArgs.push('-metadata', `album_artist=${meta.artists[0] || meta.artist}`);
    if (meta.date) tagArgs.push('-metadata', `date=${meta.date}`);
    if (meta.year) tagArgs.push('-metadata', `year=${meta.year}`);
    tagArgs.push(outPath);

    await new Promise((resolve, reject) => {
      proc = spawn(ffmpegPath.ffmpeg, tagArgs, { windowsHide: true });
      let stderrTail = '';
      proc.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-3000); });
      proc.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)));
      proc.on('close', (code) => {
        proc = null;
        if (canceled) return reject(new Error('canceled'));
        if (code === 0 && fs.existsSync(outPath)) return resolve();
        // If tagging failed, fall back to the untagged file so the user still gets audio.
        try { if (!fs.existsSync(outPath)) fs.copyFileSync(dlPath, outPath); resolve(); }
        catch { reject(new Error((stderrTail.split('\n').filter(Boolean).pop()) || 'Tagging failed.')); }
      });
    });

    onProgress && onProgress({ percent: 100, phase: 'done' });
    let outSize = 0; try { outSize = fs.statSync(outPath).size; } catch { /* */ }
    return { outputPath: outPath, outSize };
  })().finally(cleanup);

  function cancel() {
    canceled = true;
    killProc();
  }

  return { promise, cancel };
}

module.exports = { info, download, trackId };
