import { Block, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'desk',
  name: 'Desk',
  category: 'Work room',
  icon: '🖥️',
  description: 'Work desk; usually against a wall.',
  size: { width: 1.4, depth: 0.7, height: 0.75 },
  color: '#c9b18f',
  snapping: { wall: 'back' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    const top = 0.04;
    const leg = 0.05;
    return (
      <group>
        <Block position={[0, h - top / 2, 0]} size={[w, top, d]} color={color} state={state} />
        {[-1, 1].map((side) => (
          <Block
            key={side}
            position={[side * (w / 2 - leg / 2), (h - top) / 2, 0]}
            size={[leg, h - top, d - 0.04]}
            color={shade(color, -0.25)}
            state={state}
          />
        ))}
      </group>
    );
  },
});
