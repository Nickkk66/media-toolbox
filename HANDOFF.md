# media toolbox — project handoff

A complete reference for continuing work in a new chat. Paste/point to this file.

---

## 1. What it is

A **local Windows desktop app** (Electron) that converts, compresses, edits and
downloads media — **fully offline, no upload, no file-size limit**. Born as a
FreeConvert-style "video compressor for files >1 GB", now a full media suite.
Everything runs against **bundled binaries** so recipients install nothing.

- **Project dir:** `C:\Users\nicky\Downloads\Projects\Video Compressor`
- **GitHub:** https://github.com/pipelinear/media-toolbox (public) — already pushed.
- **In-app brand:** "media toolbox". **Installer/product name:** "Video Compressor" (kept for continuity).
- **Design language:** teenage-engineering (see `DESIGN.md`) — near-white `#f6f8f7`
  canvas, hairline-thin Inter/Segoe (weights 100/300), **zero border-radius**,
  no shadows, monochrome + `#0071bb` links. Dark theme also available.

---

## 2. Tech stack

- **Electron 33**, frameless window, custom titlebar.
- **Renderer:** vanilla HTML/CSS/JS (NO React/Tailwind/TS/shadcn). Locked-down
  preload (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`).
- **Main:** Node, shells out to bundled binaries via `child_process`.
- **Packaging:** `electron-builder` → NSIS installer + portable exe (~160 MB).
- No runtime npm deps; dev deps = electron, electron-builder.

### Bundled tools (in `vendor/`, copied to `resources/` on build via `extraResources`)
| Tool | Location | Used for |
|------|----------|----------|
| ffmpeg.exe, ffprobe.exe | `vendor/bin` | all video/audio/image/gif work (NVENC/QSV/AMF HW accel) |
| yt-dlp.exe | `vendor/bin` | YouTube + 20 sites download/transcripts |
| 7za.exe | `vendor/bin` | archive converter (zip/7z/tar) |
| gswin64c.exe + gsdll64.dll | `vendor/gs` | PDF compress / pdf↔image / protect / flatten / resize |
| qpdf.exe + 4 DLLs | `vendor/qpdf` | PDF split / extract / remove / rotate / unlock |

Resolved at runtime by `src/main/ffmpeg/ffmpegPath.js` (prod = `resources/<dir>`,
dev = `vendor/<dir>`, else PATH). Binaries are git-ignored (size + licenses).

---

## 3. File structure

```
src/
  main/
    main.js              app lifecycle, frameless window, single-instance, self-check
    ipc.js               ALL ipc handlers (jobs, dialogs, settings, meta, pdf merge, window ctrls)
    queue.js             serial job queue (concurrency 1), pause/resume/cancel
    settings.js          persisted settings (userData/settings.json): perf limits, theme, a11y, download loc
    youtube.js           yt-dlp info/download (video/audio/transcription + thumbnail)
    ffmpeg/
      ffmpegPath.js      resolves bundled binaries (ffmpeg/ffprobe/gs/ytdlp/7za/qpdf)
      probe.js           ffprobe -> metadata
      encoders.js        detect cpu/nvenc/qsv/amf
      bitrate.js         PURE: target-size -> video kbps math (unit-tested)
      buildArgs.js       PURE: video ffmpeg args (2-pass, NVENC, crf, resize, fps, rotate, flip,
                         audio codec/volume/fade/remove, trim, crop, subtitles, compatibility)
      runJob.js          spawn binary, progress, pause(suspend)/resume/cancel, thread cap, finalize hook
      progress.js        parse ffmpeg -progress pipe:1
    media/
      index.js           registry: extension->type + getByType + describe
      video.js image.js gif.js audio.js pdf.js         (compress/convert modules)
      pdf2img.js img2pdf.js archive.js                 (converters)
      imageop.js videoop.js pdfop.js                   (tools: resize/rotate/flip/crop/stretch/trim, pdf ops)
  preload/preload.js     contextBridge `window.api`
  renderer/
    index.html           all panels (home, menus, file panel, tools, profile, settings, modals)
    styles.css           teenage-engineering styles + dark theme
    app.js               ALL renderer logic (~1000 lines)
    converters.js        ICONS (inline SVG) + CONVERT/COMPRESS/TOOL registries
    splash.js            cursor-driven particle typography entry splash
  songs/                 bundled demo track: song.mp3 + cover.jpg (square-cropped art)
vendor/{bin,gs,qpdf}/    bundled binaries (git-ignored)
assets/banner.svg        README banner
test/                    bitrate.test.js (unit) + *.manual.js (e2e helpers)
electron-builder.yml     packaging + extraResources
DESIGN.md                teenage-engineering style spec
HANDOFF.md               this file
```

---

## 4. Features (what works)

### Navigation
- **Home** landing → cards: **Convert · Compress · Tools · Metadata Editor**.
- Top bar = slim **white** sticky titlebar (blends into canvas) + custom min/max/close,
  and an appbar with **Home / Profile / Settings**. Back button everywhere.
- Menus are **bouncy accordions** (JS spring physics), one category open at a time.
- Custom **dropdowns** replace native OS selects everywhere. Scrollbars hidden.

### Convert (mega-menu mirroring FreeConvert)
- Video/Audio: Video/Audio/MP3/MP4 Converter, MP4→MP3, Video→MP3, MOV→MP4, MP3→OGG.
- Image: Image Converter, WEBP→PNG, WEBP→JPG, JFIF→PNG. (HEIC, PNG→SVG, SVG = disabled w/ note.)
- PDF: PDF Converter / PDF→JPG, JPG→PDF. (Office/eBook/Word/EPUB/DOCX = disabled w/ note — need LibreOffice/Calibre.)
- GIF: Video/MP4/WEBM/MOV/AVI→GIF, GIF↔MP4, GIF↔APNG, Image→GIF.
- Others: Unit Converter, Time Converter, Archive Converter (zip/7z/tar).

### Compress (mega-menu)
Video / MP3 / WAV Compressor · Image / JPEG / PNG Compressor · PDF Compressor · GIF Compressor.

### Video advanced options (the ⚙ modal)
Codec (H.264/H.265 × CPU/NVIDIA/Intel/AMD) · method (% / MB / quality-CRF / resolution /
max-bitrate) · resize · frame rate · rotate · flip · old-device compatibility · subtitles
(upload, hard burn-in / soft) · audio codec/volume/fade-in/out/remove · trim start/end · crop.

### Tools
- Video: Trim, Crop, **Stretch** (live preview, presets TikTok 9:16 / YouTube 16:9 / square…; squeezes resolution, immediate preview).
- Image: GIF Maker, Resize, Crop (shows example sizes), **Color Picker** (canvas), Rotate, Flip, Image Enlarger.
- PDF: Merge, Extract Pages, Flatten, Protect (password), Extract image, **Split**, **Page remover**, **Resize**, **Unlock**, **Rotate**. (Crop PDF / Organize PDF = disabled, need page-thumbnail UI.)
- More: **Metadata Editor**, YouTube Downloader, Unit/Time/Archive converters.

### YouTube downloader
URL → fetch (title/thumb/duration) → **two dropdowns**: Type (Video/Audio/Transcription) →
Format (mp4/mkv/webm · mp3/ogg/m4a/opus/wav · with-timestamps/without(.txt)/captions(.srt)) →
Quality. Checkbox to also download the thumbnail. "supported services" panel lists 21 sites.

### Metadata Editor
Load audio/video → edit tags (title/artist/album/…) → Save (new MTB_ copy, stream-copy),
Scrub all, or Reset to original. ffmpeg `-metadata` / `-map_metadata -1`.

### Profile (Profile button)
Live GitHub avatar/stats + **contribution calendar** (fetched from
`github-contributions-api.jogruber.de`), animated **signature** SVG, interactive
**pixel-canvas** background (dots follow cursor across whole panel), and a vertical
**audio player** on the right playing the bundled song with square album art.

### Settings (cobalt-style sidebar, live-applied)
- appearance: theme auto/light/dark (dark theme implemented).
- accessibility: reduce motion, reduce transparency.
- performance: usage limit Low/Recommended/Full/**Custom** (CPU thread cap → ffmpeg `-threads`).
- downloads: default location (Downloads / same as source / custom folder).
- advanced: version + Reset all settings.
First-run setup asks the performance level.

### Other behaviors
- All outputs are named **`MTB_<name>…`**.
- **Single-instance**: 2nd launch shows an in-app "already running — open another?" modal.
- **Update check**: compares app version to latest GitHub release → bottom-left notice w/ download link.
- **Notifications**: persistent toasts, hover for ✕, click opens the file location, smooth slide.
- **Job controls**: while running → Pause (real Windows process suspend via PowerShell NtSuspendProcess) / Stop; when done → Delete (removes file + pop-out animation). Starting a job updates rows in place (no reflow).
- **Entry splash**: particle typography "media toolbox", dismiss on click only.

---

## 5. Build & run

```bash
npm install                 # installs electron + electron-builder
npm start                   # run dev
npm test                    # bitrate unit tests
npm run dist                # build NSIS installer + portable -> /build
```
Outputs: `build/Video Compressor Setup 1.0.0.exe` and `build/VideoCompressor-portable-1.0.0.exe`.

---

## 6. Known constraints / environment quirks (important)

- **npm 11 blocks dependency postinstall scripts** → Electron's binary isn't auto-downloaded.
  Workaround: extract the cached Electron zip from `%LOCALAPPDATA%\electron\Cache\<hash>\` into
  `node_modules/electron/dist` (node copies the zip into the project, PowerShell `[IO.Compression.ZipFile]`
  extracts) and write `node_modules/electron/path.txt` = `electron.exe`.
- The **Bash tool can't write into the spaced project path** ("Video Compressor") and PowerShell
  can't see `%LOCALAPPDATA%\electron`. Pattern that works: download/produce in scratch, then place
  with **node `fs.copyFileSync`**; extract zips with **PowerShell .NET** or the bundled 7za.
- First **NSIS build sometimes fails** on the uninstaller (Windows Defender quarantines the unsigned
  stub) — just **re-run**; the 2nd build succeeds. Portable target avoids this.
- App is **unsigned** → SmartScreen "More info → Run anyway".
- Can't auto-screenshot the running window (screen-capture tool only sees Start-menu-installed apps);
  verify visually by running it.

---

## 7. User preferences (persisted to memory)

- **Commits/pushes must NOT attribute Claude** — no `Co-Authored-By` trailer, no
  "Generated with Claude Code" footer. Commit as **pipelinear <gastonnicholas15@gmail.com>**.
- On push, also **create a GitHub Release with the installer + portable exe attached**
  (exes are git-ignored → upload as release assets, not committed).
- Keep the **README clean & appealing** — no `npm` noise up front; badges, banner,
  screenshots; dev steps in a collapsed `<details>`.

---

## 8. Open / not-yet-done

- **Not committed since the last batch** — pending changes (metadata editor, expanded
  settings, dark theme, job controls, single-instance, update check, etc.) are local only.
  Next push should also cut the **v1.0.0 release** with both exes.
- Disabled converters/tools (show an explanatory note): HEIC*, PNG→SVG, SVG Converter,
  PDF↔Word/EPUB/DOCX, Document/Ebook Converter, Crop PDF, Organize PDF.
- No custom **app icon** yet (uses default Electron icon).
- README **screenshots** are the SVG banner only — real screenshots would need to be added.
- Image **EXIF** editing not supported (metadata editor is audio/video via ffmpeg).
- componentry.fun components (bouncy accordion, particle typography, github calendar,
  signature, pixel-canvas, dither-prism, audio player) are **faithful vanilla reimplementations**,
  not the original React source.

---

## 9. Quick "continue" prompt for the new chat

> Continue work on the "media toolbox" Electron app at
> `C:\Users\nicky\Downloads\Projects\Video Compressor` (GitHub: pipelinear/media-toolbox).
> Read HANDOFF.md and DESIGN.md first. It's vanilla-JS Electron (no React), bundles
> ffmpeg/yt-dlp/ghostscript/qpdf/7za, teenage-engineering styling. Commits must have NO
> Claude attribution; on push also cut a GitHub release with the installer. [your task]
