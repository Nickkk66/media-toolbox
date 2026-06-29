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
<summary><b>More about media toolbox</b></summary>

### Private by design

There is no server. Your media is read, processed and written right where it
lives, and the on-device AI models run locally. Cut the network entirely and
every on-device tool keeps working. No ads, no trackers, no account, no
subscription.

### Full toolset

- **Video** trim, crop, stretch (to TikTok / 16:9), speed, FPS changer, stabilizer, motion blur.
- **Audio** trim, denoise.
- **Image** GIF maker, resize / downscale, crop, rotate, flip, enlarger, upscaler, photo effects, privacy blur, watermark remover, color picker with screen eyedropper.
- **PDF** merge, split, extract / remove pages, rotate, unlock, protect, flatten, to-image, crop, organize.
- **Metadata** full EXIF / IPTC / XMP / ICC editor for images, plus audio / video metadata.
- **Extras** batch rename, unit / time / archive converters.

### On-device AI

Models are downloaded once (in Settings, or during install) and then run fully
offline: **background removal** (U2-Net), **image upscaling** (Real-ESRGAN),
**transcription** (whisper.cpp, to SRT / VTT / TXT) and **text to speech**
(Piper, 18 voices).

### Hardware and limits

- **Hardware accelerated** NVIDIA NVENC / Intel QSV / AMD AMF when available.
- **Usage limits** pick Low / Recommended / Full / Custom so big jobs never max out your PC.
- **Self-contained** recipients install nothing extra.
- **Themes** creme (default), light and dark.

### Tech

Electron, vanilla JS renderer, FFmpeg, Ghostscript, qpdf, yt-dlp, 7-Zip,
onnxruntime-node, Real-ESRGAN, whisper.cpp, Piper. Built with
[`electron-builder`](https://www.electron.build).

### Build from source

```bash
npm install
npm start        # run in dev
npm run dist     # build installer + portable to /build
```

Vendor binaries (ffmpeg, ffprobe, yt-dlp, 7za in `vendor/bin`; ghostscript in
`vendor/gs`; qpdf in `vendor/qpdf`; and the AI engines) are git-ignored due to
size, drop them in before building.

</details>

## License

MIT, do whatever you like. Bundled tools keep their own licenses
(FFmpeg LGPL/GPL, Ghostscript AGPL, qpdf Apache-2.0, yt-dlp Unlicense).
