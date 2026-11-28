import { describe, expect, it } from 'vitest';
import { hudReport, intervals, percentile, type HudContext } from './report';

const context: HudContext = {
  commit: '0123456789abcdef',
  time: new Date('2026-11-27T10:00:00Z'),
  device: 'Chrome 131, Android 14',
  viewport: { width: 390, height: 844 },
  devicePixelRatio: 3,
  reducedMotion: false,
  calm: false,
  hud: true,
  core: true,
};

describe('the HUD measurement', () => {
  it('takes frame times and percentiles by nearest rank', () => {
    expect(intervals([0, 16, 33, 50])).toEqual([16, 17, 17]);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBeUndefined();
  });

  it('is a table to paste: the context, each run, and the rest check', () => {
    const report = hudReport(
      context,
      [
        {
          kind: 'orbit',
          effects: false,
          frameTimes: [0, 16, 32, 48],
          sakugaFrames: 0,
          sakugaMs: 0,
          fired: 0,
        },
        {
          kind: 'walk',
          effects: true,
          frameTimes: [0, 20, 40, 80],
          sakugaFrames: 300,
          sakugaMs: 450,
          fired: 20,
        },
      ],
      [
        { when: 'Before the runs', frames: 0, seconds: 2, running: false },
        { when: 'After the effects', frames: 0, seconds: 2, running: false },
      ],
    );
    expect(report).toContain('| Commit | 0123456 |');
    expect(report).toContain('| Screen | 390×844 css px, ×3 |');
    expect(report).toContain(
      '| Orbit (the camera turns by script) | none | 4 | 16.0 ms | 16.0 ms | 0 | – |',
    );
    expect(report).toContain(
      '| Walk (forward and turning, first person) | 20 fired (a burst, a puff and a word, 4 a second) | 4 | 20.0 ms | 40.0 ms | 300 | 1.5 ms |',
    );
    expect(report).toContain('| Before the runs (2 s, nothing used) | 0 | no |');
    expect(report).toContain('C1 holds');
  });

  it('says when the clock ran at rest, and when effects were off', () => {
    const report = hudReport(
      { ...context, calm: true },
      [],
      [{ when: 'After the effects', frames: 12, seconds: 2, running: true }],
    );
    expect(report).toContain('off (calm)');
    expect(report).toContain('C1 does not hold');
  });

  it('does not count a rest the effects had not left', () => {
    const report = hudReport(
      context,
      [],
      [
        { when: 'Before the runs', frames: 0, seconds: 2, running: false },
        { when: 'After the walk', frames: 2, seconds: 2, running: true, unsettled: true },
      ],
    );
    expect(report).toContain('nothing used; the effects had not ended after 30 s) | 2 | yes |');
    expect(report).toContain('C1 holds');
  });
});
