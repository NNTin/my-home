import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import type { Vec2 } from '../builder/buildHome';
import { calibrationTargets } from './calibration';

const home = HomeModel.parse(structuredClone(realHomeJson));
const outlineOf = (roomId: string) =>
  home.rooms.find((r) => r.id === roomId)!.outline.map((p): Vec2 => [p.x.value, p.z.value]);

describe('calibration targets', () => {
  it('offers the doors and windows of the room the figure is in, nearest first', () => {
    // In the bed room, a metre and a half inside its corridor door.
    const targets = calibrationTargets(
      home,
      'souterrain',
      [10.635, -4.4],
      outlineOf('souterrain-bed-room'),
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]).toMatchObject({
      id: 'door-souterrain-corridor-bed-room',
      label: 'Door: corridor bed room',
    });
    expect(targets[0]!.x).toBeCloseTo(10.635);
    expect(targets[0]!.z).toBeCloseTo(-5.91);
    expect(targets.map((t) => t.distance)).toEqual(
      [...targets.map((t) => t.distance)].sort((a, b) => a - b),
    );
    // Nothing from other rooms or other levels.
    for (const target of targets)
      expect(target.id).toMatch(/bed-room|souterrain-window|souterrain-door/);
    expect(targets.some((t) => t.id.includes('work-room') || t.id.includes('bath-room'))).toBe(
      false,
    );
  });

  it('leaves out an opening the figure is standing in', () => {
    const inDoorway = calibrationTargets(
      home,
      'souterrain',
      [10.635, -5.81],
      outlineOf('souterrain-bed-room'),
    );
    expect(inDoorway.map((t) => t.id)).not.toContain('door-souterrain-corridor-bed-room');
  });

  it('offers nearby openings when the figure is in no room', () => {
    const outside = calibrationTargets(home, 'souterrain', [14.5, -6.6]);
    expect(outside.map((t) => t.id)).toContain('door-souterrain-corridor-patio');
    expect(outside.every((t) => t.distance <= 8)).toBe(true);
    expect(calibrationTargets(home, undefined, [14.5, -6.6])).toEqual([]);
  });
});
