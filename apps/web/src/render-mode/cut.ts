import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import type { Vec3 } from '../geom/types';
import type { CutPlane } from '../views/traceInputs';

/**
 * The cut of a section in render mode (docs/design/realistic-render.md §9): a real cut of the
 * geometry, not a clipping plane. The viewer hides what is in front of the plane pixel by pixel
 * and still lets it throw its shadow; a path tracer needs the front of the house gone, so that
 * daylight falls into the cut rooms. What is drawn is clipped triangle by triangle, and a closed
 * solid that the plane goes through is closed again with a flat cap, as the viewer's stencil caps
 * close it on screen (§7.2).
 */

function distances(geometry: BufferGeometry, { normal: [nx, ny, nz], constant }: CutPlane) {
  const position = geometry.getAttribute('position');
  const d = new Float64Array(position.count);
  for (let i = 0; i < d.length; i++)
    d[i] = nx * position.getX(i) + ny * position.getY(i) + nz * position.getZ(i) + constant;
  return d;
}

function* triangles(geometry: BufferGeometry): Generator<[number, number, number]> {
  const index = geometry.index;
  const count = index ? index.count : geometry.getAttribute('position').count;
  for (let i = 0; i + 2 < count; i += 3) {
    yield index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
  }
}

/**
 * The part of a geometry that is kept by the plane, with every attribute carried along a cut
 * edge. Returns the geometry itself when the plane does not touch it, and undefined when nothing
 * of it is kept.
 */
export function clipGeometry(
  geometry: BufferGeometry,
  plane: CutPlane,
): BufferGeometry | undefined {
  const d = distances(geometry, plane);
  let kept = 0;
  for (const value of d) if (value >= 0) kept += 1;
  if (kept === d.length) return geometry;
  if (kept === 0) return undefined;

  const names = Object.keys(geometry.attributes);
  const sources = names.map((name) => geometry.getAttribute(name));
  const out: number[][] = names.map(() => []);
  let vertices = 0;
  const copied = new Int32Array(d.length).fill(-1);
  const copy = (i: number) => {
    if (copied[i]! >= 0) return copied[i]!;
    sources.forEach((source, n) => {
      for (let k = 0; k < source.itemSize; k++) out[n]!.push(source.getComponent(i, k));
    });
    return (copied[i] = vertices++);
  };
  // A cut edge is shared by two triangles: its new vertex is made once.
  const crossings = new Map<number, number>();
  const cross = (a: number, b: number) => {
    const key = a < b ? a * d.length + b : b * d.length + a;
    const found = crossings.get(key);
    if (found !== undefined) return found;
    const t = d[a]! / (d[a]! - d[b]!);
    sources.forEach((source, n) => {
      for (let k = 0; k < source.itemSize; k++) {
        const from = source.getComponent(a, k);
        out[n]!.push(from + (source.getComponent(b, k) - from) * t);
      }
    });
    crossings.set(key, vertices);
    return vertices++;
  };

  const index: number[] = [];
  for (const corners of triangles(geometry)) {
    const polygon: number[] = [];
    corners.forEach((a, e) => {
      const b = corners[(e + 1) % 3]!;
      if (d[a]! >= 0) polygon.push(copy(a));
      if (d[a]! >= 0 !== d[b]! >= 0) polygon.push(cross(a, b));
    });
    for (let k = 1; k + 1 < polygon.length; k++)
      index.push(polygon[0]!, polygon[k]!, polygon[k + 1]!);
  }
  if (index.length === 0) return undefined;

  const clipped = new BufferGeometry();
  names.forEach((name, n) => {
    clipped.setAttribute(
      name,
      new BufferAttribute(new Float32Array(out[n]!), sources[n]!.itemSize),
    );
  });
  clipped.setIndex(index);
  return clipped;
}

