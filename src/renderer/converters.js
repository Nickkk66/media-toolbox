'use strict';

// Inline SVG icons (stroke = currentColor). Tabler-style, 24x24.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  metadata: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="2"/></svg>',
  convert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 8H5M5 8l4-4M5 8l4 4"/><path d="M5 16h14M19 16l-4-4M19 16l-4 4"/></svg>',
  compress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9V4M9 9H4M9 9 4 4M15 9V4M15 9h5M15 9l5-5M9 15v5M9 15H4M9 15l-5 5M15 15v5M15 15h5M15 15l5 5"/></svg>',
  tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10 3 6l2-2 4 4M14 7l3-3 3 3-3 3M3 21l9-9M14 14l7 7"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M9 17V5l11-2v12"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 13h6M9 17h6"/></svg>',
  gif: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M11 10a2 2 0 1 0 0 4h1v-2M15 9v6M18 9h-2v6"/></svg>',
  others: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17 17 3l4 4L7 21z"/><path d="M7 11l2 2M11 7l2 2M15 11l1 1"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>',
  skipBack: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 6h2v12H6zM20 6v12l-9-6z"/></svg>',
  skipFwd: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16 6h2v12h-2zM4 6l9 6-9 6z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M21 3l-7 7M4 20l7-7M16 21h5v-5M15 15l6 6M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
};

const VIDEO = ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'vob', 'ogv', 'mxf'];
const AUDIO = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wma', 'aiff'];
const IMAGE = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'jfif'];

