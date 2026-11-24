import { CUT_FINISH, resolveFinish, TERRAIN_FINISH, type ResolvedFinish } from '@my-home/shared';
import type { Part } from '../catalog/types';
import type {
  Box,
  HomeScene,
  PlaneSlope,
  Prism,
  Surface,
  UvFrame,
  Vec2,
  Vec3,
  WallFace,
} from './buildHome';
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
  /** Centred, [x, y, z] extents, its edges and corners rounded by `radius` (§8.2). */
  | { kind: 'roundedBox'; size: Vec3; radius: number }
  /**
   * A profile of [radius, y] points turned about local y, drawn with `CYLINDER_SEGMENTS` sides
   * (§8.2). The profile runs from the bottom up along the outside.
   */
  | { kind: 'lathe'; profile: Vec2[] }
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
  | { kind: 'surface'; outline: Vec2[]; holes: Vec2[][]; y: number; slope?: PlaneSlope }
  /**
   * A flat polygon anywhere in the local frame, drawn from the side it is anticlockwise from: a
   * face of a wall (§8.1). Not a closed solid.
   */
  | { kind: 'polygon'; outline: Vec3[]; holes: Vec3[][] };

/** Cylinders and lathed shapes are drawn with this many sides. */
export const CYLINDER_SEGMENTS = 24;
/** A rounded box's quarter-round edge is drawn in twice this many steps: 300 triangles a box. */
export const ROUNDED_SEGMENTS = 2;

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
  /** Wall faces, shell detail, room floors, stairs and wall openings of a level (and apartment). */
  | { kind: 'level'; levelId: string; apartmentId?: string }
  /** The slab under a level; `roof`: the flat roof slab, shown only with the roof. */
  | { kind: 'slab'; levelId: string; roof: boolean }
  /**
   * The tops of a level's walls, which are cut faces (§7.2): shown with the level while the
   * level above (or the roof) is hidden, and hidden under it.
   */
  | { kind: 'cut'; levelId: string; apartmentId?: string }
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
   * The finish: an id of the finish library (`packages/shared/src/finishes`), or `part` for the
   * parts of a catalogue piece, which draw with their own colour, roughness and metalness.
   */
  finish: string;
  /** The colour written into the vertices: differently tinted items share a batch. */
  tint: string;
  /**
   * How a texture is laid on the item (§5.4). Without one its texture coordinates are a box
   * projection: of the world for what lies on the plan (floors, ground, slabs), so neighbours
   * line up, and of the item's own frame for boxes, cylinders and profiles.
   */
  uv?: UvFrame;
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

/** Fences are not in the home model's finishes: plain paint in the colours they have always had. */
const paint = (tint: string): ResolvedFinish =>
  resolveFinish(undefined, { finish: 'paint.plain', tint });
const fenceFinishes = {
  post: paint('#3d4043'),
  brickPillar: paint('#9a5b40'),
  'chain-link': paint('#4a4e52'),
  privacy: paint('#2c2e30'),
  trellis: paint('#7a5a3a'),
} as const;

/**
 * "Plan colours": room floors told apart by colour, in the order of the home's rooms, as the
 * viewer drew them before finishes. A view option (`ShellOptions.planColours`).
 */
export const PLAN_COLORS = ['#e9d8b4', '#d7e3c8', '#cfdbe6', '#ead0cc', '#ddd3e8', '#e6e0c4'];
const planColor = (index: number): ResolvedFinish =>
  resolveFinish(undefined, {
    finish: 'floor.neutral',
    tint: PLAN_COLORS[index % PLAN_COLORS.length]!,
  });

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
  finish: ResolvedFinish,
  rest: Partial<DrawItem> = {},
): DrawItem => ({
  ...common,
  shape,
  matrix,
  finish: finish.finish,
  tint: finish.tint,
  castShadow: true,
  receiveShadow: true,
  closed: true,
  ...rest,
});

const boxItem = (common: Common, box: Box, finish: ResolvedFinish, rest?: Partial<DrawItem>) =>
  solid(
    common,
    { kind: 'box', size: box.size },
    transform(box.center, box.rotationY),
    finish,
    rest,
  );

const profileItem = (
  common: Common,
  s: { center: Vec3; rotationY: number; depth: number; outline: Vec2[] },
  finish: ResolvedFinish,
  rest?: Partial<DrawItem>,
) =>
  solid(
    common,
    { kind: 'profile', outline: s.outline, depth: s.depth },
    transform(s.center, s.rotationY),
    finish,
    rest,
  );

