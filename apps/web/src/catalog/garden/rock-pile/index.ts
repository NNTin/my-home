import { box, colorParam, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { jitter } from '../random';

/** Stone sizes, as a fraction of the pile's height (layers) and of a 0.3 m stone (across). */
const STONE = 0.3;

/**
 * Natural stones heaped without mortar: layers of irregular blocks, each layer narrower than the
 * one below, like the rubble banks and dry-stone walls on the souterrain patio.
 */
export default definePiece({
  id: 'garden.rock-pile',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const layers = Math.max(1, Math.round(h / 0.2));
    const layer = h / layers;
    const parts: Part[] = [];
    let seed = 1;
    for (let l = 0; l < layers; l++) {
      const shrink = 1 - (0.5 * l) / layers;
      const [lw, ld] = [w * shrink, d * Math.max(0.35, shrink)];
      const across = Math.max(1, Math.round(lw / STONE));
      const deep = Math.max(1, Math.round(ld / STONE));
      for (let i = 0; i < across; i++) {
        for (let j = 0; j < deep; j++) {
          const r = jitter(seed++);
          const sx = (lw / across) * (0.8 + 0.2 * r);
          const sz = (ld / deep) * (0.75 + 0.25 * jitter(seed++));
          const sy = layer * (0.8 + 0.35 * jitter(seed++));
          const x = -lw / 2 + (lw / across) * (i + 0.5) + (r - 0.5) * 0.04;
          const z = -ld / 2 + (ld / deep) * (j + 0.5);
          const stone = box(
            [x, l * layer + sy / 2, z],
            [sx, sy, sz],
            shade(color, (r - 0.5) * 0.3),
            'body',
          );
          parts.push({ ...stone, rotationY: (jitter(seed++) - 0.5) * 0.5 });
        }
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
