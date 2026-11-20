import { DirectionalLight, Group, PointLight, type Box3 } from 'three';
import { fitShadowCamera } from '../scene/sunShadow';
import type { Vec3 } from '../builder/buildHome';
import { assignPool, poolSize, shadowLamps, type Emitter } from './lamps';
import type { LightRig } from './rig';

/**
 * The lights of the viewer's scene (docs/design/realistic-render.md §6.2, §6.4): the studio sun,
 * the fixed lamp pool and the head lamp. All of them are created once and stay in the scene; a
 * frame only moves them and sets their colour, intensity and range. The number of lights, and of
 * lights that cast shadows, is therefore fixed per device, and neither a lamp reassignment nor a
 * change of view compiles a shader (§4.5).
 */

/** Size of the sun's shadow map; a quarter of the texels on a phone. */
const SUN_SHADOW_MAP = 2048;
const PHONE_SUN_SHADOW_MAP = 1024;
/** The filter radius of the sun's shadow, in texels of its map: a fast frame's, a beautiful one's. */
const SUN_SHADOW_RADIUS = 1;
const SUN_SHADOW_RADIUS_BEAUTIFUL = 3;
/** Size of one face of a lamp's shadow map. */
const LAMP_SHADOW_MAP = 512;
/** How far from the scene's origin the sun stands. The shadow camera is fitted to the casters. */
const SUN_DISTANCE = 39;
/** What surrounds a lamp closer than this casts no shadow: its own fixture. */
const LAMP_SHADOW_NEAR = 0.1;
/** The head lamp: a soft light without falloff, as walk mode has always carried. */
const HEAD_LAMP_INTENSITY = 0.9;

/** What a frame tells the lights. */
export interface LampFrame {
  /** The emitters of what is drawn. */
  emitters: readonly Emitter[];
  /** What the pool gathers around: the orbit target, or the eye in a view from inside. */
  focus: Vec3;
  /**
   * Set in a view from inside a room (walking in first person, "view from here"): where the eye
   * is and in which room. Only that room counts as seen.
   */
  eye?: { position: Vec3; roomId: string | undefined };
}

/** What the lights report of a frame. */
export interface LampState {
  /** Pool lights that are lit. */
  lit: number;
  /** Pool lights that changed their emitter with this frame. */
  reassigned: number;
  /** A lamp that casts a shadow was moved: its map is drawn again with this frame. */
  shadowsMoved: boolean;
}

export class SceneLights {
  /** Everything, to add to the scene once. */
  readonly group = new Group();
  readonly sun = new DirectionalLight();
  readonly lamps: PointLight[];
  /**
   * The fallback in a room without an emitter: one more fixed light, at the eye, at intensity 0
   * everywhere else.
   */
  readonly head = new PointLight('#ffffff', 0, 0, 0);
  private slots: (string | undefined)[];
  private lampIntensity = 0;
  /** What each shadow lamp's map was last drawn for. */
  private readonly drawnFor: string[];

  constructor(readonly phone: boolean) {
    const size = phone ? PHONE_SUN_SHADOW_MAP : SUN_SHADOW_MAP;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.normalBias = 0.03;
    // Static: drawn when the casters changed, not every frame (`sunShadow.ts`).
    this.sun.shadow.autoUpdate = false;
    this.group.add(this.sun, this.sun.target);

    const casting = shadowLamps(phone);
    this.lamps = Array.from({ length: poolSize(phone) }, (_, index) => {
      const lamp = new PointLight('#ffffff', 0, 1, 2);
      if (index < casting) {
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(LAMP_SHADOW_MAP, LAMP_SHADOW_MAP);
        lamp.shadow.camera.near = LAMP_SHADOW_NEAR;
        lamp.shadow.bias = -0.002;
        lamp.shadow.normalBias = 0.02;
        lamp.shadow.autoUpdate = false;
        // Drawn once even while unlit, so that the map exists.
        lamp.shadow.needsUpdate = true;
      }
      return lamp;
    });
    this.slots = this.lamps.map(() => undefined);
    this.drawnFor = this.lamps.map(() => '');
    this.group.add(...this.lamps, this.head);
  }

