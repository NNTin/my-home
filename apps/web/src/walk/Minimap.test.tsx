import { HomeModel } from '@my-home/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome, type Vec2 } from '../builder/buildHome';
import { createContext } from '../editor/operations';
import { roomAt } from '../editor/placement';
import { furniture } from '../catalog/furniture';
import { mockHome } from '../test/fixtures';
import type { Figure } from './figure';
import { Minimap, MINIMAP_KEY, type MapSpot } from './Minimap';
import { groundLevelId, minimapLevels } from './minimap';
import { buildWalkWorld, placeAt, walk, type Footing } from './world';

const scene = buildHome(mockHome);
const levels = minimapLevels(scene, createContext(mockHome, furniture).plans, 'souterrain');
const start: Figure = { x: 0.5, z: 0, y: -1.2, levelId: 'souterrain', yaw: 0, pitch: 0 };

function setup(props: Partial<Parameters<typeof Minimap>[0]> = {}): ReturnType<typeof render> & {
  rerenderWith(next: Partial<Parameters<typeof Minimap>[0]>): void;
} {
  const all = {
    figure: start,
    levels,
    groundLevelId: 'souterrain',
    northBearing: 30,
    roomId: 'souterrain-hallway',
    requests: [] as MapSpot[],
    photos: [] as MapSpot[],
    ...props,
  };
  const result = render(<Minimap {...all} />);
  return {
    ...result,
    rerenderWith: (next) => result.rerender(<Minimap {...all} {...next} />),
  };
}
const svg = () => document.querySelector('.walk-map-svg') as SVGSVGElement;
const figureMark = () => svg().querySelector('.map-figure') as SVGGElement;

