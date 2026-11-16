import { Block, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'bed',
  name: 'Bed',
  category: 'Bedroom',
  icon: '🛏️',
  description: 'Double bed; the headboard is its back.',
  size: { width: 1.6, depth: 2.0, height: 0.5 },
  color: '#8a6a4a',
  snapping: { wall: 'back' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    const frame = h * 0.5;
    return (
      <group>
        <Block position={[0, frame / 2, 0]} size={[w, frame, d]} color={color} state={state} />
        <Block
          position={[0, frame + (h - frame) / 2, 0.04]}
          size={[w * 0.96, h - frame, d - 0.12]}
          color="#f2efe8"
          state={state}
        />
        <Block
          position={[0, h * 0.9, -d / 2 + 0.04]}
          size={[w, h * 1.8, 0.08]}
          color={shade(color, -0.2)}
          state={state}
        />
        {[-w / 4, w / 4].map((x) => (
          <Block
            key={x}
            position={[x, h + 0.05, -d / 2 + 0.3]}
            size={[w * 0.4, 0.1, 0.35]}
            color="#ffffff"
            state={state}
          />
        ))}
      </group>
    );
  },
});
