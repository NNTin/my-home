import type { ParamValues } from '@my-home/shared';
import type { Vec3 } from '../../builder/buildHome';
import { box, colorParam, numberParam, shade } from '../parts';
import type { Part, PieceContext } from '../types';
import { fittingCount, framedDimensions } from './frame';

/**
 * The standard German uPVC window (`window.casement`, `window.tilt-turn`), in the opening's local
 * frame (centre of the hole at the origin, width along x, height along y, the wall's depth along z;
 * `ctx.outside` says which way z points to the outdoors).
 *
 * Across the wall, from the outdoors in: the outside sill, the frame (Blendrahmen) set back from
 * the facade by `frameSetback`, the sashes (Flügel) a little proud of it on the room side, each
 * with its glass, handle and hinges, then the inside window board (Fensterbank) over the inner
 * reveal. Optional: a roller shutter (box on the facade, or a lid inside over the window with the
 * slats in the outer reveal) and a curtain on a rod in the room.
 */

/** The values a wall window is drawn with, read from its (effective) parameters. */
export function windowOptions(values: ParamValues) {
  return {
    frameColor: colorParam(values, 'frameColor'),
    handleSide: String(values.handleSide) === 'left' ? ('left' as const) : ('right' as const),
    boardColor: colorParam(values, 'boardColor'),
    shutter: String(values.shutter) as 'none' | 'outside' | 'inside',
    shutterClosed: clamp01(numberParam(values, 'shutterClosed')),
    shutterColor: colorParam(values, 'shutterColor'),
    curtain: String(values.curtain) as 'none' | 'both' | 'left' | 'right',
    curtainClosed: clamp01(numberParam(values, 'curtainClosed')),
    curtainColor: colorParam(values, 'curtainColor'),
    frameWidth: numberParam(values, 'frameWidth'),
    frameDepth: numberParam(values, 'frameDepth'),
    sashWidth: numberParam(values, 'sashWidth'),
    sashDepth: numberParam(values, 'sashDepth'),
    frameSetback: numberParam(values, 'frameSetback'),
    glassDepth: numberParam(values, 'glassDepth'),
    glassColor: colorParam(values, 'glassColor'),
    glassOpacity: numberParam(values, 'glassOpacity'),
    handleColor: colorParam(values, 'handleColor'),
    boardThickness: numberParam(values, 'boardThickness'),
    boardOverhang: numberParam(values, 'boardOverhang'),
    sillColor: colorParam(values, 'sillColor'),
    sillOverhang: numberParam(values, 'sillOverhang'),
    shutterBoxHeight: numberParam(values, 'shutterBoxHeight'),
    shutterBoxDepth: numberParam(values, 'shutterBoxDepth'),
    curtainRodColor: colorParam(values, 'curtainRodColor'),
    curtainRodHeight: numberParam(values, 'curtainRodHeight'),
    curtainRodReach: numberParam(values, 'curtainRodReach'),
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Where the frame, the sashes and the reveals sit across the wall; `t` grows towards the outdoors. */
export function windowLayout(ctx: PieceContext, values: ParamValues) {
  const o = windowOptions(values);
  const { width: w, height: h, wallDepth: d } = ctx;
  const f = Math.min(o.frameWidth, w / 4, h / 4);
  const frameDepth = Math.min(o.frameDepth, d);
  const setback = Math.min(Math.max(o.frameSetback, 0), Math.max(0, d - frameDepth));
  const frameOuter = d / 2 - setback;
  const frameInner = frameOuter - frameDepth;
  // The sash stands a centimetre inside the frame's outer face and sticks out into the room.
  const sashOuter = frameOuter - Math.min(0.01, frameDepth / 4);
  const sashInner = Math.max(-d / 2, sashOuter - o.sashDepth);
  return { o, w, h, d, f, frameDepth, setback, frameOuter, frameInner, sashOuter, sashInner };
}

export function windowParts(typeId: string, values: ParamValues, ctx: PieceContext): Part[] {
  const L = windowLayout(ctx, values);
  const { o, w, h, d, f } = L;
  const s = ctx.outside ?? 1;
  /** A box whose depth runs from t1 to t2 across the wall (any order). */
  const at = (x: number, y: number, t1: number, t2: number, size: [number, number]) => ({
    center: [x, y, (s * (t1 + t2)) / 2] as Vec3,
    size: [size[0], size[1], Math.abs(t2 - t1)] as Vec3,
  });
  const part = (
    x: number,
    y: number,
    t1: number,
    t2: number,
    size: [number, number],
    color: string,
    role: Part['role'],
    material?: Part['material'],
  ) => {
    const { center, size: full } = at(x, y, t1, t2, size);
    return box(center, full, color, role, material);
  };
  // "Right" as seen from the room, looking towards the outdoors: -x when the outdoors is +z.
  const rightX = -s;

  const parts: Part[] = [];
  const frame = o.frameColor;
  const [fo, fi] = [L.frameOuter, L.frameInner];
  // Frame (Blendrahmen): jambs, head, bottom member.
  parts.push(part(-w / 2 + f / 2, 0, fo, fi, [f, h], frame, 'frame'));
  parts.push(part(w / 2 - f / 2, 0, fo, fi, [f, h], frame, 'frame'));
  parts.push(part(0, h / 2 - f / 2, fo, fi, [w - 2 * f, f], frame, 'frame'));
  parts.push(part(0, -h / 2 + f / 2, fo, fi, [w - 2 * f, f], frame, 'frame'));

  // Fixed mullions between the sashes, then each sash in its gap.
  const n = fittingCount(typeId, 'sashes', values, w);
  const innerH = h - 2 * f;
  const mullion = (i: number) => -w / 2 + f + ((w - 2 * f) * i) / n;
  for (let i = 1; i < n; i++) parts.push(part(mullion(i), 0, fo, fi, [f, innerH], frame, 'frame'));

  const [so, si] = [L.sashOuter, L.sashInner];
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? -w / 2 + f : mullion(i) + f / 2;
    const b = i === n - 1 ? w / 2 - f : mullion(i + 1) - f / 2;
    const bw = b - a;
    const cx = (a + b) / 2;
    const sw = Math.min(o.sashWidth, bw / 4, innerH / 4);
    parts.push(part(a + sw / 2, 0, so, si, [sw, innerH], frame, 'sash'));
    parts.push(part(b - sw / 2, 0, so, si, [sw, innerH], frame, 'sash'));
    parts.push(part(cx, innerH / 2 - sw / 2, so, si, [bw - 2 * sw, sw], frame, 'sash'));
    parts.push(part(cx, -innerH / 2 + sw / 2, so, si, [bw - 2 * sw, sw], frame, 'sash'));
    const gm = (so + si) / 2;
    const gd = Math.min(o.glassDepth, so - si);
    parts.push(
      part(cx, 0, gm - gd / 2, gm + gd / 2, [bw - 2 * sw, innerH - 2 * sw], o.glassColor, 'glass', {
        transparent: true,
        opacity: o.glassOpacity,
        depthWrite: false,
      }),
    );

    // The handle on the opening side: towards the window's middle when there are several sashes,
    // else on the side the use asks for. The hinges on the other side, top and bottom.
    const towardsMiddle =
      Math.abs(cx) > 1e-6 && n > 1 ? -Math.sign(cx) : o.handleSide === 'right' ? rightX : -rightX;
    const handleX = towardsMiddle > 0 ? b - sw / 2 : a + sw / 2;
    const hingeX = towardsMiddle > 0 ? a + sw / 4 : b - sw / 4;
    const face = si;
    parts.push(
      part(handleX, 0, face, face - 0.012, [Math.min(0.032, sw), 0.075], o.handleColor, 'handle'),
    );
    parts.push(
      part(
        handleX,
        -0.045,
        face - 0.012,
        face - 0.034,
        [Math.min(0.022, sw), 0.12],
        o.handleColor,
        'handle',
      ),
    );
    for (const y of [innerH / 2 - 0.05, -innerH / 2 + 0.05]) {
      parts.push(part(hingeX, y, face, face - 0.016, [0.018, 0.06], shade(frame, -0.08), 'detail'));
    }
  }

  // Inside window board, from the frame over the inner reveal to just past the wall face. Its top
  // sits 2 cm above the hole's bottom (the wall below the hole ends there, no z-fighting).
  const boardOuter = fi;
  const boardInner = -d / 2 - o.boardOverhang;
  if (boardOuter > boardInner) {
    const top = -h / 2 + 0.02;
    parts.push(
      part(
        0,
        top - o.boardThickness / 2,
        boardOuter,
        boardInner,
        [w + 0.06, o.boardThickness],
        o.boardColor,
        'board',
      ),
    );
  }
  // Outside sill (aluminium), from the frame's outer face over the outer reveal and past the facade.
  parts.push(
    part(0, -h / 2 - 0.005, fo, d / 2 + o.sillOverhang, [w + 0.06, 0.02], o.sillColor, 'sill'),
  );

  if (o.shutter !== 'none') parts.push(...shutterParts(L, part));
  if (o.curtain !== 'none') parts.push(...curtainParts(L, s, ctx, part));
  return parts;
}

type PartFn = (
  x: number,
  y: number,
  t1: number,
  t2: number,
  size: [number, number],
  color: string,
  role: Part['role'],
  material?: Part['material'],
) => Part;

/** Roller shutter: the box, two guide rails and the slat curtain, closed by `shutterClosed`. */
function shutterParts(L: ReturnType<typeof windowLayout>, part: PartFn): Part[] {
  const { o, w, h, d } = L;
  const parts: Part[] = [];
  const casing = shade(o.shutterColor, -0.08);
  const bh = o.shutterBoxHeight;
  const inReveal = o.shutter === 'inside' && L.setback >= 0.05;
  if (o.shutter === 'outside') {
    // Box on the facade over the hole (Vorbaurollladen).
    parts.push(
      part(0, h / 2 + bh / 2, d / 2, d / 2 + o.shutterBoxDepth, [w + 0.06, bh], casing, 'shutter'),
    );
  } else {
    // Box built in over the window, its lid flush on the room side.
    parts.push(
      part(0, h / 2 + bh / 2, -d / 2, -d / 2 - 0.03, [w + 0.1, bh], o.frameColor, 'shutter'),
    );
  }
  // Rails: in the outer reveal in front of the frame, or on the facade beside the hole.
  const [r1, r2] = inReveal ? [L.frameOuter + 0.005, L.frameOuter + 0.05] : [d / 2, d / 2 + 0.05];
  const railX = inReveal ? w / 2 - 0.015 : w / 2 + 0.015;
  parts.push(part(-railX, 0, r1, r2, [0.03, h], casing, 'shutter'));
  parts.push(part(railX, 0, r1, r2, [0.03, h], casing, 'shutter'));
  const drop = o.shutterClosed * h;
  if (drop > 1e-3) {
    const mid = (r1 + r2) / 2;
    parts.push(
      part(
        0,
        h / 2 - drop / 2,
        mid - 0.007,
        mid + 0.007,
        [2 * railX - 0.01, drop],
        o.shutterColor,
        'shutter',
      ),
    );
  }
  return parts;
}

/** Curtain: a rod over the window in the room, and one or two panels from it to the floor. */
function curtainParts(
  L: ReturnType<typeof windowLayout>,
  s: number,
  ctx: PieceContext,
  part: PartFn,
): Part[] {
  const { o, w, h, d } = L;
  const span = w + 2 * o.curtainRodReach;
  const rodY = h / 2 + o.curtainRodHeight;
  const rodT = -d / 2 - 0.09;
  const parts = [
    part(0, rodY, rodT - 0.011, rodT + 0.011, [span, 0.022], o.curtainRodColor, 'curtain'),
  ];
  const top = rodY - 0.01;
  // Down to the floor where it is known, else just below the window board.
  const bottom = ctx.sill !== undefined && ctx.sill > 0 ? -h / 2 - ctx.sill + 0.015 : -h / 2 - 0.15;
  const bunched = Math.min(0.32, span / 4);
  const panel = (fromEnd: 1 | -1, full: number) => {
    const width = bunched + (full - bunched) * o.curtainClosed;
    const x = fromEnd * (span / 2 - width / 2);
    return part(
      x,
      (top + bottom) / 2,
      rodT - 0.035,
      rodT + 0.005,
      [width, top - bottom],
      o.curtainColor,
      'curtain',
    );
  };
  // "Left" as seen from the room is +x when the outdoors is +z (see `rightX`).
  const leftEnd = (s > 0 ? 1 : -1) as 1 | -1;
  if (o.curtain === 'both') parts.push(panel(1, span / 2), panel(-1, span / 2));
  else parts.push(panel(o.curtain === 'left' ? leftEnd : (-leftEnd as 1 | -1), span));
  return parts;
}

export const windowDimensions = (typeId: string, values: ParamValues, ctx: PieceContext) =>
  framedDimensions(values, ctx, {
    count: fittingCount(typeId, 'sashes', values, ctx.width),
    each: 'Sash',
  });
