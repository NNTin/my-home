import { Block, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'chair',
  name: 'Chair',
  category: 'Dining',
  icon: '🪑',
  description: 'Dining chair; the backrest is its back.',
  size: { width: 0.45, depth: 0.5, height: 0.9 },
  color: '#9c7148',
  snapping: { wall: 'none' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    const seat = 0.46;
    const leg = 0.04;
    return (
      <group>
        <Block position={[0, seat, 0]} size={[w, 0.04, d]} color={color} state={state} />
        <Block
          position={[0, seat + (h - seat) / 2, -d / 2 + leg / 2]}
          size={[w, h - seat, leg]}
          color={shade(color, -0.15)}
          state={state}
        />
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sz]) => (
          <Block
            key={`${sx}:${sz}`}
            position={[sx! * (w / 2 - leg / 2), seat / 2, sz! * (d / 2 - leg / 2)]}
            size={[leg, seat, leg]}
            color={shade(color, -0.3)}
            state={state}
          />
        ))}
      </group>
    );
  },
});
