import { barHandle, clamp, uprightHandle } from '../../cabinet';
import { box, colorParam, dimension, numberParam, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';

const DOOR = 0.04;

/** A freestanding fridge-freezer: the body, the fridge door over the freezer door, bar handles. */
export default definePiece({
  id: 'appliance.fridge-freezer',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    const handle = colorParam(values, 'handleColor');
    const f = clamp(numberParam(values, 'freezer'), 0.2, h - 0.3);
    const face = d / 2;
    return [
      box([0, h / 2, -DOOR / 2], [w, h, d - DOOR], shade(color, -0.12), 'body'),
      box([0, f + (h - f) / 2, face - DOOR / 2], [w - 0.004, h - f - 0.006, DOOR], color, 'leaf'),
      box([0, f / 2, face - DOOR / 2], [w - 0.004, f - 0.006, DOOR], color, 'leaf'),
      uprightHandle(w / 2 - 0.05, f + 0.3, face, 0.4, handle),
      barHandle(0, f - 0.06, face, w * 0.6, handle),
    ];
  },
  dimensions: (values) => {
    const { width: w, depth: d } = sizeOf(values);
    const f = clamp(numberParam(values, 'freezer'), 0.2, sizeOf(values).height - 0.3);
    return [
      ...furnitureDimensions(values),
      dimension([-w / 2, 0, d / 2], [-w / 2, f, d / 2], f, 'Freezer door'),
    ];
  },
});
