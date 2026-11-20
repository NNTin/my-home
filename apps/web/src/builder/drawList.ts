import type { Part } from '../catalog/types';
import type { Box, HomeScene, PlaneSlope, Prism, Surface, Vec2, Vec3 } from './buildHome';
import { roofIndex, type Visibility } from './visibility';

/**
 * The draw list: every solid of a home as plain data, in draw order, with all that is needed to
 * draw it. It sits between the builder's descriptors and three.js (docs/design/realistic-render.md
 * §4.2): `scene/batches.ts` merges it into few geometries, and the golden tests record it. Nothing
 * here imports three.js.
 */

/** A 4 × 4 transform, column-major like three.js' `Matrix4.elements`. */
export type Matrix = number[];

/** The solid of a draw item, in its local frame; `matrix` puts it into the world. */
export type DrawShape =
  /** Centred, [x, y, z] extents. */
  | { kind: 'box'; size: Vec3 }
  /** Upright, centred, of `diameter` and `height`, drawn with `CYLINDER_SEGMENTS` sides. */
  | { kind: 'cylinder'; diameter: number; height: number }
  /** A closed outline in local x/y, extruded through `depth` along z and centred on it. */
  | { kind: 'profile'; outline: Vec2[]; depth: number }
  /**
   * A plan polygon extruded from `bottom` up to `top` (or to its slope). Local (x, y) is plan
   * (x, z) and local z runs down from the top face, which the matrix puts at `top`.
   */
  | {
      kind: 'prism';
      outline: Vec2[];
      holes: Vec2[][];
      bottom: number;
      top: number;
      slope?: PlaneSlope;
    }
  /**
   * A flat plan polygon facing up at height `y` (or on its slope). Local (x, y) is plan
   * (x, -z); the matrix lays it down at `y`. Not a closed solid.
   */
  | { kind: 'surface'; outline: Vec2[]; holes: Vec2[][]; y: number; slope?: PlaneSlope };

/** Cylinders are drawn with this many sides. */
export const CYLINDER_SEGMENTS = 24;

/** Surface settings of an item beyond its finish; each is three.js' default when omitted. */
export interface DrawMaterial {
  transparent?: boolean;
  /** With `transparent`; written into the vertices, so it does not split a batch. */
  opacity?: number;
  depthWrite?: boolean;
  metalness?: number;
  roughness?: number;
  /** Drawn from both sides (flat polygons). */
  doubleSided?: boolean;
}

/**
 * What an item is shown and hidden with. Each is part of the batch key, so hiding a level, an
 * apartment or an outdoor area hides whole batches and rebuilds nothing (`groupShown`).
 */
export type DrawGroup =
  /** Walls, room floors, stairs and wall openings of a level (and apartment). */
  | { kind: 'level'; levelId: string; apartmentId?: string }
  /** The slab under a level; `roof`: the flat roof slab, shown only with the roof. */
  | { kind: 'slab'; levelId: string; roof: boolean }
  /** A lowered ceiling: it goes with the level above (or the roof). */
  | { kind: 'ceiling'; levelId: string; apartmentId?: string }
  /** Roof planes and roof windows. */
  | { kind: 'roof'; levelId: string }
  | { kind: 'terrain' }
  | { kind: 'area'; id: string }
  /** A fence or an outbuilding: always shown. */
  | { kind: 'structure'; id: string }
  /** A placed piece of furniture; the viewer decides which ones it draws. */
  | { kind: 'placement'; id: string };

export interface DrawItem {
  id: string;
  group: DrawGroup;
  /** The piece the item is a part of: a window, door, gate or furniture item. */
  piece?: string;
  shape: DrawShape;
  /** Local frame to world. */
  matrix: Matrix;
  /**
   * The finish. Until finishes exist (#112) it is today's colour (`#rrggbb`), or `part` for
   * the parts of a catalogue piece, which all share one material.
   */
  finish: string;
  /** The colour written into the vertices: differently tinted items share a batch. */
  tint: string;
  material?: DrawMaterial;
  castShadow: boolean;
  receiveShadow: boolean;
  /** A closed solid, which a section caps (§7.2); flat polygons are not. */
  closed: boolean;
}

