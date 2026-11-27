import { writeFileSync } from 'node:fs';
import path from 'node:path';
import timeline from './timeline.json' with { type: 'json' };

const [dir] = process.argv.slice(2);
if (!dir) throw new Error('Usage: node score.mjs <temporary media directory>');

const rate = 48_000;
const duration = timeline.shots.reduce((total, shot) => total + shot.frames, 0) / timeline.fps;
const samples = rate * duration;
const score = new Float32Array(samples);
const chords = [
  [45, 52, 55, 60, 64],
  [41, 48, 52, 55, 60],
  [48, 55, 59, 62, 64],
  [43, 50, 53, 57, 62],
];
const note = (midi) => 440 * 2 ** ((midi - 69) / 12);
const wave = (cycles) => Math.sin(2 * Math.PI * cycles);

function add(start, length, synth) {
  const from = Math.round(start * rate);
  const end = Math.min(samples, from + Math.round(length * rate));
  for (let i = from; i < end; i++) score[i] += synth((i - from) / rate);
}

function felt(midi, start, gain) {
  const hz = note(midi);
  add(
    start,
    2.5,
    (t) =>
      gain *
      (1 - Math.exp(-72 * t)) *
      Math.exp(-2.8 * t) *
      (wave(t * hz) + 0.2 * wave(t * hz * 2) + 0.07 * wave(t * hz * 3.01)),
  );
}

for (let bar = 0; bar < 13; bar++) {
  const chord = chords[bar % chords.length];
  const at = bar * 2.35;
  felt(chord[0], at, 0.09);
  for (const [index, offset] of [
    [1, 0.27],
    [3, 0.57],
    [2, 0.93],
    [4, 1.36],
    [3, 1.82],
  ]) {
    felt(chord[index] + 12, at + offset, 0.034);
  }
}

let beat = 0;
for (const shot of timeline.shots) {
  const at = beat / timeline.fps;
  beat += shot.frames;
  add(
    at,
    0.35,
    (t) =>
      0.075 *
      (1 - Math.exp(-100 * t)) *
      Math.exp(-19 * t) *
      wave(53 * t + 1.5 * (1 - Math.exp(-10 * t))),
  );
}

const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const fade = Math.min(1, t / 0.08, (duration - t) / 0.6);
  wav.writeInt16LE(Math.round(score[i] * fade * 32_767), 44 + i * 2);
}
writeFileSync(path.join(dir, 'score.wav'), wav);
