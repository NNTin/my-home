import { alongRun, barHandle, BOARD, FRONT_GAP, fittingParts } from '../../cabinet';
import { box, colorParam, cylinder, dimension, numberParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { sizeOf } from '../../furniture/size';

/** The worktop's overhang past the fronts. */
const OVERHANG = 0.02;
/** The plinth stands back from the fronts. */
const PLINTH_SETBACK = 0.05;
const DRAWER = 0.15;
const SINK = { width: 0.78, depth: 0.5, bowl: 0.4 };
const HOB = { induction: 0.6, downdraft: 0.8, depth: 0.52 };
const OVEN = { width: 0.596, height: 0.595 };

/**
 * A run of base units: plinth, carcass, fronts and one worktop over the whole run. The units share
 * the run evenly, as close to `unitWidth` as fits. The sink, hob and oven sit at their distance
 * from the run's left end (seen from the front), kept inside the run.
 */
export default definePiece({
  id: 'kitchen.base-cabinet',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const plinth = numberParam(values, 'plinth');
    const worktop = numberParam(values, 'worktop');
    const front = colorParam(values, 'frontColor');
    const handle = colorParam(values, 'handleColor');
    const top = h - worktop;
    const face = d / 2 - OVERHANG;
    const units = fittingParts(w / numberParam(values, 'unitWidth'), w, 0.15);
    const uw = w / units;
    const parts: Part[] = [
      box(
        [0, plinth / 2, -PLINTH_SETBACK / 2],
        [w, plinth, d - OVERHANG - PLINTH_SETBACK],
        shade(front, -0.45),
        'body',
      ),
      box(
        [0, (plinth + top) / 2, (face - BOARD - d / 2) / 2],
        [w, top - plinth, face - BOARD + d / 2],
        colorParam(values, 'carcassColor'),
        'body',
      ),
    ];
    const fronts = String(values.fronts);
    const addFront = (cx: number, bottom: number, height: number) => {
      parts.push(
        box(
          [cx, bottom + height / 2, face - BOARD / 2],
          [uw - FRONT_GAP, height - FRONT_GAP, BOARD],
          front,
          'leaf',
        ),
        barHandle(cx, bottom + height - 0.04, face, Math.min(0.32, uw * 0.6), handle),
      );
    };
    for (let i = 0; i < units; i++) {
      const cx = -w / 2 + uw * (i + 0.5);
      const height = top - plinth;
      if (fronts === 'doors') addFront(cx, plinth, height);
      else if (fronts === 'drawers') {
        for (let k = 0; k < 3; k++) addFront(cx, plinth + (height / 3) * k, height / 3);
      } else {
        addFront(cx, plinth, height - DRAWER);
        addFront(cx, top - DRAWER, DRAWER);
      }
    }
    if (String(values.oven) === 'built-in') {
      const ox = alongRun(numberParam(values, 'ovenAt'), OVEN.width, w);
      const oy = top - 0.005 - OVEN.height / 2;
      const oven = colorParam(values, 'ovenColor');
      parts.push(
        box([ox, oy, face + 0.004], [OVEN.width, OVEN.height, 0.012], oven, 'body'),
        box(
          [ox, oy - 0.04, face + 0.011],
          [OVEN.width - 0.1, OVEN.height - 0.24, 0.004],
          shade(oven, -0.6),
          'glass',
        ),
        barHandle(ox, oy + OVEN.height / 2 - 0.08, face + 0.01, OVEN.width - 0.1, '#b7b9bb'),
      );
    }
    parts.push(
      box([0, h - worktop / 2, 0], [w, worktop, d], colorParam(values, 'worktopColor'), 'board'),
    );
    if (String(values.sink) === 'single') {
      const sw = Math.min(SINK.width, w - 0.04);
      const sx = alongRun(numberParam(values, 'sinkAt'), sw, w);
      const sink = colorParam(values, 'sinkColor');
      const bowl = Math.min(SINK.bowl, sw * 0.55);
      const bx = sx - sw / 2 + bowl / 2 + 0.03;
      parts.push(
        box([sx, h + 0.002, 0.01], [sw, 0.004, SINK.depth], sink, 'detail'),
        box([bx, h + 0.003, 0.01], [bowl, 0.004, SINK.depth - 0.08], shade(sink, -0.5), 'detail'),
        cylinder([bx, h + 0.15, -SINK.depth / 2 - 0.02], 0.03, 0.3, '#b7b9bb', 'detail'),
        box([bx, h + 0.29, -SINK.depth / 2 + 0.06], [0.02, 0.02, 0.16], '#b7b9bb', 'detail'),
      );
    }
    const hob = String(values.hob);
    if (hob !== 'none') {
      const hw = Math.min(hob === 'downdraft' ? HOB.downdraft : HOB.induction, w - 0.04);
      const hx = alongRun(numberParam(values, 'hobAt'), hw, w);
      const glass = colorParam(values, 'hobColor');
      parts.push(box([hx, h + 0.003, 0.01], [hw, 0.006, HOB.depth], glass, 'detail'));
      if (hob === 'downdraft') {
        // The extractor's slot runs front to back across the middle.
        parts.push(
          box(
            [hx, h + 0.0065, 0.01],
            [0.09, 0.002, HOB.depth - 0.06],
            shade(glass, 0.25),
            'detail',
          ),
        );
      }
    }
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const units = fittingParts(w / numberParam(values, 'unitWidth'), w, 0.15);
    const uw = w / units;
    const plinth = numberParam(values, 'plinth');
    return [
      dimension([-w / 2, h, d / 2], [w / 2, h, d / 2], w, 'Run length'),
      dimension([w / 2, h, d / 2], [w / 2, h, -d / 2], d, 'Depth'),
      dimension([w / 2, 0, -d / 2], [w / 2, h, -d / 2], h, 'Worktop height'),
      dimension([-w / 2, plinth, d / 2], [-w / 2 + uw, plinth, d / 2], uw, 'Unit width'),
      dimension([w / 2, 0, d / 2 - 0.1], [w / 2, plinth, d / 2 - 0.1], plinth, 'Plinth'),
    ];
  },
});
