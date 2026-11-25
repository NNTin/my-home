import {
  alongRun,
  handle,
  BOARD,
  FRONT_GAP,
  fittingParts,
  GLASS,
  LACQUER,
  METAL,
  wood,
} from '../../cabinet';
import {
  arc,
  box,
  colorParam,
  cylinder,
  dimension,
  extrude,
  numberParam,
  plank,
  rod,
  shade,
  slab,
  strip,
} from '../../parts';
import type { Part } from '../../types';
import type { ParamValues } from '@my-home/shared';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** The worktop's overhang past the fronts. */
const OVERHANG = 0.02;
/** The plinth stands back from the fronts. */
const PLINTH_SETBACK = 0.05;
const DRAWER = 0.15;
const SINK = { width: 0.78, depth: 0.5, bowl: 0.4 };
const HOB = { induction: 0.6, downdraft: 0.8, depth: 0.52 };
const OVEN = { width: 0.596, height: 0.595, panel: 0.1 };
/** Bright steel is drawn as lacquer in its colour: a metal would mirror the dim room (D81). */
const STEEL = '#b7b9bb';
const KNOB = '#9a9da0';

/** The tap seen from its side: up from the worktop, over in a half round, and a little down. */
const TAP = strip([[0, 0], ...arc([0.075, 0.22], 0.075, Math.PI, 0.35, 6)], 0.024);

/**
 * The stretches of the run that carry fronts, as [from, to] along x: the whole run, or what is
 * left on both sides of a built-in oven, which is a unit of its own.
 */
function stretches(values: ParamValues, w: number): { oven?: number; runs: [number, number][] } {
  // A run shorter than an oven has none.
  if (String(values.oven) !== 'built-in' || w < OVEN.width) return { runs: [[-w / 2, w / 2]] };
  const oven = alongRun(numberParam(values, 'ovenAt'), OVEN.width, w);
  const runs: [number, number][] = [
    [-w / 2, oven - OVEN.width / 2],
    [oven + OVEN.width / 2, w / 2],
  ];
  return { oven, runs: runs.filter(([from, to]) => to - from > 0.02) };
}

/** The units of one stretch share it evenly, as close to `unitWidth` as fits. */
const unitsOf = (values: ParamValues, length: number) =>
  fittingParts(length / numberParam(values, 'unitWidth'), length, 0.15);

/**
 * A run of base units: plinth, carcass, fronts and one worktop over the whole run. The units share
 * the run evenly, as close to `unitWidth` as fits; a built-in oven is a unit of its own, and the
 * others share what is left on its two sides. The sink, hob and oven sit at their distance from
 * the run's left end (seen from the front), kept inside the run. The worktop is oak veneer
 * stained to its colour (lacquer for a colour lighter than oak), the handles and the tap brushed
 * metal, the hob and the oven's door glass.
 */