/** Points nearer than this are one point: a tenth of a millimetre. */
const WELD = 1e4;
const keyOf = ([x, y, z]: Vec3) =>
  `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;

/**
 * Where the surface of a closed solid meets the plane: closed loops of points, in the world.
 * Each triangle the plane goes through gives one edge, directed by the triangle's own facing, so
 * the outline of the solid runs one way round and the outline of a hollow in it the other.
 * An outline that does not close (the solid was not closed after all) is left out.
 */
export function sectionLoops(geometry: BufferGeometry, plane: CutPlane): Vec3[][] {
  const d = distances(geometry, plane);
  const position = geometry.getAttribute('position');
  const [nx, ny, nz] = plane.normal;
  const point = (i: number): Vec3 => [position.getX(i), position.getY(i), position.getZ(i)];
  const between = (a: number, b: number): Vec3 => {
    const t = d[a]! / (d[a]! - d[b]!);
    const [p, q] = [point(a), point(b)];
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  };

  /** Edges by the key of the point they start at. */
  const edges = new Map<string, { from: Vec3; to: Vec3; used: boolean }[]>();
  for (const corners of triangles(geometry)) {
    const ends: Vec3[] = [];
    corners.forEach((a, e) => {
      const b = corners[(e + 1) % 3]!;
      if (d[a]! >= 0 !== d[b]! >= 0) ends.push(between(a, b));
    });
    if (ends.length !== 2) continue;
    let [from, to] = ends as [Vec3, Vec3];
    if (keyOf(from) === keyOf(to)) continue;
    // The triangle's normal, and with it the way round: along `normal of triangle x plane normal`.
    const [a, b, c] = [point(corners[0]), point(corners[1]), point(corners[2])];
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const [tx, ty, tz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const [wx, wy, wz] = [ty * nz - tz * ny, tz * nx - tx * nz, tx * ny - ty * nx];
    const along = (to[0] - from[0]) * wx + (to[1] - from[1]) * wy + (to[2] - from[2]) * wz;
    if (along < 0) [from, to] = [to, from];
    const key = keyOf(from);
    const list = edges.get(key);
    const edge = { from, to, used: false };
    if (list) list.push(edge);
    else edges.set(key, [edge]);
  }

  const loops: Vec3[][] = [];
  for (const list of edges.values()) {
    for (const first of list) {
      if (first.used) continue;
      const loop: Vec3[] = [];
      const start = keyOf(first.from);
      let edge: typeof first | undefined = first;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push(edge.from);
        const next = keyOf(edge.to);
        if (next === start) {
          if (loop.length >= 3) loops.push(loop);
          break;
        }
        edge = edges.get(next)?.find((e) => !e.used);
      }
    }
  }
  return loops;
}

/** Two axes of the plane, with `u x v = normal`: across (horizontal for an upright plane) and up. */
function planeAxes([nx, ny, nz]: Vec3): { u: Vec3; v: Vec3 } {
  // Upright planes cut a section: across is level. A level plane takes x as its first axis.
  const level = Math.hypot(nx, nz);
  const u: Vec3 = level > 1e-6 ? [nz / level, 0, -nx / level] : [1, 0, 0];
  const v: Vec3 = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
  return { u, v };
}

const area = (points: readonly Vector2[]) => ShapeUtils.area(points as Vector2[]);

function inside(point: Vector2, outline: readonly Vector2[]): boolean {
  let within = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [a, b] = [outline[i]!, outline[j]!];
    if (a.y > point.y !== b.y > point.y) {
      if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
    }
  }
  return within;
}

/**
 * The cap of cut solids: the outlines of each solid on the plane (`sectionLoops`) filled in,
 * facing the side that was cut away, where the camera of a section stands. An outline that runs
 * the other way round is a hollow of the outline around it and stays open. Each solid is filled
 * for itself: solids that overlap, as walls do at every corner, give caps that overlap. The cap
 * lies `lift` metres in front of the plane, so that one cap can lie over another (a wall's over
 * the soil's, §7.2). Texture coordinates are metres on the plane; `color` is the vertex colour,
 * linear.
 */
export function capGeometry(
  solids: readonly (readonly (readonly Vec3[])[])[],
  plane: CutPlane,
  color: Vec3,
  lift = 0,
): BufferGeometry | undefined {
  const { u, v } = planeAxes(plane.normal);
  const [nx, ny, nz] = plane.normal;
  const flat = ([x, y, z]: Vec3) =>
    new Vector2(x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]);
  const filled = solids.flatMap((loops) => {
    const outlines = loops
      .map((points) => ({ points, flat: points.map(flat) }))
      .map((loop) => ({ ...loop, area: area(loop.flat) }))
      .filter((loop) => Math.abs(loop.area) > 1e-8);
    // Seen with `u` to the right and `v` up, a solid's own outline runs clockwise (`sectionLoops`).
    const outer = outlines
      .filter((loop) => loop.area < 0)
      .map((loop) => ({ ...loop, holes: [] as typeof outlines }));
    for (const hole of outlines.filter((loop) => loop.area > 0)) {
      const around = outer
        .filter((solid) => inside(hole.flat[0]!, solid.flat))
        .sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0];
      around?.holes.push(hole);
    }
    return outer;
  });

  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const solid of filled) {
    const base = position.length / 3;
    const points = [solid, ...solid.holes].flatMap((loop) => loop.points);
    const flats = [solid, ...solid.holes].flatMap((loop) => loop.flat);
    points.forEach(([x, y, z], i) => {
      position.push(x - nx * lift, y - ny * lift, z - nz * lift);
      uv.push(flats[i]!.x, flats[i]!.y);
    });
    const faces = ShapeUtils.triangulateShape(
      solid.flat,
      solid.holes.map((hole) => hole.flat),
    ) as [number, number, number][];
    for (const [a, b, c] of faces) {
      // Towards the camera: clockwise with `u` right and `v` up is anticlockwise from its side.
      const [pa, pb, pc] = [flats[a]!, flats[b]!, flats[c]!];
      const turn = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (turn < 0) index.push(base + a, base + b, base + c);
      else index.push(base + a, base + c, base + b);
    }
  }
  if (index.length === 0) return undefined;

  const count = position.length / 3;
  const normal = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    normal.set([-nx, -ny, -nz], i * 3);
    colors.set(color, i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(index);
  return geometry;
}
