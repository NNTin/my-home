import type { Vec2 } from '../../../builder/buildHome';
import { colorParam, extrude, shade } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { jitter } from '../random';

/** A stone is about this wide; larger in a pile so large that it would be more than 80 stones. */
const STONE = 0.3;
const CORNERS = 7;

/** A stone's outline: an uneven polygon that fills a `sx` x `sz` box about its middle. */
function outline(sx: number, sz: number, seed: number): Vec2[] {
  const points = Array.from({ length: CORNERS }, (_, k): Vec2 => {
    const a = ((k + 0.5 * jitter(seed + k)) / CORNERS) * 2 * Math.PI;
    return [Math.cos(a), Math.sin(a)];
  });
  // Stretched to the box: the stones of a layer stand shoulder to shoulder.
  const [xs, zs] = [points.map((p) => p[0]), points.map((p) => p[1])];
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return points.map(([x, z]) => [
    ((x - x0) / (x1 - x0) - 0.5) * sx,
    ((z - z0) / (z1 - z0) - 0.5) * sz,
  ]);
}

/**
 * Natural stones heaped without mortar: layers of boulders, each layer narrower than the one
 * below, like the rubble banks and dry-stone walls on the souterrain patio. A boulder is two
 * uneven blocks through each other, so that neither its plan nor its side is a rectangle.
 */
export default definePiece({
  id: 'garden.rock-pile',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const layers = Math.max(1, Math.round(h / 0.2));
    const layer = h / layers;
    const unit = Math.max(STONE, Math.sqrt((w * d * layers) / 150));
    const parts: Part[] = [];
    let seed = 1;
    for (let l = 0; l < layers; l++) {
      const shrink = 1 - (0.5 * l) / layers;
      const [lw, ld] = [w * shrink, d * Math.max(0.35, shrink)];
      const across = Math.max(1, Math.round(lw / unit));
      const deep = Math.max(1, Math.round(ld / unit));
      for (let i = 0; i < across; i++) {
        for (let j = 0; j < deep; j++) {
          const r = jitter(seed++);
          const sx = (lw / across) * (0.8 + 0.2 * r);
          const sz = (ld / deep) * (0.75 + 0.25 * jitter(seed++));
          const sy = layer * (0.8 + 0.35 * jitter(seed++));
          const x = -lw / 2 + (lw / across) * (i + 0.5) + (r - 0.5) * 0.04;
          const z = -ld / 2 + (ld / deep) * (j + 0.5);
          const turn = (jitter(seed++) - 0.5) * 0.9;
          const y0 = l * layer;
          const tone = shade(color, (r - 0.5) * 0.3);
          // Two blocks through each other: the stone's plan, laid flat and extruded through most
          // of its height, and its silhouette from the side, standing across it.
          parts.push(
            {
              ...extrude([x, y0 + sy * 0.39, z], outline(sx, sz, seed), sy * 0.78, tone, 'body'),
              rotationX: Math.PI / 2,
              rotationY: turn,
            },
            extrude(
              [x, y0 + sy / 2, z],
              outline(sx * 0.82, sy, seed + 9),
              sz * 0.7,
              tone,
              'body',
              turn,
            ),
          );
        }
      }
    }
    return parts;
  },
  dimensions: furnitureDimensions,
});
