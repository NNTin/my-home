import type { RootState } from '@react-three/fiber';
import { Object3D, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { FrameControl } from '../scene/Frame';
import { exportImage } from './exportImage';

/** A canvas and a frame loop that record what the export does with them. */
function fake({ ready = true, width = 1440, height = 900 } = {}) {
  const log: string[] = [];
  let ratio = 1.5;
  const scene = new Scene();
  const letters = new Object3D();
  letters.userData.overlay = true;
  const hiddenHandle = new Object3D();
  hiddenHandle.userData.overlay = true;
  hiddenHandle.visible = false;
  const wall = new Object3D();
  scene.add(letters, hiddenHandle, wall);
  const png = new Blob(['png'], { type: 'image/png' });
  const state = {
    scene,
    size: { width, height },
    gl: {
      getPixelRatio: () => ratio,
      setPixelRatio: (value: number) => {
        ratio = value;
        log.push(`ratio ${value}`);
      },
      domElement: {
        toBlob: (done: (blob: Blob | null) => void) => {
          log.push(`toBlob at ${ratio}`);
          done(png);
        },
      },
    },
  } as unknown as RootState;
  const frame = {
    governor: { shownTier: 'fast' },
    beautifulReady: vi.fn(() => Promise.resolve(ready)),
    drawNow: (tier: string) =>
      log.push(`draw ${tier} at ${ratio}, letters ${letters.visible ? 'shown' : 'hidden'}`),
  } as unknown as FrameControl;
  return { state, frame, log, png, letters, hiddenHandle, wall };
}

describe('the image export', () => {
  it('draws one beautiful frame at twice the canvas size, without overlays, and puts the view back', async () => {
    const f = fake();
    await expect(exportImage(f.state, f.frame)).resolves.toBe(f.png);
    expect(f.log).toEqual([
      'ratio 2',
      'draw beautiful at 2, letters hidden',
      'toBlob at 2',
      'ratio 1.5',
      // The tier that was on screen, at the canvas' own size.
      'draw fast at 1.5, letters shown',
    ]);
    expect(f.letters.visible).toBe(true);
    // What was hidden before stays hidden.
    expect(f.hiddenHandle.visible).toBe(false);
    expect(f.wall.visible).toBe(true);
  });

  it('is at most 3840 px wide', async () => {
    const f = fake({ width: 2560, height: 1300 });
    await exportImage(f.state, f.frame);
    expect(f.log[0]).toBe('ratio 1.5');
  });

  it('fails without touching the canvas when the beautiful tier does not come', async () => {
    const f = fake({ ready: false });
    await expect(exportImage(f.state, f.frame)).rejects.toThrow(/beautiful/);
    expect(f.log).toEqual([]);
  });
});
