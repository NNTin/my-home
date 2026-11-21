import { describe, expect, it } from 'vitest';
import type { Light } from 'three';
import type { Emitter } from './lamps';
import { rigFor } from './rig';
import { SceneLights } from './sceneLights';

const emitter = (id: string, x: number, roomId: string): Emitter => ({
  id,
  position: [x, 2.25, 2],
  color: '#fff0dc',
  intensity: 65,
  range: 4,
  roomId,
});
/** Nine lamps in two rooms, as the souterrain has. */
const emitters = [
  ...[0, 1, 2, 3, 4].map((i) => emitter(`a${i}`, i, 'a')),
  ...[0, 1, 2, 3].map((i) => emitter(`b${i}`, 10 + i, 'b')),
];

function lights(phone: boolean) {
  const made = new SceneLights(phone);
  made.setRig(rigFor({ kind: 'free' }));
  return made;
}
const all = (l: SceneLights) => l.group.children.filter((o) => (o as Light).isLight) as Light[];
const casting = (l: SceneLights) => all(l).filter((o) => o.castShadow);

describe('the scene lights', () => {
  it('a phone has 6 pool lights and one shadow, the sun: no lamp ever casts one', () => {
    const l = lights(true);
    expect(l.lamps).toHaveLength(6);
    expect(casting(l)).toEqual([l.sun]);
    expect(l.update({ emitters, focus: [0, 0, 2] })).toMatchObject({ lit: 6, reassigned: 6 });
    expect(l.update({ emitters, focus: [0, 0, 2] }).reassigned).toBe(0);
    expect(casting(l)).toEqual([l.sun]);
  });

  it('a desktop has 12 pool lights, of which 4 cast shadows, and the sun', () => {
    const l = lights(false);
    expect(l.lamps).toHaveLength(12);
    expect(l.shadowCasters).toHaveLength(4);
    expect(casting(l)).toHaveLength(5);
    expect(l.update({ emitters, focus: [0, 0, 2] }).lit).toBe(9);
    // The four nearest emitters have the lamps that cast shadows.
    expect(l.assignment.slice(0, 4)).toEqual(['a0', 'a1', 'a2', 'a3']);
  });

  it('never adds or removes a light: unassigned ones stay, at intensity 0', () => {
    for (const phone of [true, false]) {
      const l = lights(phone);
      const count = all(l).length;
      expect(count).toBe(l.lamps.length + 2);
      l.update({ emitters: [], focus: [0, 0, 0] });
      expect(l.lamps.every((lamp) => lamp.intensity === 0)).toBe(true);
      l.update({ emitters: emitters.slice(0, 2), focus: [0, 0, 0] });
      expect(l.lamps.filter((lamp) => lamp.intensity > 0)).toHaveLength(2);
      expect(l.lamps.slice(2).every((lamp) => lamp.intensity === 0)).toBe(true);
      l.update({ emitters, focus: [0, 0, 0], eye: { position: [0, 1.6, 2], roomId: 'a' } });
      expect(all(l)).toHaveLength(count);
      expect(casting(l)).toHaveLength(phone ? 1 : 5);
    }
  });

  it('moves a light to its emitter with its colour, the intensity of the rig and its range', () => {
    const l = lights(true);
    l.update({ emitters: [emitters[0]!], focus: [0, 0, 0] });
    const lamp = l.lamps[0]!;
    expect(lamp.position.toArray()).toEqual([0, 2.25, 2]);
    expect(lamp.distance).toBe(4);
    expect(lamp.intensity).toBeCloseTo(65 * rigFor({ kind: 'free' }).lamps.intensity, 9);
    expect(`#${lamp.color.getHexString()}`).toBe('#fff0dc');
  });

  it('lights the same lamps the same way whatever tier is drawn: the pool knows no tier', () => {
    const fast = lights(true);
    const beautiful = lights(true);
    const frames = [
      { emitters, focus: [0, 0, 2] as [number, number, number] },
      {
        emitters,
        focus: [12, 1.6, 2] as [number, number, number],
        eye: { position: [12, 1.6, 2] as [number, number, number], roomId: 'b' },
      },
    ];
    for (const frame of frames) {
      fast.update(frame);
      beautiful.update(frame);
      expect(beautiful.assignment).toEqual(fast.assignment);
      expect(beautiful.lamps.map((x) => x.intensity)).toEqual(fast.lamps.map((x) => x.intensity));
    }
  });

  it('draws a lamp shadow again only when its lamp moved, or when asked to', () => {
    const l = lights(false);
    const settle = () => l.shadowCasters.forEach((lamp) => (lamp.shadow.needsUpdate = false));
    expect(l.update({ emitters, focus: [0, 0, 2] }).shadowsMoved).toBe(true);
    settle();
    expect(l.update({ emitters, focus: [0, 0, 2] }).shadowsMoved).toBe(false);
    expect(l.shadowCasters.some((lamp) => lamp.shadow.needsUpdate)).toBe(false);
    l.redrawLampShadows();
    expect(l.shadowCasters.every((lamp) => lamp.shadow.needsUpdate)).toBe(true);
  });

  it('draws the map again for a lamp that was unlit while the casters changed', () => {
    const l = lights(false);
    const settle = () => l.shadowCasters.forEach((lamp) => (lamp.shadow.needsUpdate = false));
    const one = [emitters[0]!];
    l.update({ emitters: one, focus: [0, 0, 2] });
    const lamp = l.shadowCasters[0]!;
    settle();
    // Its emitter goes (the apartment is hidden): the lamp is unlit.
    l.update({ emitters: [], focus: [0, 0, 2] });
    expect(lamp.intensity).toBe(0);
    // Meanwhile something that casts shadows moves: an unlit lamp's map is not drawn.
    l.redrawLampShadows();
    expect(lamp.shadow.needsUpdate).toBe(false);
    // The same emitter comes back, at the same place: its map is stale and is drawn again.
    expect(l.update({ emitters: one, focus: [0, 0, 2] }).shadowsMoved).toBe(true);
    expect(l.assignment[0]).toBe('a0');
    expect(lamp.shadow.needsUpdate).toBe(true);
  });

  it('lights the head lamp only at the eye in a room without an emitter', () => {
    const l = lights(true);
    l.update({ emitters, focus: [0, 0, 2] });
    expect(l.head.intensity).toBe(0);
    l.update({ emitters, focus: [1, 1.6, 2], eye: { position: [1, 1.6, 2], roomId: 'a' } });
    expect(l.head.intensity).toBe(0);
    l.update({ emitters, focus: [5, 1.6, 9], eye: { position: [5, 1.6, 9], roomId: 'dark' } });
    expect(l.head.intensity).toBeGreaterThan(0);
    expect(l.head.position.toArray()).toEqual([5, 1.6, 9]);
  });

  it('lights no lamp when the rig turns them off', () => {
    const l = new SceneLights(true);
    l.setRig({ ...rigFor({ kind: 'free' }), lamps: { on: false, intensity: 1 } });
    expect(l.update({ emitters, focus: [0, 0, 2] }).lit).toBe(0);
  });
});
