import { ellipse } from '../../editor/geometry';
import { Cylinder, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'table',
  name: 'Round table',
  category: 'Dining',
  icon: '⭕',
  description: 'Round dining table on a single leg.',
  size: { width: 1.1, depth: 1.1, height: 0.75 },
  color: '#b08a5e',
  // A round footprint lets chairs tuck in closer than a square one would.
  footprint: ellipse(1.1, 1.1),
  snapping: { wall: 'none' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    const top = 0.04;
    return (
      <group>
        <Cylinder
          position={[0, h - top / 2, 0]}
          radius={w / 2}
          height={top}
          scale={[1, 1, d / w]}
          color={color}
          state={state}
        />
        <Cylinder
          position={[0, (h - top) / 2, 0]}
          radius={0.05}
          height={h - top}
          color={shade(color, -0.3)}
          state={state}
        />
        <Cylinder
          position={[0, 0.015, 0]}
          radius={0.25}
          height={0.03}
          color={shade(color, -0.3)}
          state={state}
        />
      </group>
    );
  },
});
