import { groundAt, type HomeScene, type Vec3 } from '../builder/buildHome';
import type { Visibility } from '../builder/visibility';
import { UNKNOWN_SIZE, unknownParts } from '../catalog/furniture';
import type { EditorItem } from '../editor/item';
import { mountHeightOf, typeOf, type EditorContext } from '../editor/operations';
import type { FurnitureView } from './FurnitureLayer';

/**
 * The furniture the scene draws for a visibility: the items on the levels and in the apartments
 * that are shown, each at its place in the world with the parts of its type.
 */
export function furnitureViews(
  ctx: EditorContext,
  items: readonly EditorItem[],
  scene: HomeScene,
  visibility: Visibility,
  selectedId?: string,
  colliding?: { has(id: string): boolean },
): FurnitureView[] {
  const levels = new Set(
    scene.levels
      .filter((l) => l.index <= visibility.maxLevelIndex && !visibility.hiddenLevels.includes(l.id))
      .map((l) => l.id),
  );
  const hiddenApartments = new Set(visibility.hiddenApartments);
  return items.flatMap((item) => {
    const p = ctx.plans.get(item.levelId);
    const type = typeOf(ctx, item);
    // Outdoor pieces stand on the ground and show with the terrain, whatever the cutaway.
    const outdoor = type?.outdoor ?? false;
    if (!p || (!outdoor && !levels.has(item.levelId))) return [];
    const apartment = p.rooms.find((r) => r.id === item.roomId)?.apartmentId;
    if (apartment !== undefined && hiddenApartments.has(apartment)) return [];
    const base = outdoor
      ? groundAt(scene.terrain, [item.position.x, item.position.z], p.elevation)
      : p.elevation;
    return [
      {
        id: item.id,
        position: [item.position.x, base + mountHeightOf(ctx, item), item.position.z] as Vec3,
        rotationY: item.rotationY,
        size: type?.size ?? UNKNOWN_SIZE,
        parts: type?.parts ?? unknownParts(),
        selected: item.id === selectedId,
        colliding: colliding?.has(item.id) ?? false,
      },
    ];
  });
}
