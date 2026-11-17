import { Block, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'wardrobe',
  name: 'Wardrobe',
  category: 'Bed room',
  icon: '🚪',
  description: 'Two-door wardrobe; stands with its back to a wall.',
  size: { width: 1.2, depth: 0.6, height: 2.0 },
  color: '#d9cbb3',
  snapping: { wall: 'back' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    return (
      <group>
        <Block position={[0, h / 2, 0]} size={[w, h, d]} color={color} state={state} />
        {[-1, 1].map((side) => (
          <Block
            key={side}
            position={[side * 0.06, h * 0.55, d / 2 + 0.01]}
            size={[0.02, 0.25, 0.02]}
            color={shade(color, -0.5)}
            state={state}
          />
        ))}
        <Block
          position={[0, h / 2, d / 2 + 0.003]}
          size={[0.01, h * 0.96, 0.005]}
          color={shade(color, -0.3)}
          state={state}
        />
      </group>
    );
  },
});
