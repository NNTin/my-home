/** What the floating toolbar of the selected furniture item does. */
export interface FurnitureToolbarProps {
  /** The item's name, e.g. "Bed". */
  name: string;
  onRotate(steps: number): void;
  onDuplicate(): void;
  onDelete(): void;
  /** Opens the furniture panel with the item's details and the other tools. */
  onMore(): void;
}

/**
 * The tools for the selected item, floating next to it in the 3D view on a touch screen, so
 * rotating, duplicating and deleting need no panel.
 */
export function FurnitureToolbar({
  name,
  onRotate,
  onDuplicate,
  onDelete,
  onMore,
}: FurnitureToolbarProps) {
  return (
    <div className="item-toolbar" role="toolbar" aria-label={`${name}: edit`}>
      <span className="item-toolbar-name">{name}</span>
      <button
        type="button"
        aria-label="Rotate left"
        title="Rotate left"
        onClick={() => onRotate(1)}
      >
        ⟲
      </button>
      <button
        type="button"
        aria-label="Rotate right"
        title="Rotate right"
        onClick={() => onRotate(-1)}
      >
        ⟳
      </button>
      <button type="button" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
        ⧉
      </button>
      <button type="button" aria-label="Delete" title="Delete" onClick={onDelete}>
        🗑
      </button>
      <button
        type="button"
        aria-label="More: open the furniture panel"
        title="More"
        onClick={onMore}
      >
        ⋯
      </button>
    </div>
  );
}
