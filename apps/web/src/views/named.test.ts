import { HomeModel } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome } from '../builder/buildHome';
import { groupShown, shellItems } from '../builder/drawList';
import { rigFor } from '../lighting/rig';
import {
  CUT_OFFSET,
  defaultView,
  exportSize,
  EYE_LEVEL,
  eyePosition,
  eyeRooms,
  houseBounds,
  imageName,
  parseView,
  sectionPlane,
  sectionRange,
  VIEW_FOV,
  viewFrame,
  viewQuery,
  viewRig,
  viewVisibility,
  withView,
  type NamedView,
} from './named';

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));

/** Whether a plan point is inside an outline. */
function inside([x, z]: [number, number], outline: readonly [number, number][]) {
  let odd = false;
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) odd = !odd;
  });
  return odd;
}

describe('the URL of a named view', () => {
  it('reads each view with its parameters', () => {
    expect(parseView('?view=cutaway&level=ground-floor', home)).toEqual({
      kind: 'cutaway',
      levelId: 'ground-floor',
    });
    expect(parseView('?view=section&look=east&at=3.25', home)).toEqual({
      kind: 'section',
      look: 'east',
      at: 3.25,
    });
    expect(parseView('?view=eye&room=souterrain-kitchen&look=-90', home)).toEqual({
      kind: 'eye',
      roomId: 'souterrain-kitchen',
      look: 270,
    });
  });

  it('takes the defaults for what is missing or names nothing of this home', () => {
    expect(parseView('?view=cutaway', home)).toEqual({ kind: 'cutaway', levelId: 'souterrain' });
    expect(parseView('?view=cutaway&level=cellar', home)).toEqual(defaultView(home, 'cutaway'));
    expect(parseView('?view=section&look=up&at=far', home)).toEqual({
      kind: 'section',
      look: 'north',
      at: sectionRange(home, 'north').depth / 2,
    });
    const eye = parseView('?view=eye&room=first-floor-interior', home);
    expect(eye).toMatchObject({ kind: 'eye', roomId: eyeRooms(home)[0]!.roomId });
  });

  it('keeps a cut inside the building', () => {
    const { depth } = sectionRange(home, 'west');
    expect(parseView('?view=section&look=west&at=99', home)).toMatchObject({ at: depth });
    expect(parseView('?view=section&look=west&at=-2', home)).toMatchObject({ at: 0 });
  });

  it('is no view without ?view= or with an unknown one', () => {
    expect(parseView('', home)).toBeUndefined();
    expect(parseView('?view=plan&quality=fast', home)).toBeUndefined();
  });

  it.each<NamedView>([
    { kind: 'cutaway', levelId: 'ground-floor' },
    { kind: 'section', look: 'south', at: 4.4 },
    { kind: 'eye', roomId: 'souterrain-bed-room', look: 135 },
  ])('writes $kind as it reads it', (view) => {
    const search = `?${new URLSearchParams(viewQuery(view))}`;
    expect(parseView(search, home)).toEqual(view);
  });

  it('replaces the view in an address and keeps every other parameter', () => {
    const next = withView('?quality=fast&view=cutaway&level=souterrain&hints=off', {
      kind: 'section',
      look: 'east',
      at: 2,
    });
    expect(new URLSearchParams(next).toString()).toBe(
      'quality=fast&hints=off&view=section&look=east&at=2',
    );
    expect(withView('?view=eye&room=a&look=10&home=home', undefined)).toBe('?home=home');
    expect(withView('?view=eye', undefined)).toBe('');
  });
});

