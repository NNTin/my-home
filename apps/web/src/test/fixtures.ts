import { HomeModel, type LayoutItem } from '@my-home/shared';
import mockHomeJson from '../../../../data/homes/mock-home.json';

export const mockHome = HomeModel.parse(mockHomeJson);

export const layoutItem = (overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id: 'item-1',
  typeId: 'bed',
  levelId: 'souterrain',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  props: {},
  ...overrides,
});
