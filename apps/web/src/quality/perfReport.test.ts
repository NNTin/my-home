import { describe, expect, it } from 'vitest';
import type { PerfData } from './governor';
import {
  BUDGETS,
  perfReport,
  perfRows,
  perfView,
  shortUserAgent,
  type PerfContext,
} from './perfReport';

const data: PerfData = {
  setting: 'auto',
  tier: 'beautiful',
  state: 'settled',
  frames: 412,
  recentDrawCalls: 0,
  recentFrames: 0,
  medianFrameMs: 16.66,
  p95FrameMs: 24.04,
  refinedFrameMs: 180.25,
  refinedFrames: 3,
  beautifulReady: true,
  steppedDown: undefined,
  drawCalls: 134,
  triangles: 17169,
  programs: 7,
  compiles: 7,
  compiled: false,
  textures: 4,
  shadowLights: 1,
  litLamps: 6,
  lampChanges: 2,
};

const PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36';

const context: PerfContext = {
  commit: 'e49f8121da8338b88e25e4ff26f0aaaaaaaaaaaa',
  view: 'walk, first person, level "Souterrain"',
  phone: true,
  viewport: { width: 844, height: 390 },
  devicePixelRatio: 2.625,
  canvas: { width: 1688, height: 780 },
  userAgent: PIXEL,
  time: new Date('2026-11-21T10:15:30.123Z'),
};

/** The table as cells: one array per line. */
const table = (text: string) =>
  text
    .trimEnd()
    .split('\n')
    .map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.trim()),
    );

describe('perfRows', () => {
  it('holds the measured values against the budgets of the device class', () => {
    const budget = (phone: boolean, name: string) =>
      perfRows(data, phone).find((r) => r.name === name)?.budget;
    expect(budget(true, 'Draw calls, last frame')).toBe('≤ 250 first view, ≤ 350 whole house');
    expect(budget(false, 'Draw calls, last frame')).toBe('≤ 350 first view, ≤ 500 whole house');
    expect(budget(true, 'Draw calls, last 3 s')).toBe('0 while resting');
    expect(budget(true, 'Triangles')).toBe('≤ 150,000 whole house');
    expect([budget(true, 'Lit lamps'), budget(false, 'Lit lamps')]).toEqual(['≤ 6', '≤ 12']);
    expect([budget(true, 'Lights with shadows'), budget(false, 'Lights with shadows')]).toEqual([
      '≤ 1',
      '≤ 5',
    ]);
    expect([budget(true, 'Frame, median'), budget(false, 'Frame, median')]).toEqual([
      '≤ 33 ms',
      '≤ 17 ms',
    ]);
    expect([budget(true, 'Refined frame'), budget(false, 'Refined frame')]).toEqual([
      '≤ 300 ms',
      'n/a',
    ]);
    expect(budget(true, 'Setting')).toBeUndefined();
  });

  it('says what is not known yet, and what the viewer stepped down to', () => {
    const rows = perfRows(
      {
        ...data,
        medianFrameMs: undefined,
        refinedFrameMs: undefined,
        refinedFrames: 0,
        beautifulReady: false,
        tier: 'fast',
        state: 'moving',
        steppedDown: 'fast',
      },
      true,
    );
    const value = (name: string) => rows.find((r) => r.name === name)?.value;
    expect(value('Frame, median')).toBe('–');
    expect(value('Refined frame')).toBe('– (0 drawn)');
    expect(value('Tier')).toBe('fast (beautiful not loaded)');
    expect(value('View')).toBe('moving');
    expect(value('Stepped down')).toBe('yes, to fast');
  });
});