describe('what a named view shows and how', () => {
  it('a cutaway shows the levels up to its own, a section and the eye the whole house', () => {
    const cutaway = viewVisibility(home, { kind: 'cutaway', levelId: 'ground-floor' });
    expect(cutaway.maxLevelIndex).toBe(1);
    expect(cutaway.hiddenLevels).toEqual(['first-floor']);
    for (const view of [
      { kind: 'section', look: 'north', at: 3 },
      { kind: 'eye', roomId: 'souterrain-kitchen', look: 0 },
    ] as const) {
      const v = viewVisibility(home, view);
      for (const item of shellItems(home)) expect(groupShown(item.group, home, v)).toBe(true);
    }
  });

  it('the cutaway looks down from the south-east with a narrow field of view', () => {
    const frame = viewFrame(home, { kind: 'cutaway', levelId: 'souterrain' });
    expect(frame.fov).toBe(20);
    const [x, y, z] = frame.from;
    expect(x).toBeCloseTo(z);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0.5);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    // It turns about the middle of the level it looks into.
    const level = home.levels.find((l) => l.id === 'souterrain')!;
    expect(frame.center[1]).toBeCloseTo(level.elevation + level.height / 2);
  });

  it.each(['north', 'east', 'south', 'west'] as const)(
    'a section looking %s stands level with the middle of the house, in front of it',
    (look) => {
      const frame = viewFrame(home, { kind: 'section', look, at: 2 });
      const { min, max } = houseBounds(home);
      expect(frame.fov).toBe(25);
      expect(frame.from[1]).toBe(0);
      expect(frame.center[1]).toBeCloseTo((min[1] + max[1]) / 2);
      // The camera looks along the look: it stands on the other side.
      const plane = sectionPlane(home, { look, at: 2 });
      expect(frame.from[0] * plane.normal[0] + frame.from[2] * plane.normal[2]).toBeCloseTo(-1);
      // The whole height and the house's width with garden on both sides.
      const across = look === 'north' || look === 'south' ? max[0] - min[0] : max[2] - min[2];
      expect(frame.extent![0]).toBeGreaterThan(across / 2 + 5);
      expect(frame.extent![1]).toBeGreaterThan((max[1] - min[1]) / 2);
    },
  );

  it('the eye stands in its room, 1.6 m above the floor, clear of the walls', () => {
    const rooms = eyeRooms(home);
    expect(rooms.length).toBeGreaterThan(5);
    for (const room of rooms) {
      const own = defaultView(home, 'eye', room.roomId);
      for (const look of [0, 45, 90, 180, 270, own?.kind === 'eye' ? own.look : 0]) {
        const [x, y, z] = eyePosition(room, look);
        expect(inside([x, z], room.outline), `${room.roomId} at ${look}`).toBe(true);
        expect(y).toBeCloseTo(room.y + EYE_LEVEL);
      }
    }
    const frame = viewFrame(home, { kind: 'eye', roomId: 'souterrain-kitchen', look: 90 });
    expect(frame.fov).toBe(VIEW_FOV.eye);
    // Looking east: the camera is west of the point it turns about, a hand's width away.
    expect(frame.from).toEqual([-1, 0, expect.closeTo(0)]);
    expect(frame.distance).toBeLessThan(0.2);
  });

  it('the cut is a plane across the look, between the near and the far face of the house', () => {
    const { min, max } = houseBounds(home);
    expect(sectionRange(home, 'north')).toEqual({ near: -max[2], depth: max[2] - min[2] });
    expect(sectionRange(home, 'east')).toEqual({ near: min[0], depth: max[0] - min[0] });
    // Looking north from the south, 2 m in: everything north of z = max - 2 is kept.
    const plane = sectionPlane(home, { look: 'north', at: 2 });
    expect(plane.normal).toEqual([0, 0, -1]);
    const kept = (z: number) => plane.normal[2] * z + plane.constant >= 0;
    expect(kept(max[2] - 2.01)).toBe(true);
    expect(kept(max[2] - 1.99)).toBe(false);
    // Never exactly in a wall face, which stands at whole centimetres.
    expect(-plane.constant - (-max[2] + 2)).toBeCloseTo(CUT_OFFSET);
  });

  it('each view has its rig: the studio backdrop, and for a section the sun behind the camera', () => {
    expect(viewRig({ kind: 'cutaway', levelId: 'souterrain' })).toEqual({ kind: 'cutaway' });
    expect(viewRig({ kind: 'eye', roomId: 'r', look: 0 })).toEqual({ kind: 'eye' });
    const rig = rigFor(viewRig({ kind: 'section', look: 'north', at: 1 }));
    expect(rig.backdrop).toBe('studio-light');
    // Looking north, the camera stands in the south (+z): so does the sun.
    expect(rig.sun.direction[2]).toBeGreaterThan(0);
  });
});

describe('an exported image', () => {
  it('is named after its view and the minute it was made', () => {
    expect(imageName('section', new Date(2026, 10, 4, 9, 5))).toBe(
      'my-home-section-20261104-0905.png',
    );
  });

  it('has twice the canvas size, and is at most 3840 px wide', () => {
    expect(exportSize(1440, 900)).toEqual({ width: 2880, height: 1800, ratio: 2 });
    expect(exportSize(390, 468)).toEqual({ width: 780, height: 936, ratio: 2 });
    const wide = exportSize(2560, 1300);
    expect(wide.width).toBe(3840);
    expect(wide.height).toBe(1950);
  });
});
