import type { Vec3 } from '../geom/types';

/**
 * The light rig (docs/design/realistic-render.md §6.1): plain data that says how a view is lit.
 * Views choose a rig through `rigFor`; tiers decide how much of it is drawn. Every rig is daylight
 * from a studio sun: nothing here knows a place, a date or a time. Time of day (#18) plugs in by
 * supplying other rigs from `rigFor`, without touching tiers, materials or the frame loop (§6.5).
 */

/** What is behind the scene (§6.3). `studio-dark` is daylight on a dark ground, not an evening. */
export const BACKDROPS = ['sky', 'studio-light', 'studio-dark'] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export interface LightRig {
  sun: {
    /** From the scene towards the sun; any length. */
    direction: Vec3;
    /** `#rrggbb`. */
    color: string;
    intensity: number;
  };
  /** Intensity of the ambient environment (`environment.ts`). */
  environment: number;
  /** The factor applied to the environment in a view under a ceiling. */
  interior: number;
  lamps: {
    /** Whether fixtures emit. */
    on: boolean;
    /** Scene intensity per candela of an emitter. */
    intensity: number;
  };
  backdrop: Backdrop;
  /** Tone-mapping exposure. */
  exposure: number;
}

/** Where a section looks: plan directions, -z being plan north. */
export type Look = 'north' | 'east' | 'south' | 'west';

/**
 * What the rig is chosen for. `free` is the orbit view (the level cutaway and the overview while
 * walking included); `eye` is a view from inside a room, under its ceiling (walking in first
 * person, "view from here"). `cutaway` and `section` are the named views of §7.1.
 */
export type RigView =
  { kind: 'free' } | { kind: 'eye' } | { kind: 'cutaway' } | { kind: 'section'; look: Look };

/** The free view's sun: from the south-east, high. It is where it has always been. */
const FREE_SUN: Vec3 = [20, 30, 15];

const DAYLIGHT: LightRig = {
  sun: { direction: FREE_SUN, color: '#ffffff', intensity: 1.6 },
  environment: 0.5,
  interior: 0.3,
  lamps: { on: true, intensity: 0.028 },
  backdrop: 'sky',
  exposure: 1,
};

/** Unit vectors on the plan, pointing where each look looks. */
const LOOKS: Record<Look, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

/**
 * The sun of a section: behind the camera and to its left, high, so the faces turned to the
 * camera are lit and their relief still throws a shadow.
 */
function sectionSun(look: Look): Vec3 {
  const [x, z] = LOOKS[look];
  // The camera stands at -look; its left is look turned a quarter clockwise seen from above.
  return [-x * 20 + z * 12, 26, -z * 20 - x * 12];
}

/** The rig of a view. Every rig is daylight until #18 supplies others. */
export function rigFor(view: RigView): LightRig {
  switch (view.kind) {
    case 'free':
    case 'eye':
      return DAYLIGHT;
    case 'cutaway':
      return { ...DAYLIGHT, backdrop: 'studio-light' };
    case 'section':
      return {
        ...DAYLIGHT,
        sun: { ...DAYLIGHT.sun, direction: sectionSun(view.look) },
        backdrop: 'studio-light',
      };
  }
}

/** The environment's intensity in a view: lowered under a ceiling, where lamps light the room. */
export const environmentIntensity = (rig: LightRig, underCeiling: boolean): number =>
  rig.environment * (underCeiling ? rig.interior : 1);

export const parseBackdrop = (value: unknown): Backdrop | undefined =>
  BACKDROPS.find((b) => b === value);

/** The backdrop asked for by the URL (`?backdrop=`), for one visit. */
export const backdropRequested = (search: string): Backdrop | undefined =>
  parseBackdrop(new URLSearchParams(search).get('backdrop'));

/** A backdrop's colours as displayed, `#rrggbb`: at the top and at the foot of the view. */
export interface BackdropColors {
  top: string;
  bottom: string;
}

/** Flat colours, as seen from outside. `sky` is the blue the viewer has always had. */
const FLAT: Record<Backdrop, string> = {
  sky: '#cfdde8',
  'studio-light': '#ffffff',
  'studio-dark': '#2e3033',
};

/** At eye level, through the windows: a simple vertical gradient, lighter at the horizon. */
const EYE: Record<Backdrop, BackdropColors> = {
  sky: { top: '#b4cde3', bottom: '#e9f0f5' },
  'studio-light': { top: '#f1f2f3', bottom: '#ffffff' },
  'studio-dark': { top: '#232528', bottom: '#3a3d41' },
};

export const backdropColors = (backdrop: Backdrop, eye: boolean): BackdropColors =>
  eye ? EYE[backdrop] : { top: FLAT[backdrop], bottom: FLAT[backdrop] };