export default definePiece({
  id: 'kitchen.base-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const plinth = numberParam(values, 'plinth');
    const worktop = numberParam(values, 'worktop');
    const front = colorParam(values, 'frontColor');
    const metal = colorParam(values, 'handleColor');
    const top = h - worktop;
    const face = d / 2 - OVERHANG;
    const parts: Part[] = [
      box(
        [0, plinth / 2, -PLINTH_SETBACK / 2],
        [w, plinth, d - OVERHANG - PLINTH_SETBACK],
        shade(front, -0.15),
        'body',
        LACQUER,
      ),
      box(
        [0, (plinth + top) / 2, (face - BOARD - d / 2) / 2],
        [w, top - plinth, face - BOARD + d / 2],
        colorParam(values, 'carcassColor'),
        'body',
        LACQUER,
      ),
    ];
    const addFront = (cx: number, width: number, bottom: number, height: number, bar = true) => {
      parts.push(
        box(
          [cx, bottom + height / 2, face - BOARD / 2],
          [width - FRONT_GAP, height - FRONT_GAP, BOARD],
          front,
          'leaf',
          LACQUER,
        ),
      );
      // A filler strip beside the oven has no handle.
      if (bar && width >= 0.15)
        parts.push(handle(cx, bottom + height - 0.04, face, Math.min(0.32, width * 0.6), metal));
    };
    const fronts = String(values.fronts);
    const { oven: ox, runs } = stretches(values, w);
    const height = top - plinth;
    for (const [from, to] of runs) {
      const units = unitsOf(values, to - from);
      const uw = (to - from) / units;
      for (let i = 0; i < units; i++) {
        const cx = from + uw * (i + 0.5);
        if (fronts === 'doors') addFront(cx, uw, plinth, height);
        else if (fronts === 'drawers') {
          for (let k = 0; k < 3; k++) addFront(cx, uw, plinth + (height / 3) * k, height / 3);
        } else {
          addFront(cx, uw, plinth, height - DRAWER);
          addFront(cx, uw, top - DRAWER, DRAWER);
        }
      }
    }
    if (ox !== undefined) {
      const bottom = top - 0.005 - OVEN.height;
      const oy = bottom + OVEN.height / 2;
      const panel = bottom + OVEN.height - OVEN.panel / 2;
      const oven = colorParam(values, 'ovenColor');
      // A blind under the oven, then the oven: its steel panel with a display and two knobs over
      // the glass door.
      addFront(ox, OVEN.width, plinth, bottom - plinth, false);
      parts.push(
        box(
          [ox, oy, face - BOARD / 2 + 0.002],
          [OVEN.width, OVEN.height, BOARD],
          oven,
          'body',
          LACQUER,
        ),
        box([ox, panel, face + 0.004], [OVEN.width, OVEN.panel, 0.004], STEEL, 'detail', LACQUER),
        box([ox, panel, face + 0.0065], [0.1, 0.035, 0.001], shade(oven, -0.6), 'detail', GLASS),
        ...[-1, 1].map((side) =>
          rod([ox + side * 0.19, panel, face + 0.016], 0.036, 0.02, KNOB, 'detail', 'z', LACQUER),
        ),
        box(
          [ox, bottom + (OVEN.height - OVEN.panel) / 2, face + 0.004],
          [OVEN.width - 0.012, OVEN.height - OVEN.panel - 0.012, 0.004],
          shade(oven, -0.6),
          'glass',
          GLASS,
        ),
        handle(
          ox,
          bottom + OVEN.height - OVEN.panel - 0.05,
          face + 0.006,
          OVEN.width - 0.08,
          STEEL,
          false,
          LACQUER,
        ),
      );
    }
    const board = wood(colorParam(values, 'worktopColor'));
    parts.push(
      plank([0, h - worktop / 2, 0], [w, worktop, d], board.color, 'board', board.material),
    );
    if (String(values.sink) === 'single') {
      const sw = Math.min(SINK.width, w - 0.04);
      const sx = alongRun(numberParam(values, 'sinkAt'), sw, w);
      const sink = colorParam(values, 'sinkColor');
      const bowl = Math.min(SINK.bowl, sw * 0.55);
      const bx = sx - sw / 2 + bowl / 2 + 0.03;
      const back = -SINK.depth / 2 + 0.045;
      // An inset sink: its rim on the worktop, the bowl with its drain, the drainer's grooves, and
      // the tap behind the bowl with its lever.
      parts.push(
        slab([sx, h + 0.003, 0.01], [sw, 0.006, SINK.depth], 0.03, sink, 'detail', LACQUER),
        slab(
          [bx, h + 0.0065, 0.03],
          [bowl, 0.001, SINK.depth - 0.12],
          0.05,
          shade(sink, -0.55),
          'detail',
          LACQUER,
        ),
        { ...cylinder([bx, h + 0.0075, 0.03], 0.09, 0.001, STEEL, 'detail'), material: LACQUER },
      );
      const grooves = Math.max(0, Math.floor((sw - bowl - 0.1) / 0.045));
      for (let i = 0; i < grooves; i++) {
        parts.push(
          box(
            [bx + bowl / 2 + 0.06 + 0.045 * i, h + 0.0065, 0.03],
            [0.012, 0.001, SINK.depth - 0.16],
            shade(sink, -0.4),
            'detail',
            LACQUER,
          ),
        );
      }
      parts.push(
        { ...cylinder([bx, h + 0.031, back], 0.05, 0.05, sink, 'detail'), material: METAL },
        extrude([bx, h + 0.056, back], TAP, 0.024, sink, 'detail', -Math.PI / 2, METAL),
        box([bx + 0.045, h + 0.045, back], [0.05, 0.012, 0.016], sink, 'detail', METAL),
      );
    }
    const hob = String(values.hob);
    if (hob !== 'none') {
      const hw = Math.min(hob === 'downdraft' ? HOB.downdraft : HOB.induction, w - 0.04);
      const hx = alongRun(numberParam(values, 'hobAt'), hw, w);
      const glass = colorParam(values, 'hobColor');
      parts.push(
        slab([hx, h + 0.003, 0.01], [hw, 0.006, HOB.depth], 0.008, glass, 'detail', GLASS),
      );
      if (hob === 'downdraft') {
        // The extractor's slot runs front to back across the middle, under a grille.
        parts.push(
          slab(
            [hx, h + 0.0065, 0.01],
            [0.1, 0.001, HOB.depth - 0.1],
            0.01,
            shade(glass, 0.3),
            'detail',
            LACQUER,
          ),
        );
      }
    }
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const [from, to] = stretches(values, w).runs[0] ?? [-w / 2, w / 2];
    const uw = (to - from) / unitsOf(values, to - from);
    const plinth = numberParam(values, 'plinth');
    return [
      dimension([-w / 2, h, d / 2], [w / 2, h, d / 2], w, 'Run length'),
      dimension([w / 2, h, d / 2], [w / 2, h, -d / 2], d, 'Depth'),
      dimension([w / 2, 0, -d / 2], [w / 2, h, -d / 2], h, 'Worktop height'),
      dimension([from, plinth, d / 2], [from + uw, plinth, d / 2], uw, 'Unit width'),
      dimension([w / 2, 0, d / 2 - 0.1], [w / 2, plinth, d / 2 - 0.1], plinth, 'Plinth'),
    ];
  },
});