// Converter registry mirroring the FreeConvert "Convert" menu.
// engine: 'media' (ffmpeg via media module) | 'pdf2img' | 'img2pdf' | 'archive'
//         | 'calc' (no files) | 'disabled' (needs an external tool we don't bundle)
const CONVERT_CATEGORIES = [
  {
    name: 'Video & Audio', icon: 'video', items: [
      { id: 'video-converter', label: 'Video Converter', engine: 'media', mediaType: 'video', accept: VIDEO, out: 'mp4', pickOut: true, tags: ['video', 'convert', 'format', 'mp4', 'transcode', 'reencode'] },
      { id: 'audio-converter', label: 'Audio Converter', engine: 'media', mediaType: 'audio', accept: AUDIO.concat(VIDEO), out: 'mp3', pickOut: true, tags: ['audio', 'convert', 'sound', 'music', 'format', 'transcode'] },
      { id: 'mp3-converter', label: 'MP3 Converter', engine: 'media', mediaType: 'audio', accept: AUDIO, out: 'mp3', pickOut: true, tags: ['mp3', 'audio', 'convert', 'music', 'sound'] },
      { id: 'mp4-to-mp3', label: 'MP4 to MP3', engine: 'media', mediaType: 'audio', accept: ['mp4', 'm4v'], out: 'mp3', tags: ['mp4', 'mp3', 'extract audio', 'video to audio', 'rip'] },
      { id: 'video-to-mp3', label: 'Video to MP3', engine: 'media', mediaType: 'audio', accept: VIDEO, out: 'mp3', tags: ['video', 'mp3', 'extract audio', 'rip', 'soundtrack'] },
      { id: 'mp4-converter', label: 'MP4 Converter', engine: 'media', mediaType: 'video', accept: VIDEO, out: 'mp4', tags: ['mp4', 'video', 'convert', 'format'] },
      { id: 'mov-to-mp4', label: 'MOV to MP4', engine: 'media', mediaType: 'video', accept: ['mov', 'qt'], out: 'mp4', tags: ['mov', 'mp4', 'quicktime', 'iphone', 'convert'] },
      { id: 'mp3-to-ogg', label: 'MP3 to OGG', engine: 'media', mediaType: 'audio', accept: ['mp3'], out: 'ogg', tags: ['mp3', 'ogg', 'vorbis', 'audio', 'convert'] },
    ],
  },
  {
    name: 'Image', icon: 'image', items: [
      { id: 'image-converter', label: 'Image Converter', engine: 'media', mediaType: 'image', accept: IMAGE, out: 'png', pickOut: true, tags: ['image', 'photo', 'picture', 'convert', 'format'] },
      { id: 'webp-to-png', label: 'WEBP to PNG', engine: 'media', mediaType: 'image', accept: ['webp'], out: 'png', tags: ['webp', 'png', 'image', 'convert'] },
      { id: 'jfif-to-png', label: 'JFIF to PNG', engine: 'media', mediaType: 'image', accept: ['jfif', 'jpg', 'jpeg'], out: 'png', tags: ['jfif', 'png', 'jpg', 'image', 'convert'] },
      { id: 'png-to-svg', label: 'PNG to SVG', engine: 'disabled', note: 'Raster-to-SVG vectorization needs an extra tool (potrace) that isn’t bundled.', tags: ['png', 'svg', 'vector', 'trace', 'convert'] },
      { id: 'heic-to-jpg', label: 'HEIC to JPG', engine: 'disabled', note: 'This ffmpeg build can’t decode HEIC (needs libheif).', tags: ['heic', 'jpg', 'iphone', 'photo', 'convert'] },
      { id: 'heic-to-png', label: 'HEIC to PNG', engine: 'disabled', note: 'This ffmpeg build can’t decode HEIC (needs libheif).', tags: ['heic', 'png', 'iphone', 'photo', 'convert'] },
      { id: 'webp-to-jpg', label: 'WEBP to JPG', engine: 'media', mediaType: 'image', accept: ['webp'], out: 'jpg', tags: ['webp', 'jpg', 'jpeg', 'image', 'convert'] },
      { id: 'svg-converter', label: 'SVG Converter', engine: 'disabled', note: 'Rendering SVG needs librsvg, which isn’t bundled.', tags: ['svg', 'vector', 'image', 'convert', 'rasterize'] },
    ],
  },
  {
    name: 'PDF & Documents', icon: 'pdf', items: [
      { id: 'pdf-converter', label: 'PDF Converter', engine: 'pdf2img', mediaType: 'pdf2img', accept: ['pdf'], out: 'jpg', pickOut: true, tags: ['pdf', 'image', 'convert', 'document', 'export'] },
      { id: 'document-converter', label: 'Document Converter', engine: 'disabled', note: 'Office document conversion needs LibreOffice, which isn’t bundled.', tags: ['document', 'office', 'word', 'doc', 'convert'] },
      { id: 'ebook-converter', label: 'Ebook Converter', engine: 'disabled', note: 'eBook conversion needs Calibre, which isn’t bundled.', tags: ['ebook', 'epub', 'mobi', 'kindle', 'convert'] },
      { id: 'pdf-to-word', label: 'PDF to Word', engine: 'disabled', note: 'PDF→Word needs LibreOffice, which isn’t bundled.', tags: ['pdf', 'word', 'docx', 'document', 'convert'] },
      { id: 'pdf-to-jpg', label: 'PDF to JPG', engine: 'pdf2img', mediaType: 'pdf2img', accept: ['pdf'], out: 'jpg', tags: ['pdf', 'jpg', 'image', 'export', 'convert'] },
      { id: 'pdf-to-epub', label: 'PDF to EPUB', engine: 'disabled', note: 'PDF→EPUB needs Calibre, which isn’t bundled.', tags: ['pdf', 'epub', 'ebook', 'convert'] },
      { id: 'epub-to-pdf', label: 'EPUB to PDF', engine: 'disabled', note: 'EPUB→PDF needs Calibre, which isn’t bundled.', tags: ['epub', 'pdf', 'ebook', 'convert'] },
      { id: 'heic-to-pdf', label: 'HEIC to PDF', engine: 'disabled', note: 'This ffmpeg build can’t decode HEIC (needs libheif).', tags: ['heic', 'pdf', 'iphone', 'photo', 'convert'] },
      { id: 'docx-to-pdf', label: 'DOCX to PDF', engine: 'disabled', note: 'DOCX→PDF needs LibreOffice, which isn’t bundled.', tags: ['docx', 'word', 'pdf', 'document', 'convert'] },
      { id: 'jpg-to-pdf', label: 'JPG to PDF', engine: 'img2pdf', mediaType: 'img2pdf', accept: IMAGE, out: 'pdf', tags: ['jpg', 'image', 'pdf', 'document', 'combine'] },
    ],
  },
  {
    name: 'GIF', icon: 'gif', items: [
      { id: 'video-to-gif', label: 'Video to GIF', engine: 'media', mediaType: 'gif', accept: VIDEO, out: 'gif', tags: ['video', 'gif', 'animation', 'animated', 'meme', 'loop'] },
      { id: 'mp4-to-gif', label: 'MP4 to GIF', engine: 'media', mediaType: 'gif', accept: ['mp4'], out: 'gif', tags: ['mp4', 'gif', 'animation', 'meme', 'loop'] },
      { id: 'webm-to-gif', label: 'WEBM to GIF', engine: 'media', mediaType: 'gif', accept: ['webm'], out: 'gif', tags: ['webm', 'gif', 'animation', 'meme', 'loop'] },
      { id: 'apng-to-gif', label: 'APNG to GIF', engine: 'media', mediaType: 'gif', accept: ['apng', 'png'], out: 'gif', tags: ['apng', 'gif', 'animation', 'animated', 'convert'] },
      { id: 'gif-to-mp4', label: 'GIF to MP4', engine: 'media', mediaType: 'gif', accept: ['gif'], out: 'mp4', tags: ['gif', 'mp4', 'video', 'convert', 'animation'] },
      { id: 'gif-to-apng', label: 'GIF to APNG', engine: 'media', mediaType: 'gif', accept: ['gif'], out: 'apng', tags: ['gif', 'apng', 'animation', 'convert'] },
      { id: 'image-to-gif', label: 'Image to GIF', engine: 'media', mediaType: 'gif', accept: IMAGE, out: 'gif', tags: ['image', 'gif', 'animation', 'slideshow', 'loop'] },
      { id: 'mov-to-gif', label: 'MOV to GIF', engine: 'media', mediaType: 'gif', accept: ['mov'], out: 'gif', tags: ['mov', 'gif', 'animation', 'meme', 'loop'] },
      { id: 'avi-to-gif', label: 'AVI to GIF', engine: 'media', mediaType: 'gif', accept: ['avi'], out: 'gif', tags: ['avi', 'gif', 'animation', 'meme', 'loop'] },
    ],
  },
  {
    name: 'Others', icon: 'others', items: [
      { id: 'unit-converter', label: 'Unit Converter', engine: 'calc', tags: ['unit', 'measure', 'length', 'weight', 'temperature', 'convert'] },
      { id: 'time-converter', label: 'Time Converter', engine: 'calc', tags: ['time', 'timezone', 'unix', 'timestamp', 'clock', 'convert'] },
      { id: 'archive-converter', label: 'Archive Converter', engine: 'archive', mediaType: 'archive', accept: ['zip', '7z', 'tar', 'gz', 'rar', 'bz2', 'xz', 'tgz'], out: 'zip', pickOut: true, tags: ['archive', 'zip', '7z', 'tar', 'compress', 'extract'] },
    ],
  },
];