/** The finish of every part of a catalogue piece, until parts name finishes (§5.7). */
export const PART_FINISH = 'part';

// --- transforms ---------------------------------------------------------------------------------

export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Scale, then a tilt about x, then a turn about y, then the move to `position`: three.js'
 * `YXZ` Euler order, which every mesh of the viewer uses.
 */
export function transform(
  position: Vec3,
  rotationY = 0,
  rotationX = 0,
  scale: Vec3 = [1, 1, 1],
): Matrix {
  const a = Math.cos(rotationX);
  const b = Math.sin(rotationX);
  const c = Math.cos(rotationY);
  const d = Math.sin(rotationY);
  const [sx, sy, sz] = scale;
  return [
    c * sx,
    0,
    -d * sx,
    0,
    d * b * sy,
    a * sy,
    c * b * sy,
    0,
    a * d * sz,
    -b * sz,
    a * c * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

/** `a · b`: `b` first, then `a`. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

// --- colours ------------------------------------------------------------------------------------

const colors = {
  exterior: '#d8d2c4',
  interior: '#f1ece2',
  floorSlab: '#a6a29b',
  ceiling: '#f4f2ec',
  roof: '#7d5f50',
  terrain: '#7c6a4f',
  garden: '#5e9b4c',
  driveway: '#8e8c88',
  patio: '#b8a184',
  path: '#c2b59b',
  road: '#6f6f6f',
  gravel: '#a9a8a2',
  embankment: '#8d8778',
  stair: '#b9a98c',
  fencePost: '#3d4043',
  brickPillar: '#9a5b40',
  outbuilding: '#e4e0d6',
} as const;

/** Wall colours of outbuildings that are not rendered like the house. */
const outbuildingColors: Partial<Record<HomeScene['outbuildings'][number]['kind'], string>> = {
  shed: '#9a7b56',
  compost: '#3c4038',
};

/** Fences other than gates (a gate is drawn from its piece). */
const fenceColors = {
  'chain-link': '#4a4e52',
  privacy: '#2c2e30',
  trellis: '#7a5a3a',
} as const;

/** Room floors are told apart by colour, in the order of the home's rooms. */
const roomColors = ['#e9d8b4', '#d7e3c8', '#cfdbe6', '#ead0cc', '#ddd3e8', '#e6e0c4'];

const srgbToLinear = (c: number) =>
  c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
const linearToSrgb = (c: number) =>
  c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;

/** A `#rrggbb` colour as linear RGB in 0..1: what a vertex colour holds. */
export function linearRgb(color: string): Vec3 {
  const n = Number.parseInt(color.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 0xff) / 255),
    srgbToLinear(((n >> 8) & 0xff) / 255),
    srgbToLinear((n & 0xff) / 255),
  ];
}

