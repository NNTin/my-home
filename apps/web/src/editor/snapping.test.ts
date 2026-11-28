import { describe, expect, it } from 'vitest';
import { mockHome } from '../test/fixtures';
import { floorPlan } from './floorPlan';
import { rectangle } from '../geom/geometry';
import { rotationFromDrag, snapAngle, snapToGrid, snapToWalls, type SnapInput } from './snapping';

const plan = floorPlan(mockHome, 'souterrain')!;
const bed = rectangle(1.6, 2);
const snap = (overrides: Partial<SnapInput>) =>
  snapToWalls({
    position: [-3, 2.5],
    rotationY: 0,
    footprint: bed,
    rule: 'back',
    walls: plan.walls,
    ...overrides,
  });

describe('grid and angle snapping', () => {
  it('snaps positions to the grid', () => {
    expect(snapToGrid([1.234, -0.049])).toEqual([1.2, -0]);
    expect(snapToGrid([1.3, 0.6], 0.5)).toEqual([1.5, 0.5]);
  });

  it('snaps angles to steps or leaves them free', () => {
    expect(snapAngle(0.9, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(snapAngle(0.2, (15 * Math.PI) / 180)).toBeCloseTo((15 * Math.PI) / 180);
    expect(snapAngle(0.9, 0)).toBe(0.9);
  });

  it('rotates by dragging around the centre', () => {
    // From east of the centre to north of it is +90° (counter-clockwise from above).
    expect(rotationFromDrag([0, 0], [1, 0], [0, -1], 0, 0)).toBeCloseTo(Math.PI / 2);
    expect(rotationFromDrag([0, 0], [1, 0], [0.9, -0.5], 0, Math.PI / 2)).toBe(0);
  });
});

describe('wall snapping', () => {
  it('leaves items out of reach alone', () => {
    expect(snap({})).toEqual({ position: [-3, 2.5], rotationY: 0, wallIds: [] });
  });

  it('moves a bed flush against the wall behind it, then into the corner', () => {
    // Back edge at z = 1.2, 14 cm from the living/bedroom wall face (z = 1.06); 5 cm from the
    // west wall face (x = -4.85) on the left.
    const result = snap({ position: [-4, 2.2] });
    expect(result.wallIds).toEqual(['souterrain-wall-living-bedroom', 'souterrain-wall-west']);
    expect(result.position[0]).toBeCloseTo(-4.05);
    expect(result.position[1]).toBeCloseTo(2.06);
    expect(result.rotationY).toBe(0);
  });

  it('turns an item that is almost aligned so its back faces the wall', () => {
    const result = snap({ position: [-3, 2.2], rotationY: 0.15 });
    expect(result.rotationY).toBeCloseTo(0);
    expect(result.position[1]).toBeCloseTo(2.06);
  });

  it('does not turn a "back" item whose back is far from facing the wall', () => {
    // Facing the wall (rotated 180°): its back is to the room, so it does not snap to that wall.
    expect(snap({ position: [-3, 2.2], rotationY: Math.PI }).wallIds).toEqual([]);
  });

  it('snaps any side with the "any" rule and never with "none"', () => {
    const any = snap({ position: [-3, 2.2], rotationY: Math.PI, rule: 'any' });
    expect(any.wallIds).toEqual(['souterrain-wall-living-bedroom']);
    expect(any.rotationY).toBeCloseTo(Math.PI);
    expect(snap({ position: [-3, 2.2], rule: 'none' }).wallIds).toEqual([]);
  });
});