// Compress menu (mirrors FreeConvert's Compress menu).
const COMPRESS_CATEGORIES = [
  {
    name: 'Video & Audio', icon: 'video', items: [
      { id: 'video-compressor', label: 'Video Compressor', engine: 'compress', mediaType: 'video', accept: VIDEO, tags: ['video', 'compress', 'shrink', 'smaller', 'make smaller', 'reduce size', 'mp4', 'mp4 compressor'] },
      { id: 'mp3-compressor', label: 'MP3 Compressor', engine: 'compress', mediaType: 'audio', accept: AUDIO, out: 'mp3', tags: ['mp3', 'compress', 'shrink', 'audio', 'reduce size'] },
      { id: 'wav-compressor', label: 'WAV Compressor', engine: 'compress', mediaType: 'audio', accept: AUDIO, out: 'wav', tags: ['wav', 'compress', 'shrink', 'audio', 'reduce size'] },
    ],
  },
  {
    name: 'Image', icon: 'image', items: [
      { id: 'image-compressor', label: 'Image Compressor', engine: 'compress', mediaType: 'image', accept: IMAGE, tags: ['image', 'compress', 'shrink', 'smaller', 'photo', 'reduce size'] },
      { id: 'jpeg-compressor', label: 'JPEG Compressor', engine: 'compress', mediaType: 'image', accept: IMAGE, out: 'jpg', tags: ['jpeg', 'jpg', 'compress', 'shrink', 'photo', 'reduce size'] },
      { id: 'png-compressor', label: 'PNG Compressor', engine: 'compress', mediaType: 'image', accept: IMAGE, out: 'png', tags: ['png', 'compress', 'shrink', 'image', 'reduce size'] },
    ],
  },
  {
    name: 'PDF & Documents', icon: 'pdf', items: [
      { id: 'pdf-compressor', label: 'PDF Compressor', engine: 'compress', mediaType: 'pdf', accept: ['pdf'], tags: ['pdf', 'compress', 'shrink', 'smaller', 'document', 'reduce size'] },
    ],
  },
  {
    name: 'GIF', icon: 'gif', items: [
      { id: 'gif-compressor', label: 'GIF Compressor', engine: 'compress', mediaType: 'gif', accept: ['gif'], tags: ['gif', 'compress', 'shrink', 'animation', 'reduce size'] },
    ],
  },
];