/**
 * A face of a wall: a flat polygon with the finish of the room it borders (§8.1). The faces of a
 * wall together are its closed surface; each alone is not a solid.
 */
const wallFaceItem = (f: WallFace): DrawItem =>
  solid(
    { id: f.id, group: levelGroup(f, f.part === 'top' ? 'cut' : 'level') },
    { kind: 'polygon', outline: f.outline, holes: f.holes },
    transform(f.center, f.rotationY),
    f.finish,
    { uv: f.uv, closed: false },
  );

/**
 * The walls as closed solids: what a section counts to cap them (§7.2). They are not drawn; a
 * wall is drawn as its faces, which have no inside.
 */
export const wallSolidItems = (scene: Pick<HomeScene, 'walls'>): DrawItem[] =>
  scene.walls.map((w) => {
    const common = { id: w.id, group: levelGroup(w) };
    return w.outline
      ? profileItem(common, { ...w, depth: w.size[2], outline: w.outline }, CUT_FINISH)
      : boxItem(common, w, CUT_FINISH);
  });

const prismItem = (common: Common, p: Prism, finish: ResolvedFinish) =>
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
    finish,
  );

/** A floor finish turned by a quarter: its texture runs along plan z instead of plan x. */
const QUARTER_TURN: UvFrame = { origin: [0, 0, 0], u: [0, 0, 1], v: [-1, 0, 0] };

/** `tint` differs from the finish's for a tinted use of it (a contour on its area). */
const surfaceItem = (
  common: Common,
  s: Surface,
  finish: ResolvedFinish,
  tint = finish.tint,
): DrawItem => ({
  ...common,
  shape: {
    kind: 'surface',
    outline: s.outline,
    holes: s.holes ?? [],
    y: s.y,
    ...(s.slope && { slope: s.slope }),
  },
  matrix: transform([0, s.y, 0], 0, -Math.PI / 2),
  finish: finish.finish,
  tint,
  ...(finish.rotation === 90 && { uv: QUARTER_TURN }),
  material: { doubleSided: true },
  castShadow: false,
  receiveShadow: true,
  closed: false,
});

const levelGroup = (
  item: { levelId: string; apartmentId?: string },
  kind: 'level' | 'cut' = 'level',
): DrawGroup => ({
  kind,
  levelId: item.levelId,
  ...(item.apartmentId !== undefined && { apartmentId: item.apartmentId }),
});

/**
 * Whether a lathe's profile bounds a solid: it starts and ends on the axis, or ends where it
 * starts (a ring). Any other profile is an open skin: a bowl, a lamp shade.
 */
const latheClosed = (profile: readonly Vec2[]) => {
  const [first, last] = [profile[0], profile.at(-1)];
  if (!first || !last) return false;
  return (first[0] === 0 && last[0] === 0) || (first[0] === last[0] && first[1] === last[1]);
};

/**
 * The solid a part is drawn as, in the part's own frame (`partTransform` puts it into the
 * piece's), and whether it is closed: an open lathe is a skin, drawn from both sides.
 */
export function partShape(part: Part): { shape: DrawShape; closed: boolean } {
  const [sx, sy, sz] = part.size;
  switch (part.shape) {
    case 'box':
      return { shape: { kind: 'box', size: part.size }, closed: true };
    case 'cylinder':
      return { shape: { kind: 'cylinder', diameter: sx, height: sy }, closed: true };
    case 'roundedBox':
      return {
        shape: { kind: 'roundedBox', size: part.size, radius: part.radius },
        closed: true,
      };
    case 'extrude':
      return { shape: { kind: 'profile', outline: part.profile, depth: sz }, closed: true };
    case 'lathe':
      return {
        shape: { kind: 'lathe', profile: part.profile },
        closed: latheClosed(part.profile),
      };
  }
}

