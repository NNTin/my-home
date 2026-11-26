import { GLASS, LACQUER } from '../../cabinet';
import { box, colorParam, cylinder, rod, slab } from '../../parts';
import type { Part } from '../../types';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../../furniture/size';
import { wallSide } from '../sanitary';

/** The profiles' width and the panes' thickness. */
const PROFILE = 0.03;
const PANE = 0.008;
/**
 * The rail: its bottom and top above the floor, and how far it stands off the wall. Fixed on
 * purpose: a rail hangs at a person's height, whatever the glass's (`height`, 1.8 to 2.2 m), so
 * the head is over a low screen and under a high one.
 */
const RAIL = { bottom: 1.0, top: 2.1, off: 0.05 };

/**
 * A level walk-in shower in a corner: the back (-z) and one side are the room's walls, the front
 * and the other side glass between chrome profiles, the side pane with the door's handle. At the
 * back wall a rail with the thermostat, an arm and a rain head; the drain is a channel along
 * that wall. The floor is the room's.
 */
export default definePiece({
  id: 'bath.shower',
  parts: (values) => {
    const { width: w, depth: d, height: h } = sizeOf(values);
    const open = -wallSide(values);
    const metal = colorParam(values, 'metalColor');
    const glass = colorParam(values, 'glassColor');
    const pane: Part['material'] = {
      ...GLASS,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      castShadow: false,
    };
    const chrome = (center: Part['center'], size: Part['size']) =>
      box(center, size, metal, 'frame', LACQUER);
    const gx = open * (w / 2 - PROFILE / 2);
    const gz = d / 2 - PROFILE / 2;
    const wall = -d / 2 + RAIL.off;
    return [
      chrome([0, 0.003, -d / 2 + 0.07], [w * 0.7, 0.006, 0.07]),
      {
        ...cylinder(
          [0, (RAIL.bottom + RAIL.top) / 2, wall],
          0.022,
          RAIL.top - RAIL.bottom,
          metal,
          'detail',
        ),
        material: LACQUER,
      },
      rod([0, RAIL.bottom + 0.1, wall], 0.045, 0.28, metal, 'detail', 'x', LACQUER),
      rod([0, RAIL.top - 0.011, wall + 0.15], 0.022, 0.3, metal, 'detail', 'z', LACQUER),
      slab([0, RAIL.top - 0.03, wall + 0.3], [0.22, 0.016, 0.22], 0.03, metal, 'detail', LACQUER),
      // The profiles at the two walls and the post where the panes meet.
      chrome([-gx, h / 2, gz], [PROFILE, h, PROFILE]),
      chrome([gx, h / 2, gz], [PROFILE, h, PROFILE]),
      chrome([gx, h / 2, -gz], [PROFILE, h, PROFILE]),
      // The door's handle, outside the side pane: 5 cm past the footprint, as a fridge's handle
      // is past its front. Collisions and the walking figure go by the footprint.
      chrome([gx + open * 0.045, 1.05, 0], [0.014, 0.26, 0.014]),
      ...[-0.1, 0.1].map((y) => chrome([gx + open * 0.023, 1.05 + y, 0], [0.038, 0.014, 0.014])),
      // The panes last: they are see-through, and drawn over what stands behind them.
      box([0, h / 2, gz], [w - 2 * PROFILE, h, PANE], glass, 'glass', pane),
      box([gx, h / 2, 0], [PANE, h, d - 2 * PROFILE], glass, 'glass', pane),
    ];
  },
  dimensions: furnitureDimensions,
});
