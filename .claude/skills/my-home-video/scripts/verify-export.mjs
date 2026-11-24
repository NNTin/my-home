#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [file, ...dimensions] = process.argv.slice(2);
const [seconds, width, height, fps] = dimensions.map(Number);
if (
  !file ||
  dimensions.length !== 4 ||
  ![seconds, width, height, fps].every((value) => Number.isFinite(value) && value > 0) ||
  !Number.isInteger(width) ||
  !Number.isInteger(height)
) {
  throw new Error('Usage: verify-export.mjs <video> <seconds> <width> <height> <fps>');
}

const videoPath = path.resolve(file);
const requireReel = createRequire(new URL('../../../../tools/reel/package.json', import.meta.url));
let decoder = 'ffmpeg';
try {
  decoder = requireReel('@ffmpeg-installer/ffmpeg').path;
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const scope = fileURLToPath(
  new URL('../../../../tools/reel/node_modules/@remotion/', import.meta.url),
);
const compositors = existsSync(scope)
  ? readdirSync(scope).filter((name) => name.startsWith('compositor-'))
  : [];
const binary = (name) =>
  compositors
    .map((compositor) =>
      path.join(scope, compositor, process.platform === 'win32' ? name + '.exe' : name),
    )
    .find(existsSync) ?? name;

const { streams, format } = JSON.parse(
  execFileSync(
    binary('ffprobe'),
    [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames',
      '-of',
      'json',
      videoPath,
    ],
    { encoding: 'utf8' },
  ),
);
const video = streams.find((stream) => stream.codec_type === 'video');
const audio = streams.filter((stream) => stream.codec_type === 'audio');
if (!video) throw new Error('The export has no video stream.');

const [rateNumerator, rateDenominator] = video.avg_frame_rate.split('/').map(Number);
const actual = {
  duration: Number(format.duration),
  width: video.width,
  height: video.height,
  fps: rateNumerator / rateDenominator,
  frames: Number(video.nb_read_frames),
  codec: video.codec_name,
  pixelFormat: video.pix_fmt,
  audio: audio.map((stream) => stream.codec_name),
};
const expectedFrames = Math.round(seconds * fps);
if (
  !Number.isFinite(actual.duration) ||
  Math.abs(actual.duration - seconds) > 0.5 / fps ||
  actual.width !== width ||
  actual.height !== height ||
  !Number.isFinite(actual.fps) ||
  Math.abs(actual.fps - fps) > 0.001 ||
  actual.frames !== expectedFrames ||
  actual.codec !== 'h264' ||
  actual.pixelFormat !== 'yuv420p' ||
  actual.audio.some((codec) => codec !== 'aac')
) {
  throw new Error(
    'Export does not match the requested delivery profile: ' + JSON.stringify(actual),
  );
}

execFileSync(
  decoder,
  [
    '-nostdin',
    '-v',
    'error',
    '-xerror',
    '-i',
    videoPath,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-f',
    'null',
    '-',
  ],
  { stdio: 'inherit' },
);
console.log(JSON.stringify(actual, null, 2));
