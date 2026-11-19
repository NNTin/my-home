import { Link } from '../routing';

/** How far ▲ and ▼ move the selected item up or down, in centimetres. */
export const RAISE_STEP = 5;

/** What the floating toolbar of the selected furniture item does. */
export interface FurnitureToolbarProps {
  /** The item's name, e.g. "Bedroom · Bed". */
  name: string;
  /** Its piece page, on this use. */
  href: string;
  onRotate(steps: number): void;
  /** Raises (or with a negative value lowers) the item by that many centimetres; absent under a ceiling. */
  onRaise?(cm: number): void;
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
  href,
  onRotate,
  onRaise,
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
      {onRaise && (
        <>
          <button
            type="button"
            aria-label={`Raise ${RAISE_STEP} cm`}
            title={`Raise ${RAISE_STEP} cm`}
            onClick={() => onRaise(RAISE_STEP)}
          >
            ▲
          </button>
          <button
            type="button"
            aria-label={`Lower ${RAISE_STEP} cm`}
            title={`Lower ${RAISE_STEP} cm`}
            onClick={() => onRaise(-RAISE_STEP)}
          >
            ▼
          </button>
        </>
      )}
      <button type="button" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
        ⧉
      </button>
      <button type="button" aria-label="Delete" title="Delete" onClick={onDelete}>
        🗑
      </button>
      <Link className="button" to={href} aria-label="Open piece page" title="Piece page">
        ⓘ
      </Link>
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

/**
 * The selected window, door, roof window or gate on a phone: its name, type and a link to its
 * piece page, floating over the foot of the 3D view.
 */
export function PieceToolbar({
  name,
  typeName,
  href,
  onClose,
}: {
  name: string;
  typeName: string;
  href: string;
  onClose(): void;
}) {
  return (
    <div className="item-toolbar piece-toolbar" role="toolbar" aria-label={`${name}: piece`}>
      <span className="item-toolbar-name">
        {name} <span className="piece-type">· {typeName}</span>
      </span>
      <Link className="button" to={href} aria-label={`Open piece page: ${name}`}>
        Open piece page
      </Link>
      <button type="button" aria-label="Close" title="Close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
