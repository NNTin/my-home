import type { Vec2 } from '../../../geom/types';
import { GLASS, wood } from '../../cabinet';
import {
  box,
  colorParam,
  dimension,
  extrude,
  numberParam,
  shade,
  strip,
  tilted,
} from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const BEAM = 0.12;
const RAFTER = 0.05;
/** The roof sheet's waves: from crest to crest, and half their height. */
const WAVE = { pitch: 0.15, rise: 0.012 };

/**
 * A lean-to pergola: a ledger on the facade (the back, -z), posts and a beam at the front, rafters
 * and a translucent corrugated roof falling from the facade to the posts. The timber is oak veneer
 * stained to its colour, or lacquer for a colour lighter than oak.
 */
export default definePiece({
  id: 'garden.pergola',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const front = Math.min(numberParam(values, 'frontHeight'), h);
    const post = numberParam(values, 'post');
    const posts = Math.max(2, Math.round(numberParam(values, 'posts')));
    const { color: timber, material } = wood(colorParam(values, 'woodColor'));
    const beam = shade(timber, -0.08);
    const roof = colorParam(values, 'roofColor');
    const run = Math.hypot(d, h - front);
    const slope = Math.atan2(h - front, d);
    const zPost = d / 2 - post / 2;
    const parts: Part[] = [];
    for (let i = 0; i < posts; i++) {
      const x = -w / 2 + post / 2 + ((w - post) * i) / (posts - 1);
      parts.push(box([x, front / 2, zPost], [post, front, post], timber, 'post', material));
    }
    parts.push(
      box([0, front - BEAM / 2, zPost], [w, BEAM, post], beam, 'frame', material),
      box([0, h - BEAM / 2, -d / 2 + 0.03], [w, BEAM, 0.06], beam, 'frame', material),
    );
    const rafters = Math.max(2, Math.round(w / 0.8) + 1);
    for (let i = 0; i < rafters; i++) {
      const x = -w / 2 + RAFTER / 2 + ((w - RAFTER) * i) / (rafters - 1);
      parts.push(
        tilted(
          box(
            [x, (h + front) / 2 + RAFTER / 2, 0],
            [RAFTER, RAFTER * 1.6, run],
            timber,
            'frame',
            material,
          ),
          slope,
        ),
      );
    }
    // The sheet seen along its slope: a zigzag of waves across the width, a few millimetres thick.
    const waves = Math.max(2, Math.round((w + 0.1) / WAVE.pitch) * 2);
    const sheet: Vec2[] = Array.from({ length: waves + 1 }, (_, i) => [
      (i / waves - 0.5) * (w + 0.1),
      i % 2 ? WAVE.rise : -WAVE.rise,
    ]);
    parts.push(
      tilted(
        extrude(
          [0, (h + front) / 2 + RAFTER * 1.3 + WAVE.rise + 0.002, 0],
          strip(sheet, 0.004),
          run + 0.05,
          roof,
          'panel',
          0,
          { ...GLASS, transparent: true, opacity: 0.55, castShadow: false },
        ),
        slope,
      ),
    );
    return parts;
  },
  dimensions: (values) => {
    const { width: w, depth: d } = sizeOf(values);
    const front = numberParam(values, 'frontHeight');
    return [
      ...furnitureDimensions(values),
      dimension([w / 2, 0, d / 2], [w / 2, front, d / 2], front, 'Height at the posts'),
    ];
  },
});