// Tools menu (mirrors FreeConvert's Tools menu) + previously added tools.
const TOOL_CATEGORIES = [
  {
    name: 'Video Tools', icon: 'video', items: [
      { id: 'trim-video', label: 'Trim Video', engine: 'op', mediaType: 'videoop', op: 'trim', accept: VIDEO, tags: ['trim', 'cut', 'clip', 'split', 'video', 'shorten'] },
      { id: 'crop-video', label: 'Crop Video', engine: 'op', mediaType: 'videoop', op: 'crop', accept: VIDEO, tags: ['crop', 'cut', 'frame', 'aspect', 'video', 'trim edges'] },
      { id: 'stretch-video', label: 'Stretch Video', engine: 'stretch', accept: VIDEO, tags: ['video', 'resize', 'resolution', 'downscale', 'downscaler', 'smaller', 'shrink', 'lower resolution', 'stretch', 'aspect'] },
      { id: 'video-speed', label: 'Video Speed', engine: 'op', mediaType: 'videoop', op: 'speed', accept: VIDEO, tags: ['speed', 'slow motion', 'fast', 'slowmo', 'timelapse', 'tempo', 'video'] },
      { id: 'fps-changer', label: 'FPS Changer', engine: 'fpspreview', accept: VIDEO, tags: ['fps', 'frame rate', 'framerate', 'smooth', 'interpolate', '60fps', 'video'] },
      { id: 'stabilize-video', label: 'Video Stabilizer', engine: 'op', mediaType: 'videoop', op: 'stabilize', accept: VIDEO, tags: ['stabilize', 'stabilizer', 'shaky', 'smooth', 'steady', 'deshake', 'video'] },
      { id: 'motion-blur', label: 'Motion Blur', engine: 'op', mediaType: 'videoop', op: 'motionblur', accept: VIDEO, tags: ['motion blur', 'blur', 'smear', 'long exposure', 'frame blend', 'cinematic', 'video'] },
      { id: 'watermark-remover', label: 'Watermark Remover', engine: 'op', mediaType: 'videoop', op: 'delogo', accept: VIDEO, tags: ['watermark', 'logo', 'remove', 'delogo', 'erase', 'cleanup', 'region', 'video'] },
      { id: 'thumbnail-grab', label: 'Thumbnail Grab', engine: 'op', mediaType: 'thumbgrab', op: 'thumb', accept: VIDEO, out: 'png', pickOut: true, tags: ['thumbnail', 'frame', 'grab', 'snapshot', 'screenshot', 'still', 'capture', 'poster', 'video'] },
    ],
  },
  {
    name: 'Audio Tools', icon: 'audio', items: [
      { id: 'trim-audio', label: 'Trim Audio', engine: 'op', mediaType: 'audioop', op: 'trim', accept: AUDIO, tags: ['trim', 'cut', 'clip', 'audio', 'shorten', 'music'] },
      { id: 'audio-denoise', label: 'Audio Denoise', engine: 'op', mediaType: 'audioop', op: 'denoise', accept: AUDIO, tags: ['denoise', 'noise', 'clean', 'hiss', 'background noise', 'audio', 'reduce'] },
    ],
  },
  {
    name: 'Image Tools', icon: 'image', items: [
      { id: 'gif-maker', label: 'GIF Maker', engine: 'op', mediaType: 'gif', op: 'gif', accept: VIDEO, out: 'gif', tags: ['gif', 'make gif', 'create gif', 'animation', 'animated', 'loop', 'meme', 'video to gif'] },
      { id: 'resize-image', label: 'Resize Image', engine: 'op', mediaType: 'imageop', op: 'resize', accept: IMAGE, tags: ['image', 'resize', 'downscale', 'downscaler', 'smaller', 'shrink', 'dimensions', 'width', 'height', 'resolution'] },
      { id: 'crop-image', label: 'Crop Image', engine: 'op', mediaType: 'imageop', op: 'crop', accept: IMAGE, tags: ['crop', 'cut', 'trim', 'frame', 'image'] },
      { id: 'color-picker', label: 'Color Picker', engine: 'colorpicker', tags: ['color', 'colour', 'eyedropper', 'hex', 'rgb', 'pick'] },
      { id: 'rotate-image', label: 'Rotate Image', engine: 'op', mediaType: 'imageop', op: 'rotate', accept: IMAGE, tags: ['rotate', 'turn', 'orientation', 'angle', 'image'] },
      { id: 'flip-image', label: 'Flip Image', engine: 'op', mediaType: 'imageop', op: 'flip', accept: IMAGE, tags: ['flip', 'mirror', 'horizontal', 'vertical', 'image'] },
      { id: 'image-enlarger', label: 'Image Enlarger', engine: 'op', mediaType: 'imageop', op: 'enlarge', accept: IMAGE, tags: ['enlarge', 'enlarger', 'bigger', 'scale up', 'upscale', 'photo', 'image'] },
      { id: 'image-upscaler', label: 'Image Upscaler', engine: 'op', mediaType: 'imageop', op: 'upscale', accept: IMAGE, tags: ['upscale', 'upscaler', 'enhance', 'hd', 'super resolution', 'photo', 'pixel art', 'image'] },
      { id: 'photo-effects', label: 'Photo Effects', engine: 'photofx', tags: ['effects', 'filter', 'dither', 'ascii', 'halftone', 'glitch', 'retro', 'photo', 'image', 'crt'] },
      { id: 'privacy-blur', label: 'Privacy Blur', engine: 'privacyblur', accept: IMAGE, tags: ['privacy', 'blur', 'pixelate', 'censor', 'redact', 'face', 'anonymize', 'hide', 'image'] },
    ],
  },
  {
    name: 'PDF Tools', icon: 'pdf', items: [
      { id: 'pdf-merge', label: 'PDF Merge', engine: 'pdfmerge', accept: ['pdf'], tags: ['pdf', 'merge', 'combine', 'join', 'document'] },
      { id: 'extract-pages', label: 'Extract Pages from PDF', engine: 'op', mediaType: 'pdfop', op: 'extract', accept: ['pdf'], tags: ['pdf', 'extract', 'pages', 'split', 'document'] },
      { id: 'flatten-pdf', label: 'Flatten PDF', engine: 'op', mediaType: 'pdfop', op: 'flatten', accept: ['pdf'], tags: ['pdf', 'flatten', 'form', 'merge layers', 'document'] },
      { id: 'protect-pdf', label: 'Protect PDF', engine: 'op', mediaType: 'pdfop', op: 'protect', accept: ['pdf'], tags: ['pdf', 'protect', 'password', 'encrypt', 'lock', 'document'] },
      { id: 'extract-image-pdf', label: 'Extract image from PDF', engine: 'op', mediaType: 'pdf2img', op: 'pdf2img', accept: ['pdf'], out: 'png', tags: ['pdf', 'image', 'extract', 'export', 'document'] },
      { id: 'pdf-split', label: 'PDF Split', engine: 'op', mediaType: 'pdfop', op: 'split', accept: ['pdf'], tags: ['pdf', 'split', 'separate', 'pages', 'document'] },
      { id: 'pdf-page-remover', label: 'PDF page remover', engine: 'op', mediaType: 'pdfop', op: 'remove', accept: ['pdf'], tags: ['pdf', 'remove', 'delete pages', 'page', 'document'] },
      { id: 'resize-pdf', label: 'Resize PDF', engine: 'op', mediaType: 'pdfop', op: 'resize', accept: ['pdf'], tags: ['pdf', 'resize', 'page size', 'a4', 'letter', 'document'] },
      { id: 'unlock-pdf', label: 'Unlock PDF', engine: 'op', mediaType: 'pdfop', op: 'unlock', accept: ['pdf'], tags: ['pdf', 'unlock', 'password', 'decrypt', 'remove password', 'document'] },
      { id: 'rotate-pdf', label: 'Rotate PDF', engine: 'op', mediaType: 'pdfop', op: 'rotate', accept: ['pdf'], tags: ['pdf', 'rotate', 'turn', 'orientation', 'document'] },
      { id: 'crop-pdf', label: 'Crop PDF', engine: 'disabled', note: 'Visual PDF cropping needs a page-preview UI that isn’t built yet.', tags: ['pdf', 'crop', 'trim', 'margins', 'document'] },
      { id: 'organize-pdf', label: 'Organize PDF', engine: 'disabled', note: 'Drag-to-reorder pages needs a page-thumbnail UI that isn’t built yet.', tags: ['pdf', 'organize', 'reorder', 'pages', 'arrange', 'document'] },
    ],
  },
  {
    name: 'More Tools', icon: 'tools', items: [
      { id: 'unit-converter', label: 'Unit Converter', engine: 'special', tags: ['unit', 'measure', 'length', 'weight', 'temperature', 'convert'] },
      { id: 'time-converter', label: 'Time Converter', engine: 'special', tags: ['time', 'timezone', 'unix', 'timestamp', 'clock', 'convert'] },
      { id: 'archive-converter', label: 'Archive Converter', engine: 'special', need: 'hasSevenzip', tags: ['archive', 'zip', '7z', 'tar', 'compress', 'extract'] },
      { id: 'batch-rename', label: 'Batch Rename', engine: 'batchrename', tags: ['mass', 'mass renamer', 'rename', 'batch', 'bulk', 'bulk rename', 'rename files', 'sequential', 'find replace', 'files'] },
    ],
  },
];

