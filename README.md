<p align="center">
  <img src="assets/banner.svg" alt="media toolbox" width="100%" />
</p>

<h1 align="center">media toolbox</h1>

<p align="center">
  Convert, compress, edit and download media, and run on-device AI, entirely on your machine. No upload, no size limit, no account, no ads.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-2b2622?style=flat-square" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-33-2b2622?style=flat-square&logo=electron&logoColor=white" />
  <img alt="ffmpeg" src="https://img.shields.io/badge/FFmpeg-bundled-2b2622?style=flat-square&logo=ffmpeg&logoColor=white" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-2b2622?style=flat-square" />
  <img alt="offline" src="https://img.shields.io/badge/100%25-offline-e0588f?style=flat-square" />
</p>

---

<!-- ============================================================= -->
<!-- DEMO VIDEO                                                     -->
<!-- Drop the promo video here once it is rendered. GitHub plays   -->
<!-- an uploaded .mp4 inline: drag the file into this section in   -->
<!-- the web editor, or replace the line below with the <video> /  -->
<!-- thumbnail-link markup it generates.                           -->
<!-- ============================================================= -->

<p align="center">
  <em>Demo video coming soon.</em>
</p>

## What it does

A single desktop app that bundles **ffmpeg, ghostscript, qpdf, yt-dlp and 7-zip**
plus on-device AI, so everything runs locally. Drag a file in, get a result out.
Nothing is uploaded, and there is no size cap.

| | |
|---|---|
| **Convert** | video, audio, image, gif, pdf, archive, change format in a click |
| **Compress** | shrink video / image / audio / pdf / gif to a target size or quality |
| **Tools** | trim, crop, stretch, speed, rotate, flip, resize, GIF maker, color picker, privacy blur |
| **PDF** | merge, split, extract / remove pages, rotate, unlock, protect, flatten, crop, organize |
| **Download** | video, audio, thumbnail and transcripts from YouTube and 20+ sites; Spotify track matching |
| **On-device AI** | background removal, image upscaling, transcription (Whisper), text to speech (Piper) |

## Download

Grab the latest **installer** or **portable** build from the
[Releases](../../releases) page. Unsigned, so Windows SmartScreen will ask,
choose **More info -> Run anyway**.

<details>
<summary><b>Development</b></summary>

Vanilla-JS Electron app. No bundler, no framework, no TypeScript.

```bash
git clone https://github.com/pipelinear/media-toolbox
cd media-toolbox
npm install          # electron + electron-builder (+ onnxruntime-node)
npm start            # run from source
npm test             # bitrate unit tests
npm run dist         # build NSIS installer + portable exe -> build/
```

Build outputs: `build/Video Compressor Setup 1.0.0.exe` and
`build/VideoCompressor-portable-1.0.0.exe`.

### Layout

```
src/main         app lifecycle, ipc, serial job queue, settings
src/main/media   per-type convert/compress/op modules (video/image/audio/pdf/gif)
src/main/ffmpeg  ffmpeg arg builder, probe, encoders, binary path resolver
src/renderer     index.html, styles.css, app.js, converters.js
src/preload      contextBridge api
vendor/          bundled binaries (git-ignored)
assets/          icon.ico, installer.nsh, installer artwork, banner.svg
```

### Bundled binaries

Git-ignored (size); expected on disk before `npm run dist`:
`vendor/bin` ffmpeg, ffprobe, yt-dlp, 7za; `vendor/gs` ghostscript;
`vendor/qpdf` qpdf; plus `vendor/exiftool`, `vendor/realesrgan`,
`vendor/whisper`, `vendor/piper`. Resolved at runtime by
`src/main/ffmpeg/ffmpegPath.js` (prod = `resources/`, dev = `vendor/`, else
PATH). The one in-process native dep is `onnxruntime-node` (asarUnpacked).

### Notes

- Windows x64 target; NSIS installer is per-machine (requests admin / UAC).
- Unsigned, so SmartScreen warns on first run (More info -> Run anyway).
- AI model weights download on demand to `userData/models/`, not bundled.
- First NSIS build can fail on the uninstaller stub (Defender); just re-run.

</details>

## License

MIT, do whatever you like. Bundled tools keep their own licenses
(FFmpeg LGPL/GPL, Ghostscript AGPL, qpdf Apache-2.0, yt-dlp Unlicense).