describe('perfReport', () => {
  const text = perfReport(data, context);
  const lines = table(text);

  it('is one markdown table of three columns', () => {
    expect(lines[0]).toEqual(['`?perf=1`', 'Measured', 'Budget (phone)']);
    expect(text.split('\n')[1]).toBe('| --- | --- | --- |');
    for (const line of text.trimEnd().split('\n')) {
      expect(line.startsWith('| ') && line.endsWith(' |')).toBe(true);
      expect(line.match(/(?<!\\)\|/g)).toHaveLength(4);
    }
    expect(text.endsWith('|\n')).toBe(true);
    expect(text).not.toContain('\n\n');
  });

  it('starts with the context to compare runs', () => {
    expect(lines.slice(2, 9)).toEqual([
      ['Commit', 'e49f812', ''],
      ['Time', '2026-11-21T10:15:30Z', ''],
      ['Device class', 'phone', ''],
      ['Browser', 'Chrome 130, Android 14', ''],
      ['Viewport', '844×390, device pixel ratio 2.63', ''],
      ['Canvas', '1688×780 px', ''],
      ['Mode', 'walk, first person, level "Souterrain"', ''],
    ]);
  });

  it('carries every row of the readout, with its budget', () => {
    const rows = perfRows(data, true);
    expect(rows).toHaveLength(15);
    expect(lines.slice(9)).toEqual(rows.map((r) => [r.name, r.value, r.budget ?? '']));
    expect(lines).toContainEqual(['Setting', 'auto', '']);
    expect(lines).toContainEqual(['Tier', 'beautiful', '']);
    expect(lines).toContainEqual([
      'Draw calls, last frame',
      '134',
      '≤ 250 first view, ≤ 350 whole house',
    ]);
    expect(lines).toContainEqual(['Draw calls, last 3 s', '0 (0 frames)', '0 while resting']);
    expect(lines).toContainEqual(['Frame, median', '16.7 ms', '≤ 33 ms']);
    expect(lines).toContainEqual(['Refined frame', '180.3 ms (3 drawn)', '≤ 300 ms']);
  });

  it("names a desktop's budgets on a desktop", () => {
    const desktop = table(perfReport(data, { ...context, phone: false }));
    expect(desktop[0]).toEqual(['`?perf=1`', 'Measured', 'Budget (desktop)']);
    expect(desktop).toContainEqual(['Frame, median', '16.7 ms', '≤ 17 ms']);
    expect(desktop).toContainEqual(['Device class', 'desktop', '']);
  });

  it('says what it does not know, and keeps the table whole', () => {
    const unknown = perfReport(data, {
      ...context,
      commit: undefined,
      canvas: undefined,
      view: 'orbit | a\nb',
    });
    const cells = table(unknown);
    expect(cells).toContainEqual(['Commit', 'unknown', '']);
    expect(cells).toContainEqual(['Canvas', 'unknown', '']);
    expect(unknown).toContain('| Mode | orbit \\| a b | |');
  });
});

describe('shortUserAgent', () => {
  it.each([
    [PIXEL, 'Chrome 130, Android 14'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
      'Safari 17, iOS 17.4',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1',
      'Chrome 130, iOS 17.4',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge 130, Windows 10.0',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari 18, macOS 10.15',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox 131, Linux',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      'Samsung Internet 26, Android 14',
    ],
    ['SomethingElse/1.0', 'SomethingElse/1.0'],
    ['', 'unknown'],
  ])('%s', (userAgent, short) => {
    expect(shortUserAgent(userAgent)).toBe(short);
  });
});

describe('perfView', () => {
  const levels = [
    { id: 'ug', name: 'Souterrain', index: 0 },
    { id: 'eg', name: 'Ground floor', index: 1 },
  ];

  it('names the cutaway of an orbit view', () => {
    expect(perfView({ levels, maxLevelIndex: 0 })).toBe('orbit, cutaway at level "Souterrain"');
    expect(perfView({ levels, maxLevelIndex: 2 })).toBe('orbit, whole house with roof');
  });

  it('names the walk view and the level the figure is on', () => {
    const walk = (view: 'first' | 'third', levelId?: string) =>
      perfView({ levels, maxLevelIndex: 2, walk: { view, levelId } });
    expect(walk('first', 'ug')).toBe('walk, first person, level "Souterrain"');
    expect(walk('third', 'eg')).toBe('walk, overview, level "Ground floor"');
    expect(walk('first')).toBe('walk, first person, outdoors');
  });

  it('names a photo viewpoint', () => {
    expect(perfView({ levels, maxLevelIndex: 2, viewpoint: true })).toBe('photo viewpoint');
  });
});

describe('BUDGETS', () => {
  it('are the ones of the design (§10.1)', () => {
    expect(BUDGETS.drawCalls).toEqual({
      default: { phone: 250, desktop: 350 },
      whole: { phone: 350, desktop: 500 },
    });
    expect(BUDGETS.shadowLights).toEqual({ phone: 1, desktop: 5 });
    expect(BUDGETS.litLamps).toEqual({ phone: 6, desktop: 12 });
  });
});
