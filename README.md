# Media Toolbox

A local desktop media suite — a FreeConvert-style **Convert / Compress / Tools**
app **without the 1 GB upload limit**. Files never leave your PC: it reads them
straight from disk and processes them with bundled `ffmpeg`, `ghostscript`,
`yt-dlp`, and `7-zip`. Hardware-accelerated (NVIDIA / Intel / AMD) when available.

On launch it shows a cursor-driven **particle-typography splash** (click to
enter). The app has three top sections, each a bouncy accordion mega-menu:
- **Convert** — format converters (Video/Audio, Image, PDF, GIF, Others).
- **Compress** — Video / MP3 / WAV / Image / JPEG / PNG / PDF / GIF compressors.
- **Tools** — Video tools (Trim, Crop), Image tools (GIF Maker, Resize, Crop,
  Color Picker, Rotate, Flip, Enlarger), PDF tools (Merge, Extract Pages,
  Flatten, Protect, Extract image), plus YouTube downloader, Unit/Time/Archive.

## Features

- **No size limit** — compress 1 GB, 10 GB, whatever fits on disk. Drag & drop,
  nothing is uploaded.
- **Five compressors, tabbed** — Video, Image, GIF, Audio, PDF.
- **Batch queue** — add many files, per-file Advanced Options (the ⚙ cog),
  "apply to all", live per-file progress.
- **Video**: target file size (% or MB), video quality (CRF + preset), target
  resolution, or max bitrate; H.264/H.265 on CPU or GPU (NVENC/QSV/AMF);
  old-device compatibility; subtitle burn-in / soft-mux.
- **Image**: JPG/PNG/WebP with quality + resize.
- **GIF**: palette/scale/fps optimize, or convert to MP4/WebM for big savings.
- **Audio**: MP3/AAC/OGG/Opus/WAV by bitrate or target size.
- **PDF**: Ghostscript quality presets (screen/ebook/printer/prepress).
- **YouTube**: paste a URL, download as MP4 (pick resolution) or extract MP3 —
  powered by bundled yt-dlp + ffmpeg.
- **Format conversion**: every tab's Output dropdown converts between formats
  (MOV→MP4, WEBP→PNG, MP3→OGG, GIF→MP4…). Drop a video on the Audio tab to get
  MP3 ("Video to MP3"), or on the GIF tab for "Video to GIF".
- Self-contained — `ffmpeg`, `ffprobe`, Ghostscript, and yt-dlp are bundled;
  recipients install nothing.

**Converters** (under Convert): Video/MP4/MOV/Audio/MP3, MP4→MP3, Video→MP3,
MP3→OGG; Image Converter, WEBP→PNG/JPG, JFIF→PNG; PDF→JPG/PNG, JPG→PDF; all the
GIF conversions (Video/MP4/WEBM/MOV/AVI→GIF, GIF↔MP4, GIF↔APNG, Image→GIF);
Unit, Time, and Archive (ZIP/7Z/TAR) converters.

Shown in the menu but **disabled** (would need large extra tools): Office/eBook
conversions (PDF↔Word/EPUB/DOCX — LibreOffice/Calibre), raster→SVG
vectorization, and HEIC decoding (this ffmpeg build can't read HEIC). Each shows
a note explaining what's missing.

## Develop

```bash
npm install
npm start        # launch the app
npm test         # run the bitrate unit tests
```

Bundled binaries (git-ignored due to size, already in place on this machine):
- `vendor/bin/ffmpeg.exe`, `vendor/bin/ffprobe.exe`
- `vendor/bin/yt-dlp.exe` (YouTube downloader)
- `vendor/bin/7za.exe` (archive converter)
- `vendor/gs/gswin64c.exe`, `vendor/gs/gsdll64.dll` (Ghostscript, for PDF)

## Build a shippable installer

```bash
npm run dist
```

Outputs an NSIS installer + a portable `.exe` to `build/`. The installer is
~170 MB because ffmpeg is bundled. Unsigned builds trigger Windows SmartScreen —
recipients click **More info → Run anyway**.

## How file-size targeting works

`target_bitrate = (target_size_bits / duration) − audio_bitrate`, then two-pass
encoding (CPU) or single-pass VBR with `-multipass` (NVENC) to hit the size. See
`src/main/ffmpeg/bitrate.js`.