// AI Tools — surfaced via the Home "AI Tools" hub (NOT in the Tools accordion).
// Kept defined here so global search still finds them and the hub can render them.
const AI_TOOLS = [
  { id: 'transcribe', label: 'Subtitle / Transcript Extractor', engine: 'transcribe', accept: VIDEO.concat(AUDIO), tags: ['subtitle', 'subtitles', 'transcribe', 'transcript', 'caption', 'captions', 'speech to text', 'whisper', 'srt', 'text', 'ai'] },
  { id: 'image-upscaler-ai', label: 'AI Image Upscaler', engine: 'upscaleai', accept: IMAGE, tags: ['upscale', 'upscaler', 'enhance', 'super resolution', 'ai', 'photo', 'hd', 'enlarge', 'image'] },
  { id: 'remove-bg', label: 'Background Removal', engine: 'removebg', accept: IMAGE, tags: ['background', 'remove background', 'remove bg', 'transparent', 'cutout', 'matting', 'knockout', 'png', 'ai', 'image'] },
  { id: 'tts', label: 'Text to Speech', engine: 'tts', tags: ['tts', 'text to speech', 'speech', 'voice', 'narration', 'voiceover', 'speak', 'say', 'audio', 'ai'] },
];

function findIn(cats, id) {
  for (const cat of cats) { const c = cat.items.find((i) => i.id === id); if (c) return c; }
  return null;
}
function findConverter(id) { return findIn(CONVERT_CATEGORIES, id); }
function findCompressor(id) { return findIn(COMPRESS_CATEGORIES, id); }
function findTool(id) { return findIn(TOOL_CATEGORIES, id); }

window.ICONS = ICONS;
window.CONVERT_CATEGORIES = CONVERT_CATEGORIES;
window.COMPRESS_CATEGORIES = COMPRESS_CATEGORIES;
window.TOOL_CATEGORIES = TOOL_CATEGORIES;
// AI tools live in the Home "AI Tools" hub. Exposed both as a flat list and as a
// single-category array so the search index (which iterates *_CATEGORIES) can
// include them without re-shaping its loop.
window.AI_TOOLS = AI_TOOLS;
window.AI_CATEGORIES = [{ name: 'AI Tools', icon: 'tools', items: AI_TOOLS }];
window.findConverter = findConverter;
window.findCompressor = findCompressor;
window.findTool = findTool;
window.findAiTool = (id) => AI_TOOLS.find((i) => i.id === id) || null;