  /** The emitter each pool light is assigned to. */
  get assignment(): readonly (string | undefined)[] {
    return this.slots;
  }

  /** The lamps that cast shadows: the first ones of the pool. */
  get shadowCasters(): PointLight[] {
    return this.lamps.filter((lamp) => lamp.castShadow);
  }

  /** Applies a rig: the sun, and how bright lamps are. */
  setRig(rig: LightRig) {
    const [x, y, z] = rig.sun.direction;
    const scale = SUN_DISTANCE / (Math.hypot(x, y, z) || 1);
    this.sun.position.set(x * scale, y * scale, z * scale);
    this.sun.color.set(rig.sun.color);
    this.sun.intensity = rig.sun.intensity;
    this.lampIntensity = rig.lamps.on ? rig.lamps.intensity : 0;
  }

  /** Assigns the pool for a frame and moves its lights. The same for every tier. */
  update(frame: LampFrame): LampState {
    const { eye } = frame;
    const emitters = this.lampIntensity > 0 ? frame.emitters : [];
    const inSight = eye
      ? (e: Emitter) => e.roomId !== undefined && e.roomId === eye.roomId
      : () => true;
    const before = this.slots;
    this.slots = assignPool(before, emitters, frame.focus, inSight);
    const reassigned = this.slots.filter((id, index) => id !== before[index]).length;
    const byId = new Map(emitters.map((e) => [e.id, e]));
    let lit = 0;
    let shadowsMoved = false;
    this.lamps.forEach((lamp, index) => {
      const id = this.slots[index];
      const emitter = id === undefined ? undefined : byId.get(id);
      if (!emitter) {
        lamp.intensity = 0;
        // Its map is not kept up while it is unlit (`redrawLampShadows`): whatever it is
        // assigned to next, the same emitter included, draws the map again.
        this.drawnFor[index] = '';
        return;
      }
      lit += 1;
      lamp.position.set(...emitter.position);
      lamp.color.set(emitter.color);
      lamp.intensity = emitter.intensity * this.lampIntensity;
      lamp.distance = emitter.range;
      if (!lamp.castShadow) return;
      const key = `${emitter.position.join(',')}/${emitter.range}`;
      if (key === this.drawnFor[index]) return;
      this.drawnFor[index] = key;
      lamp.shadow.camera.far = emitter.range;
      lamp.shadow.camera.updateProjectionMatrix();
      lamp.shadow.needsUpdate = true;
      shadowsMoved = true;
    });

    // The head lamp: only at the eye, and only while the room it is in has no emitter.
    const dark = eye && !emitters.some((e) => e.roomId !== undefined && e.roomId === eye.roomId);
    this.head.intensity = dark ? HEAD_LAMP_INTENSITY : 0;
    if (eye) this.head.position.set(...eye.position);
    return { lit, reassigned, shadowsMoved };
  }

  /** Fits the sun's shadow map to what casts shadows (`bounds`, in the world) and draws it again. */
  fitSunShadow(bounds: Box3) {
    fitShadowCamera(this.sun, bounds);
    this.sun.shadow.needsUpdate = true;
  }

  /**
   * How wide the sun's shadow is filtered: wider in a beautiful frame. The map is the same; the
   * radius is a uniform, so the tiers share their programs.
   */
  setShadowFilter(wide: boolean) {
    this.sun.shadow.radius = wide ? SUN_SHADOW_RADIUS_BEAUTIFUL : SUN_SHADOW_RADIUS;
  }

  /** What casts shadows changed: the maps of the lit lamps are drawn again. */
  redrawLampShadows() {
    this.lamps.forEach((lamp) => {
      if (lamp.castShadow && lamp.intensity > 0) lamp.shadow.needsUpdate = true;
    });
  }

  dispose() {
    this.sun.dispose();
    this.head.dispose();
    for (const lamp of this.lamps) lamp.dispose();
  }
}
