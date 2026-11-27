import { describe, expect, it } from 'vitest';
import { buildHome } from '../builder/buildHome';
import { defaultVisibility } from '../builder/visibility';
import { mockHome } from '../test/fixtures';
import { openingSides, roomFloorAt, roomFocus } from './rooms';

const scene = buildHome(mockHome);

describe('rooms in the viewer (HUD v2 #201)', () => {
  it('finds the room whose floor a click lands on, of the rooms shown', () => {
    const v = defaultVisibility(scene);
    const room = scene.roomFloors.find((r) => r.levelId === 'souterrain')!;
    expect(roomFloorAt(scene, v, [room.labelAt[0], room.y, room.labelAt[2]])?.id).toBe(room.id);
    // Far outside the house, or a metre above the floor: none.
    expect(roomFloorAt(scene, v, [500, room.y, 500])).toBeUndefined();
    expect(roomFloorAt(scene, v, [room.labelAt[0], room.y + 1, room.labelAt[2]])).toBeUndefined();
    // Its level hidden: its rooms are not picked.
    const hidden = { ...v, hiddenLevels: ['souterrain'] };
    expect(roomFloorAt(scene, hidden, [room.labelAt[0], room.y, room.labelAt[2]])).toBeUndefined();
  });

  it('frames a room around its floor', () => {
    const room = scene.roomFloors[0]!;
    const focus = roomFocus(room);
    expect(focus.center[1]).toBeGreaterThan(room.y);
    expect(focus.radius).toBeGreaterThanOrEqual(1.5);
  });

  it('names the spaces an opening links', () => {
    const door = scene.openings.find((o) => o.id === 'souterrain-living-door')!;
    const sides = openingSides(scene, door);
    expect(sides).toHaveLength(2);
    expect(sides).toContain('Living room');
  });
});
