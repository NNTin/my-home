import { describe, expect, it } from 'vitest';
import { statusText } from './RenderStill';
import { NO_PROGRESS, stillSize } from './still';

describe('a still of render mode', () => {
  it('has a pixel for each CSS pixel of the view, at most 1920 wide', () => {
    expect(stillSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(stillSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(stillSize(2560, 1440)).toEqual({ width: 1920, height: 1080 });
    expect(stillSize(0, 0)).toEqual({ width: 16, height: 16 });
  });

  it('says how far it is', () => {
    expect(statusText(NO_PROGRESS)).toBe('Preparing the scene');
    expect(statusText({ ...NO_PROGRESS, stage: 'compiling', seconds: 3.2 })).toBe(
      'Preparing the tracer, 3 s',
    );
    const tracing = { ...NO_PROGRESS, stage: 'rendering' as const, samples: 96, seconds: 22.6 };
    expect(statusText(tracing)).toBe('Rendering: 96 of 256 samples, 23 s');
    expect(statusText({ ...tracing, running: false })).toBe('Stopped at 96 of 256 samples, 23 s');
    expect(statusText({ ...tracing, samples: 256, done: true, running: false, seconds: 41 })).toBe(
      'Done: 256 samples in 41 s',
    );
  });
});
