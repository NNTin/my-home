import { SkButton } from '../hud/SkButton';
import { SkIconButton } from '../hud/SkIconButton';

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
      {/* Compact icon buttons (docs/design/hud.md §4.3): wedges the way each one moves the item. */}
      <SkIconButton
        size="compact"
        icon="rotate-left"
        dir="ccw"
        label="Rotate left"
        onClick={() => onRotate(1)}
      />
      <SkIconButton
        size="compact"
        icon="rotate-right"
        dir="cw"
        label="Rotate right"
        onClick={() => onRotate(-1)}
      />
      {onRaise && (
        <>
          <SkIconButton
            size="compact"
            icon="up"
            dir="up"
            label={`Raise ${RAISE_STEP} cm`}
            onClick={() => onRaise(RAISE_STEP)}
          />
          <SkIconButton
            size="compact"
            icon="down"
            dir="down"
            label={`Lower ${RAISE_STEP} cm`}
            onClick={() => onRaise(-RAISE_STEP)}
          />
        </>
      )}
      <SkIconButton size="compact" icon="duplicate" label="Duplicate" onClick={onDuplicate} />
      <SkIconButton size="compact" icon="delete" hit="puff" label="Delete" onClick={onDelete} />
      <SkIconButton
        size="compact"
        icon="info"
        label="Open piece page"
        title="Piece page"
        href={href}
      />
      <SkIconButton
        size="compact"
        icon="more"
        label="More: open the furniture panel"
        title="More"
        onClick={onMore}
      />
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
  onDetails,
  onClose,
}: {
  name: string;
  typeName: string;
  /** Its piece page; a room has none. */
  href?: string | undefined;
  /** Opens the inspector: the sheet's Furniture tab on the selection (HUD v2 #201). */
  onDetails(): void;
  onClose(): void;
}) {
  return (
    <div className="item-toolbar piece-toolbar" role="toolbar" aria-label={`${name}: piece`}>
      {/* Its name is the label: a tap opens the inspector, as the desktop's edge label (HUD v2 #201). */}
      <SkButton
        className="item-toolbar-name"
        size="compact"
        appearance="clear"
        aria-label={`${name}: details`}
        onClick={onDetails}
      >
        {name} <span className="piece-type">· {typeName}</span>
      </SkButton>
      {href && (
        <SkButton
          size="compact"
          variant="secondary"
          aria-label={`Open piece page: ${name}`}
          href={href}
        >
          Open piece page
        </SkButton>
      )}
      <SkIconButton size="compact" icon="close" label="Close" onClick={onClose} />
    </div>
  );
}
