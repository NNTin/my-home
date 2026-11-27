import { SkBadge } from '../hud/SkBadge';
import { SkToggle } from '../hud/SkToggle';
import { useEditMode } from './editMode';

/**
 * "Edit": the painted switch, compact, with its word (docs/design/hud.md §5.13). On turns edit mode on, off
 * leaves it. Its splash rises over the page: it stands where nothing cuts it off (the stage tools on a phone,
 * the second line of a header elsewhere).
 */
export function EditToggle({ className }: { className?: string }) {
  const [editing, setEditing] = useEditMode();
  return (
    <SkToggle
      className={['edit-toggle', className].filter(Boolean).join(' ')}
      size="compact"
      label="Edit"
      title={editing ? 'Leave edit mode' : 'Edit mode: move and change objects'}
      checked={editing}
      onChange={setEditing}
    >
      Edit
    </SkToggle>
  );
}

/** Says that edit mode is on, wherever the toggle is out of sight. */
export function EditBadge() {
  const [editing] = useEditMode();
  // It pops in when edit mode starts and shrinks away when it ends (docs/design/hud.md §4.3).
  return (
    <SkBadge className="edit-badge" role="status" aria-label="Edit mode" shown={editing}>
      Edit mode
    </SkBadge>
  );
}