describe('Minimap', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the level, the room the figure is in and where it stands and looks', () => {
    const { rerenderWith } = setup();
    expect(
      screen.getByRole('button', { name: 'Map of Souterrain, in Hallway. Tap to enlarge' }),
    ).toBeInTheDocument();
    expect(svg().dataset.level).toBe('souterrain');
    expect(svg().querySelector('.map-room.here')?.getAttribute('data-room')).toBe(
      'souterrain-hallway',
    );
    expect([...svg().querySelectorAll('.map-label')].map((t) => t.textContent)).toContain(
      'Kitchen',
    );
    expect(figureMark().dataset).toMatchObject({ x: '0.50', z: '0.00' });
    // Heading-up by default: facing -z needs no turn; the cone points along -z.
    expect(svg().dataset.orientation).toBe('heading');
    expect(svg().dataset.rotation).toBe('0.0');
    const cone = figureMark().querySelector('.map-cone')!.getAttribute('d')!;
    const tips = [...cone.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(tips.every((z) => z < 0)).toBe(true);

    // It follows the figure: walked and turned left by 90°, the map turns 90° clockwise.
    rerenderWith({ figure: { ...start, x: 1, z: -2, yaw: Math.PI / 2 } });
    expect(figureMark().dataset).toMatchObject({ x: '1.00', z: '-2.00' });
    expect(svg().dataset.rotation).toBe('90.0');
  });

  it('turns north-up on request, with the north arrow, and remembers it', () => {
    const { unmount } = setup({ figure: { ...start, yaw: 1 } });
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    fireEvent.click(screen.getByRole('radio', { name: /North/ }));
    expect(svg().dataset).toMatchObject({ orientation: 'north', rotation: '-30.0' });
    // The arrow points straight up once north is up.
    expect(svg().querySelector('.map-north path')!.getAttribute('transform')).toBe('rotate(0.0)');
    expect(JSON.parse(localStorage.getItem(MINIMAP_KEY)!)).toMatchObject({ orientation: 'north' });
    unmount();
    setup({ figure: { ...start, yaw: 1 } });
    expect(svg().dataset.orientation).toBe('north');
  });

  it('shows the request targets of this level, the chosen one marked, and photos on request', () => {
    setup({
      requests: [
        { id: 'r-here', x: 3, z: -2, levelId: 'souterrain', active: true },
        { id: 'r-up', x: 3, z: -2, levelId: 'ground-floor' },
      ],
      photos: [{ id: 'p-1', x: 2, z: 2, yaw: 0, levelId: 'souterrain' }],
    });
    const requests = [...svg().querySelectorAll('.map-request')];
    expect(requests.map((r) => r.getAttribute('data-request'))).toEqual(['r-here']);
    expect(requests[0]).toHaveClass('active');
    expect(svg().querySelector('.map-photo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos on the map' }));
    expect(svg().querySelector('[data-photo="p-1"]')).not.toBeNull();
  });

  it('enlarges with a tap and shrinks with a tap or Close', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    expect(screen.getByRole('region', { name: 'Map' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('application', { name: /Tap to shrink/ }));
    expect(screen.queryByRole('region', { name: 'Map' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close the map' }));
    expect(screen.getByRole('button', { name: /Tap to enlarge/ })).toBeInTheDocument();
  });

  it('stands still while a spot is picked, also heading-up as the figure turns', () => {
    const { rerenderWith } = setup({ onPlace: () => true });
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    rerenderWith({ figure: { ...start, yaw: Math.PI / 2 }, onPlace: () => true });
    expect(svg().dataset.rotation).toBe('0.0');
    // A change of orientation turns it once, then it stands still again.
    fireEvent.click(screen.getByRole('radio', { name: /North/ }));
    expect(svg().dataset.rotation).toBe('-30.0');
    fireEvent.click(screen.getByRole('radio', { name: /Heading/ }));
    expect(svg().dataset.rotation).toBe('90.0');
    rerenderWith({ figure: { ...start, yaw: Math.PI }, onPlace: () => true });
    expect(svg().dataset.rotation).toBe('90.0');
    // Done picking: it follows the figure again.
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    expect(svg().dataset.rotation).toBe('180.0');
  });

  it('sets the figure down where the enlarged map is tapped, only where it can stand', () => {
    const onPlace = vi.fn<(point: Vec2, levelId: string) => boolean>(() => false);
    setup({ onPlace, northBearing: 0 });
    fireEvent.click(screen.getByRole('button', { name: /Tap to enlarge/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move/ }));
    const area = screen.getByRole('application', { name: /tap where the figure should stand/ });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
    } as DOMRect);
    // The centre of the map is the middle of the level.
    fireEvent.click(area, { clientX: 100, clientY: 100 });
    const [point, levelId] = onPlace.mock.lastCall!;
    const { min, max } = levels.get('souterrain')!.bounds;
    expect(point[0]).toBeCloseTo((min[0] + max[0]) / 2);
    expect(point[1]).toBeCloseTo((min[1] + max[1]) / 2);
    expect(levelId).toBe('souterrain');
    expect(screen.getByRole('status')).toHaveTextContent(/cannot stand there/);
    onPlace.mockReturnValue(true);
    fireEvent.click(area, { clientX: 120, clientY: 100 });
    // Heading-up at yaw 0 is plan-up: right of the centre is +x.
    expect(onPlace.mock.lastCall![0][0]).toBeGreaterThan(point[0]);
    expect(screen.queryByRole('region', { name: 'Map' })).not.toBeInTheDocument();
  });

  it('switches level on the stair of the real home, with the room it comes to', () => {
    const home = HomeModel.parse(structuredClone(realHomeJson));
    const homeScene = buildHome(home);
    const world = buildWalkWorld(home, homeScene);
    const plans = createContext(home, furniture).plans;
    const homeLevels = minimapLevels(
      homeScene,
      plans,
      groundLevelId(homeScene, home.terrain.groundElevation.value),
    );
    const figureAt = (f: Footing): Figure => ({ ...f, yaw: 0, pitch: 0 });
    const roomOf = (f: Footing) =>
      f.levelId === undefined ? undefined : roomAt(plans.get(f.levelId)!, [f.x, f.z])?.id;
    // The walking line up the stair (see world.test.ts), in small moves like a held pad.
    let at = placeAt(world, [2.85, -7.8], -2.6)!;
    const { rerender } = render(
      <Minimap
        figure={figureAt(at)}
        levels={homeLevels}
        groundLevelId={undefined}
        northBearing={0}
        roomId={roomOf(at)}
        requests={[]}
        photos={[]}
      />,
    );
    expect(svg().dataset.level).toBe('souterrain');
    expect(svg().querySelector('.map-stair')!.getAttribute('d')).not.toBe('');
    const seen = new Set<string>();
    for (const [x, z] of [
      [2.85, -8.43],
      [2.85, -10.05],
      [0.9, -10.05],
      [0.9, -8.43],
      [0.9, -7.6],
    ] as Vec2[]) {
      for (let i = 0; i < 400 && Math.hypot(x - at.x, z - at.z) > 0.02; i++) {
        const d = Math.hypot(x - at.x, z - at.z);
        at = walk(world, at, [
          ((x - at.x) / d) * Math.min(d, 0.05),
          ((z - at.z) / d) * Math.min(d, 0.05),
        ]);
        rerender(
          <Minimap
            figure={figureAt(at)}
            levels={homeLevels}
            groundLevelId={undefined}
            northBearing={0}
            roomId={roomOf(at)}
            requests={[]}
            photos={[]}
          />,
        );
        seen.add(svg().dataset.level!);
      }
    }
    expect([...seen]).toEqual(['souterrain', 'ground-floor']);
    expect(svg().dataset.level).toBe('ground-floor');
    expect(svg().querySelector('.map-room.here')?.getAttribute('data-room')).toBe(
      'ground-floor-interior',
    );
    expect(figureMark().dataset).toMatchObject({ x: at.x.toFixed(2), z: at.z.toFixed(2) });
  });
});
