import type { PhotoPose } from '@my-home/shared';
import type { Vec2 } from '../geom/types';
import { normalizeAngle } from '../geom/geometry';
import { EYE_HEIGHT, walk, type Footing, type WalkWorld } from './world';

/**
 * The virtual figure: where its feet are and where it looks. `yaw` and `pitch` follow the photo
 * pose conventions (docs/photos.md): yaw counter-clockwise from above with 0 looking along -z,
 * positive pitch looking up.
 */
export interface Figure extends Footing {
  yaw: number;
  pitch: number;
}

/** What the controls ask for, each from -1 to 1. */
export interface WalkInput {
  /** Forward (+) or back (-) along the view direction. */
  forward: number;
  /** Sideways to the right (+) or left (-). */
  strafe: number;
  /** Turning left (+, counter-clockwise from above) or right (-). */
  turn: number;
}

export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, turn: 0 };

/** Metres per second at full deflection, and radians per second of turning. */
export const WALK_SPEED = 1.5;
export const TURN_SPEED = 1.6;
/** Just short of straight up and down, so the view never flips. */
export const MAX_PITCH = 1.45;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The plan direction the figure faces, and the one to its right. */
export const facing = (yaw: number): Vec2 => [-Math.sin(yaw), -Math.cos(yaw)];
export const rightOf = (yaw: number): Vec2 => [Math.cos(yaw), -Math.sin(yaw)];

/** Turns the view by a drag or a nudge; `dPitch` positive looks up. */
export const look = (figure: Figure, dYaw: number, dPitch: number): Figure => ({
  ...figure,
  yaw: normalizeAngle(figure.yaw + dYaw),
  pitch: clamp(figure.pitch + dPitch, -MAX_PITCH, MAX_PITCH),
});

/** Moves the figure by `forward` and `right` metres relative to where it faces. */
export function stride(world: WalkWorld, figure: Figure, forward: number, right: number): Figure {
  const f = facing(figure.yaw);
  const r = rightOf(figure.yaw);
  const delta: Vec2 = [f[0] * forward + r[0] * right, f[1] * forward + r[1] * right];
  const footing = walk(world, figure, delta);
  if (footing === figure) return figure;
  return { ...footing, yaw: figure.yaw, pitch: figure.pitch };
}

/** One frame of walking: `dt` seconds of the given input. */
export function advance(world: WalkWorld, figure: Figure, input: WalkInput, dt: number): Figure {
  const turned =
    input.turn === 0 ? figure : look(figure, clamp(input.turn, -1, 1) * TURN_SPEED * dt, 0);
  // Diagonal input is no faster than straight.
  const scale = Math.max(1, Math.hypot(input.forward, input.strafe));
  const distance = WALK_SPEED * dt;
  if (input.forward === 0 && input.strafe === 0) return turned;
  return stride(
    world,
    turned,
    (input.forward / scale) * distance,
    (input.strafe / scale) * distance,
  );
}

/** The camera pose of a photo taken by the figure: at its eyes, looking where it looks. */
export const poseOf = (figure: Figure, fovH?: number): PhotoPose => ({
  position: { x: figure.x, y: figure.y + EYE_HEIGHT, z: figure.z },
  yaw: figure.yaw,
  pitch: figure.pitch,
  ...(fovH !== undefined && { fovH }),
});

/**
 * The yaw for a compass bearing (degrees clockwise from true north). `northBearing` is where true
 * north is on the plan: degrees clockwise from -z (`building.northBearing`).
 */
export const yawFromCompass = (bearing: number, northBearing: number) =>
  normalizeAngle((-(bearing + northBearing) * Math.PI) / 180);

/** Keyboard state to input: W/S or up/down walk, A/D sidestep, left/right or Q/E turn. */
export function inputFromKeys(keys: ReadonlySet<string>): WalkInput {
  const axis = (plus: string[], minus: string[]) =>
    (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);
  return {
    forward: axis(['w', 'arrowup'], ['s', 'arrowdown']),
    strafe: axis(['d'], ['a']),
    turn: axis(['q', 'arrowleft'], ['e', 'arrowright']),
  };
}

/**
 * The movement pad: up and down walk, left and right turn, so one thumb does both. While the
 * phone's compass turns the figure (`following`), left and right sidestep instead.
 */
export const inputFromPad = (x: number, y: number, following = false): WalkInput => ({
  forward: 0 - y,
  strafe: following ? x : 0,
  turn: following ? 0 : 0 - x,
});

export const combineInputs = (a: WalkInput, b: WalkInput): WalkInput => ({
  forward: clamp(a.forward + b.forward, -1, 1),
  strafe: clamp(a.strafe + b.strafe, -1, 1),
  turn: clamp(a.turn + b.turn, -1, 1),
});
