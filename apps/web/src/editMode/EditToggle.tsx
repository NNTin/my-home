import { useEditMode } from './editMode';

/** "Edit" turns edit mode on, "Done" leaves it. */
export function EditToggle({ className }: { className?: string }) {
  const [editing, setEditing] = useEditMode();
  return (
    <button
      type="button"
      className={['edit-toggle', className].filter(Boolean).join(' ')}
      aria-pressed={editing}
      title={editing ? 'Leave edit mode' : 'Edit mode: move and change objects'}
      onClick={() => setEditing(!editing)}
    >
      <span aria-hidden="true">{editing ? '✔' : '✏️'}</span> {editing ? 'Done' : 'Edit'}
    </button>
  );
}

/** Says that edit mode is on, wherever the toggle is out of sight. */
export function EditBadge() {
  const [editing] = useEditMode();
  if (!editing) return null;
  return (
    <p className="edit-badge" role="status" aria-label="Edit mode">
      ✏️ Edit mode
    </p>
  );
}
