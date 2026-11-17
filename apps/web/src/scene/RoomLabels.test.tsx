import { render } from '@testing-library/react';
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { projectLabel, RoomLabels } from './RoomLabels';

function camera() {
  const c = new PerspectiveCamera(45, 2, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

describe('projectLabel', () => {
  it('puts the point the camera looks at in the middle of the view', () => {
    expect(projectLabel([0, 0, 0], camera(), 400, 200)).toEqual({ x: 200, y: 100 });
  });

  it('puts a point above the middle above it, on screen', () => {
    const p = projectLabel([0, 1, 0], camera(), 400, 200);
    expect(p?.x).toBeCloseTo(200);
    expect(p!.y).toBeLessThan(100);
  });

  it('has nothing for a point behind the camera', () => {
    expect(projectLabel([0, 0, 20], camera(), 400, 200)).toBeUndefined();
  });
});

describe('RoomLabels', () => {
  const at: [number, number, number] = [0, 0, 0];

  // Room names change as walk mode is entered and left. Plain DOM follows React through that:
  // drei's Html, with a React root per label, threw a removeChild NotFoundError (issue #31).
  it('follows its labels without a React root of its own and without errors', () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    const layerRef = createRef<HTMLDivElement>();
    const { rerender, container } = render(
      <RoomLabels labels={[{ id: 'a', name: 'Hall', at }]} layerRef={layerRef} />,
    );
    expect(container.textContent).toBe('Hall');
    rerender(
      <RoomLabels
        labels={[
          { id: 'a', name: 'Hall', at },
          { id: 'b', name: 'Kitchen', at },
        ]}
        layerRef={layerRef}
      />,
    );
    expect(Array.from(layerRef.current!.children).map((c) => c.textContent)).toEqual([
      'Hall',
      'Kitchen',
    ]);
    rerender(<RoomLabels labels={[]} layerRef={layerRef} />);
    expect(layerRef.current!.children).toHaveLength(0);
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });
});
