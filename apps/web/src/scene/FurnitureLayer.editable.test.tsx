import ReactThreeTestRenderer from '@react-three/test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { FurnitureLayer, type FurnitureHandlers, type FurnitureView } from './FurnitureLayer';

const item: FurnitureView = {
  id: 'bed-1',
  position: [0, 0, 0],
  rotationY: 0,
  size: { width: 1, depth: 2, height: 0.5 },
  parts: [{ kind: 'box', size: [1, 0.5, 2], position: [0, 0.25, 0], color: '#888888' }] as never,
  selected: true,
  colliding: false,
};

const handlers = (): FurnitureHandlers => ({
  onSelect: vi.fn(),
  onMoveStart: vi.fn(),
  onMove: vi.fn(),
  onRotateStart: vi.fn(),
  onRotate: vi.fn(),
  onDragEnd: vi.fn(),
});

/** Every object of the scene that listens for a pointer event, by event name. */
const listeners = async (editable: boolean) => {
  const renderer = await ReactThreeTestRenderer.create(
    <FurnitureLayer items={[item]} handlers={handlers()} editable={editable} />,
  );
  const names = new Set<string>();
  const walk = (node: (typeof renderer.scene)['children'][number]): void => {
    for (const prop of Object.keys(node.props))
      if (/^on(Pointer|Click)/.test(prop)) names.add(prop);
    node.children.forEach(walk);
  };
  walk(renderer.scene);
  return names;
};

describe('FurnitureLayer in view mode', () => {
  it('can be drag-moved and rotated in edit mode', async () => {
    const names = await listeners(true);
    expect(names).toContain('onPointerDown');
    expect(names).toContain('onPointerMove');
  });

  it('only reacts to a click in view mode: no drag, and no rotate ring', async () => {
    const names = await listeners(false);
    expect([...names]).toEqual(['onClick']);
  });
});