/** A part's own frame in its piece's; an elliptic cylinder is a round one scaled along z. */
export const partTransform = (part: Part): Matrix =>
  transform(
    part.center,
    part.rotationY,
    part.rotationX ?? 0,
    part.shape === 'cylinder' ? [1, 1, part.size[2] / part.size[0]] : [1, 1, 1],
  );

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
    const { shape, closed } = partShape(part);
    // Only what the part sets: anything else stays at three.js' default.
    const settings = Object.fromEntries(
      Object.entries({ ...material, ...(!closed && { doubleSided: true }) }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as DrawMaterial;
    const local = partTransform(part);
    return {
      id: `${piece}/${i}`,
      group,
      piece,
      shape,
      matrix: matrix === IDENTITY ? local : multiply(matrix, local),
      finish: PART_FINISH,
      tint: part.color,
      ...(Object.keys(settings).length > 0 && { material: settings }),
      castShadow,
      receiveShadow,
      closed,
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

/** What the viewer may draw differently for the same home. */
export interface ShellOptions {
  /** "Plan colours": room floors in the pastel colours that tell rooms apart, not their finishes. */
  planColours?: boolean;
}

/**
 * The shell and outdoors of the scene without its pieces: what `ShellMeshes` merges into
 * batches. Built from the whole scene; what is hidden is decided per group (`groupShown`).
 * Every item names a finish of the library: the home's own, or the default of its surface.
 */
export function shellItems(scene: HomeScene, options: ShellOptions = {}): DrawItem[] {
  const terrain: DrawGroup = { kind: 'terrain' };
  const ceilingGroup = (c: { levelId: string; apartmentId?: string }): DrawGroup => ({
    kind: 'ceiling',
    levelId: c.levelId,
    ...(c.apartmentId !== undefined && { apartmentId: c.apartmentId }),
  });
  return [
    ...scene.terrain.map((t) => prismItem({ id: t.id, group: terrain }, t, TERRAIN_FINISH)),
    ...scene.outdoorAreas.flatMap((a) => {
      const group: DrawGroup = { kind: 'area', id: a.id };
      return [
        surfaceItem({ id: a.id, group }, a, a.finish),
        ...a.contours.map((c, i) =>
          surfaceItem(
            { id: `${a.id}/contour-${i}`, group },
            c,
            a.finish,
            contourColor(a.finish.tint),
          ),
        ),
      ];
    }),
    ...scene.slabs.map((s) =>
      prismItem(
        { id: s.id, group: { kind: 'slab', levelId: s.levelId, roof: s.kind === 'roof' } },
        s,
        s.finish,
      ),
    ),
    ...scene.ceilings.map((c) => prismItem({ id: c.id, group: ceilingGroup(c) }, c, c.finish)),
    ...scene.roomCeilings.map((c) =>
      surfaceItem({ id: c.id, group: ceilingGroup(c) }, c, c.finish),
    ),
    ...scene.roomFloors.map((r, i) =>
      surfaceItem(
        { id: r.id, group: levelGroup(r) },
        r,
        options.planColours ? planColor(i) : r.finish,
      ),
    ),
    ...scene.wallFaces.map(wallFaceItem),
    ...scene.skirting.map((b) => boxItem({ id: b.id, group: levelGroup(b) }, b, b.finish)),
    ...scene.doorReveals.flatMap((d) =>
      d.parts.map((part) => boxItem({ id: part.id, group: levelGroup(d) }, part, part.finish)),
    ),
    ...scene.roofPlanes.map((r) =>
      profileItem({ id: r.id, group: { kind: 'roof', levelId: r.levelId } }, r, r.finish, {
        uv: r.uv,
      }),
    ),
    ...scene.roofTrim.map((r) =>
      profileItem({ id: r.id, group: { kind: 'roof', levelId: r.levelId } }, r, r.finish),
    ),
    ...scene.stairs.flatMap((s) =>
      s.steps.map((step) => boxItem({ id: step.id, group: levelGroup(s) }, step, s.finish)),
    ),
    ...scene.fences.flatMap((f) => {
      if (f.parts) return [];
      const group: DrawGroup = { kind: 'structure', id: f.id };
      const kind = f.kind as Exclude<typeof f.kind, 'gate'>;
      return [
        ...f.posts.map((post) =>
          boxItem(
            { id: post.id, group },
            post,
            f.kind === 'trellis' ? fenceFinishes.brickPillar : fenceFinishes.post,
          ),
        ),
        ...f.panels.map((panel) =>
          boxItem(
            { id: panel.id, group },
            panel,
            fenceFinishes[kind],
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
        ...b.walls.map((w) => boxItem({ id: w.id, group }, w, b.finishes.walls)),
        prismItem({ id: b.roof.id, group }, b.roof, b.finishes.roof),
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
export function drawList(
  scene: HomeScene,
  placements: readonly PlacementDraw[] = [],
  options: ShellOptions = {},
): DrawItem[] {
  return [
    ...shellItems(scene, options),
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
    case 'cut':
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
    case 'cut':
    case 'ceiling': {
      const index = scene.levels.find((l) => l.id === group.levelId)?.index;
      const above = scene.levels.find((l) => l.index === (index ?? Infinity) + 1);
      const covered = above ? levelShown(above.id) : showRoof;
      return (
        levelShown(group.levelId) &&
        apartmentShown(group.apartmentId) &&
        covered === (group.kind === 'ceiling')
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
