import { Block, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'sofa',
  name: 'Sofa',
  category: 'Living room',
  icon: '🛋️',
  description: 'Three-seater; the backrest is its back.',
  size: { width: 2.0, depth: 0.9, height: 0.85 },
  color: '#5b7a99',
  snapping: { wall: 'back' },
  Render: ({ size, color, ...state }) => {
    const { width: w, depth: d, height: h } = size;
    const seat = h * 0.5;
    const arm = 0.18;
    const back = 0.22;
    return (
      <group>
        <Block
          position={[0, seat / 2, back / 2]}
          size={[w - 2 * arm, seat, d - back]}
          color={color}
          state={state}
        />
        <Block
          position={[0, h / 2, -d / 2 + back / 2]}
          size={[w, h, back]}
          color={shade(color, -0.15)}
          state={state}
        />
        {[-1, 1].map((side) => (
          <Block
            key={side}
            position={[side * (w / 2 - arm / 2), (h * 0.7) / 2, 0]}
            size={[arm, h * 0.7, d]}
            color={shade(color, -0.1)}
            state={state}
          />
        ))}
      </group>
    );
  },
});