/** Contour lines are a darker shade of the surface they lie on (scaled in linear light). */
export function contourColor(color: string): string {
  const channel = (c: number) =>
    Math.round(Math.max(0, Math.min(255, linearToSrgb(c * 0.6) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${linearRgb(color).map(channel).join('')}`;
}

// --- the shell and outdoors ---------------------------------------------------------------------

interface Common {
  id: string;
  group: DrawGroup;
  piece?: string;
}

const solid = (
  common: Common,
  shape: DrawShape,
  matrix: Matrix,
  color: string,
  rest: Partial<DrawItem> = {},
): DrawItem => ({
  ...common,
  shape,
  matrix,
  finish: color,
  tint: color,
  castShadow: true,
  receiveShadow: true,
  closed: true,
  ...rest,
});

const boxItem = (common: Common, box: Box, color: string, rest?: Partial<DrawItem>) =>
  solid(common, { kind: 'box', size: box.size }, transform(box.center, box.rotationY), color, rest);

const profileItem = (
  common: Common,
  s: { center: Vec3; rotationY: number; depth: number; outline: Vec2[] },
  color: string,
) =>
  solid(
    common,
    { kind: 'profile', outline: s.outline, depth: s.depth },
    transform(s.center, s.rotationY),
    color,
  );

const prismItem = (common: Common, p: Prism, color: string) =>
  solid(
    common,
    {
      kind: 'prism',
      outline: p.outline,
      holes: p.holes,
      bottom: p.bottom,
      top: p.top,
      ...(p.slope && { slope: p.slope }),
    },
    transform([0, p.top, 0], 0, Math.PI / 2),
    color,
  );

/** `finish` differs from `color` for a tinted use of a finish (a contour on its area). */
const surfaceItem = (common: Common, s: Surface, color: string, finish = color): DrawItem => ({
  ...common,
  shape: {
    kind: 'surface',
    outline: s.outline,
    holes: s.holes ?? [],
    y: s.y,
    ...(s.slope && { slope: s.slope }),
  },
  matrix: transform([0, s.y, 0], 0, -Math.PI / 2),
  finish,
  tint: color,
  material: { doubleSided: true },
  castShadow: false,
  receiveShadow: true,
  closed: false,
});

const levelGroup = (item: { levelId: string; apartmentId?: string }): DrawGroup => ({
  kind: 'level',
  levelId: item.levelId,
  ...(item.apartmentId !== undefined && { apartmentId: item.apartmentId }),
});

/**
 * The parts of a piece as draw items in the piece's local frame (`matrix` = `IDENTITY`) or in
 * the world. The order is the parts' order: it is the draw order of transparent glass.
 */
export function partItems(
  parts: readonly Part[],
  piece: string,
  group: DrawGroup,
  matrix: Matrix = IDENTITY,
): DrawItem[] {
  return parts.map((part, i): DrawItem => {
    const { castShadow = true, receiveShadow = true, ...material } = part.material ?? {};
    // Only what the part sets: anything else stays at three.js' default.
    const settings = Object.fromEntries(
      Object.entries(material).filter(([, value]) => value !== undefined),
    ) as DrawMaterial;
    const [sx, sy, sz] = part.size;
    const local =
      part.shape === 'box'
        ? transform(part.center, part.rotationY, part.rotationX ?? 0)
        : transform(part.center, part.rotationY, part.rotationX ?? 0, [1, 1, sz / sx]);
    return {
      id: `${piece}/${i}`,
      group,
      piece,
      shape:
        part.shape === 'box'
          ? { kind: 'box', size: part.size }
          : { kind: 'cylinder', diameter: sx, height: sy },
      matrix: matrix === IDENTITY ? local : multiply(matrix, local),
      finish: PART_FINISH,
      tint: part.color,
      ...(Object.keys(settings).length > 0 && { material: settings }),
      castShadow,
      receiveShadow,
      closed: true,
    };
  });
}

/** A piece of the home model the viewer draws and picks: its parts stay its own meshes. */
export interface PieceDraw {
  id: string;
  group: DrawGroup;
  /** The piece's frame in the world: tilted about x by `rotationX`, then turned about y. */
  position: Vec3;
  rotationY: number;
  rotationX: number;
  parts: Part[];
}

const pieceMatrix = (p: Pick<PieceDraw, 'position' | 'rotationY' | 'rotationX'>) =>
  transform(p.position, p.rotationY, p.rotationX);

/** The windows, doors, roof windows and gates of the scene, in draw order. */
export function scenePieceDraws(scene: HomeScene): PieceDraw[] {
  const structure = (id: string): DrawGroup => ({ kind: 'structure', id });
  return [
    ...scene.roofWindows.map((w) => ({
      id: w.id,
      group: { kind: 'roof', levelId: w.levelId } as DrawGroup,
      position: w.center,
      rotationY: w.rotationY,
      rotationX: w.tilt,
      parts: w.parts,
    })),
    ...scene.openings.map((o) => ({
      id: o.id,
      group: levelGroup(o),
      position: o.center,
      rotationY: o.rotationY,
      rotationX: 0,
      parts: o.parts,
    })),
    // A gate's parts are in the world already.
    ...scene.fences.flatMap((f) =>
      f.parts
        ? [
            {
              id: f.id,
              group: structure(f.id),
              position: [0, 0, 0] as Vec3,
              rotationY: 0,
              rotationX: 0,
              parts: f.parts,
            },
          ]
        : [],
    ),
    ...scene.outbuildings.flatMap((b) =>
      b.openings.map((o) => ({
        id: o.id,
        group: structure(b.id),
        position: o.center,
        rotationY: o.rotationY,
        rotationX: 0,
        parts: o.parts,
      })),
    ),
  ];
}

/**
 * The shell and outdoors of the scene without its pieces: what `ShellMeshes` merges into
 * batches. Built from the whole scene; what is hidden is decided per group (`groupShown`).
 */
export function shellItems(scene: HomeScene): DrawItem[] {
  const terrain: DrawGroup = { kind: 'terrain' };
  return [
    ...scene.terrain.map((t) => prismItem({ id: t.id, group: terrain }, t, colors.terrain)),
    ...scene.outdoorAreas.flatMap((a) => {
      const group: DrawGroup = { kind: 'area', id: a.id };
      const color = colors[a.kind];
      return [
        surfaceItem({ id: a.id, group }, a, color),
        ...a.contours.map((c, i) =>
          surfaceItem({ id: `${a.id}/contour-${i}`, group }, c, contourColor(color), color),
        ),
      ];
    }),
    ...scene.slabs.map((s) =>
      prismItem(
        { id: s.id, group: { kind: 'slab', levelId: s.levelId, roof: s.kind === 'roof' } },
        s,
        s.kind === 'roof' ? colors.roof : colors.floorSlab,
      ),
    ),
    ...scene.ceilings.map((c) =>
      prismItem(
        {
          id: c.id,
          group: {
            kind: 'ceiling',
            levelId: c.levelId,
            ...(c.apartmentId !== undefined && { apartmentId: c.apartmentId }),
          },
        },
        c,
        colors.ceiling,
      ),
    ),
    ...scene.roomFloors.map((r, i) =>
      surfaceItem({ id: r.id, group: levelGroup(r) }, r, roomColors[i % roomColors.length]!),
    ),
    ...scene.walls.map((w) => {
      const common = { id: w.id, group: levelGroup(w) };
      return w.outline
        ? profileItem(common, { ...w, depth: w.size[2], outline: w.outline }, colors[w.kind])
        : boxItem(common, w, colors[w.kind]);
    }),
    ...scene.roofPlanes.map((r) =>
      profileItem({ id: r.id, group: { kind: 'roof', levelId: r.levelId } }, r, colors.roof),
    ),
    ...scene.stairs.flatMap((s) =>
      s.steps.map((step) => boxItem({ id: step.id, group: levelGroup(s) }, step, colors.stair)),
    ),
    ...scene.fences.flatMap((f) => {
      if (f.parts) return [];
      const group: DrawGroup = { kind: 'structure', id: f.id };
      const kind = f.kind as keyof typeof fenceColors;
      return [
        ...f.posts.map((post) =>
          boxItem(
            { id: post.id, group },
            post,
            f.kind === 'trellis' ? colors.brickPillar : colors.fencePost,
          ),
        ),
        ...f.panels.map((panel) =>
          boxItem(
            { id: panel.id, group },
            panel,
            fenceColors[kind],
            f.kind === 'chain-link'
              ? { material: { transparent: true, opacity: 0.35, depthWrite: false } }
              : {},
          ),
        ),
      ];
    }),
    ...scene.outbuildings.flatMap((b) => {
      const group: DrawGroup = { kind: 'structure', id: b.id };
      return [
        ...b.walls.map((w) =>
          boxItem({ id: w.id, group }, w, outbuildingColors[b.kind] ?? colors.outbuilding),
        ),
        prismItem({ id: b.roof.id, group }, b.roof, colors.floorSlab),
      ];
    }),
  ];
}

/** A placed piece of furniture, as the draw list needs it. */
export interface PlacementDraw {
  id: string;
  /** World position of the item's floor centre. */
  position: Vec3;
  rotationY: number;
  parts: readonly Part[];
}

/**
 * The draw list of a home with its placements: the shell and outdoors, then every piece's parts
 * in the world. Plain data: the goldens record it, and render mode draws from it (§9).
 */
export function drawList(scene: HomeScene, placements: readonly PlacementDraw[] = []): DrawItem[] {
  return [
    ...shellItems(scene),
    ...scenePieceDraws(scene).flatMap((p) => partItems(p.parts, p.id, p.group, pieceMatrix(p))),
    ...placements.flatMap((p) =>
      partItems(p.parts, p.id, { kind: 'placement', id: p.id }, transform(p.position, p.rotationY)),
    ),
  ];
}

// --- visibility and batching keys ---------------------------------------------------------------

export const groupKey = (g: DrawGroup): string => {
  switch (g.kind) {
    case 'level':
    case 'ceiling':
      return `${g.kind}:${g.levelId}:${g.apartmentId ?? ''}`;
    case 'slab':
      return `slab:${g.levelId}:${g.roof ? 'roof' : 'floor'}`;
    case 'roof':
      return `roof:${g.levelId}`;
    case 'terrain':
      return 'terrain';
    default:
      return `${g.kind}:${g.id}`;
  }
};

/**
 * Whether the items of `group` are drawn for a visibility: the rules of `visibleScene`, per
 * group instead of per descriptor.
 */
export function groupShown(
  group: DrawGroup,
  scene: Pick<HomeScene, 'levels'>,
  v: Visibility,
): boolean {
  const levelShown = (levelId: string) => {
    const level = scene.levels.find((l) => l.id === levelId);
    return !!level && level.index <= v.maxLevelIndex && !v.hiddenLevels.includes(level.id);
  };
  const apartmentShown = (apartmentId: string | undefined) =>
    apartmentId === undefined || !v.hiddenApartments.includes(apartmentId);
  const showRoof = v.maxLevelIndex >= roofIndex(scene);
  switch (group.kind) {
    case 'level':
      return levelShown(group.levelId) && apartmentShown(group.apartmentId);
    case 'slab':
      return levelShown(group.levelId) && (!group.roof || showRoof);
    case 'ceiling': {
      const index = scene.levels.find((l) => l.id === group.levelId)?.index;
      const above = scene.levels.find((l) => l.index === (index ?? Infinity) + 1);
      return (
        levelShown(group.levelId) &&
        apartmentShown(group.apartmentId) &&
        (above ? levelShown(above.id) : showRoof)
      );
    }
    case 'roof':
      return showRoof && levelShown(group.levelId);
    case 'terrain':
      return v.showTerrain;
    case 'area':
      return !v.hiddenOutdoorAreas.includes(group.id);
    default:
      return true;
  }
}

/** The material settings two items must share to be one mesh; the opacity is per vertex. */
export const materialKey = (m: DrawMaterial | undefined): string =>
  [
    m?.transparent ? 't' : 'o',
    m?.depthWrite === false ? 'n' : 'w',
    m?.doubleSided ? '2' : '1',
    m?.metalness ?? '',
    m?.roughness ?? '',
  ].join('/');

/**
 * Items with the same batch key are merged into one mesh: the piece or else the group, the
 * finish, the material settings and the shadow flags (§4.2).
 */
export const batchKey = (item: DrawItem): string =>
  [
    item.piece !== undefined ? `piece:${item.piece}` : groupKey(item.group),
    item.finish,
    materialKey(item.material),
    item.castShadow ? 'c' : '-',
    item.receiveShadow ? 'r' : '-',
  ].join('|');
