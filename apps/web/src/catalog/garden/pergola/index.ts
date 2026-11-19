import { box, colorParam, numberParam, shade, tilted } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { dimension } from '../../parts';

const BEAM = 0.12;
const RAFTER = 0.05;

/**
 * A lean-to pergola: a ledger on the facade (the back, -z), posts and a beam at the front, rafters
 * and a translucent corrugated roof falling from the facade to the posts.
 */
export default definePiece({
  id: 'garden.pergola',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const front = Math.min(numberParam(values, 'frontHeight'), h);
    const post = numberParam(values, 'post');
    const posts = Math.max(2, Math.round(numberParam(values, 'posts')));
    const wood = colorParam(values, 'woodColor');
    const roof = colorParam(values, 'roofColor');
    const run = Math.hypot(d, h - front);
    const slope = Math.atan2(h - front, d);
    const zPost = d / 2 - post / 2;
    const parts = [];
    for (let i = 0; i < posts; i++) {
      const x = -w / 2 + post / 2 + ((w - post) * i) / (posts - 1);
      parts.push(box([x, front / 2, zPost], [post, front, post], wood, 'post'));
    }
    parts.push(
      box([0, front - BEAM / 2, zPost], [w, BEAM, post], shade(wood, -0.08), 'frame'),
      box([0, h - BEAM / 2, -d / 2 + 0.03], [w, BEAM, 0.06], shade(wood, -0.08), 'frame'),
    );
    const rafters = Math.max(2, Math.round(w / 0.8) + 1);
    for (let i = 0; i < rafters; i++) {
      const x = -w / 2 + RAFTER / 2 + ((w - RAFTER) * i) / (rafters - 1);
      parts.push(
        tilted(
          box([x, (h + front) / 2 + RAFTER / 2, 0], [RAFTER, RAFTER * 1.6, run], wood, 'frame'),
          slope,
        ),
      );
    }
    parts.push(
      tilted(
        box([0, (h + front) / 2 + RAFTER * 1.4, 0], [w + 0.1, 0.012, run + 0.05], roof, 'panel', {
          transparent: true,
          opacity: 0.55,
          roughness: 0.3,
          castShadow: false,
        }),
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
