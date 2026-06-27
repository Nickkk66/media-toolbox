'use strict';

// Runs ffprobe and returns a normalized metadata object used by the rest of
// the app to build commands and compute bitrates.

const { execFile } = require('child_process');
const ffmpegPath = require('./ffmpegPath');

function parseFps(str) {
  if (!str || str === '0/0') return 0;
  const [num, den] = str.split('/').map(Number);
  if (!den) return num || 0;
  return num / den;
}

function probe(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ];
    execFile(
      ffmpegPath.ffprobe,
      args,
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`ffprobe failed: ${stderr || err.message}`));
        }
        let data;
        try {
          data = JSON.parse(stdout);
        } catch (e) {
          return reject(new Error(`Could not parse ffprobe output: ${e.message}`));
        }

        const fmt = data.format || {};
        const streams = data.streams || [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audios = streams.filter((s) => s.codec_type === 'audio');

        if (!video) {
          return reject(new Error('No video stream found in this file.'));
        }

        const durationSec = parseFloat(fmt.duration) || parseFloat(video.duration) || 0;

        resolve({
          inputPath,
          durationSec,
          sizeBytes: parseInt(fmt.size, 10) || 0,
          formatName: fmt.format_name || '',
          overallBitrateBps: parseInt(fmt.bit_rate, 10) || 0,
          video: {
            codec: video.codec_name || '',
            width: video.width || 0,
            height: video.height || 0,
            fps: parseFps(video.avg_frame_rate || video.r_frame_rate),
            pixFmt: video.pix_fmt || '',
            bitrateBps: parseInt(video.bit_rate, 10) || 0,
          },
          audios: audios.map((a) => ({
            index: a.index,
            codec: a.codec_name || '',
            channels: a.channels || 2,
            bitrateBps: parseInt(a.bit_rate, 10) || 0,
          })),
          hasAudio: audios.length > 0,
        });
      }
    );
  });
}

module.exports = { probe };
