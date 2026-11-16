import { useRef } from 'react';
import type { EditorSettings } from '../editor/operations';
import type { CatalogCategory } from '../items/registry';
import type { LayoutsController } from '../layouts/useLayouts';
import type { SaveStatus } from '../layouts/saver';

export interface SelectedInfo {
  name: string;
  where: string;
  problems: string[];
}

export interface FlaggedItem {
  id: string;
  label: string;
  problems: string[];
  /** The item has no usable level and can be moved to the current one. */
  canRelocate: boolean;
}

interface Props {
  layouts: LayoutsController;
  levelName: string;
  rooms: { id: string; name: string }[];
  roomId: string | undefined;
  onRoomChange(id: string): void;
  categories: CatalogCategory[];
  onPlace(typeId: string): void;
  selected: SelectedInfo | undefined;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onRotate(steps: number): void;
  onDuplicate(): void;
  onDelete(): void;
  settings: EditorSettings;
  onSettings(settings: EditorSettings): void;
  flagged: FlaggedItem[];
  onSelectItem(id: string): void;
  onRelocate(id: string): void;
}

const statusText: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes…',
  saving: 'Saving…',
  offline: 'Offline: changes kept in this browser, retrying',
  rejected: 'Not saved: the server rejected the changes (kept in this browser)',
  conflict: 'Changed elsewhere',
};

const degrees = (rad: number) => Math.round((rad * 180) / Math.PI);
const rotationSteps = [90, 45, 15, 0];

export function FurniturePanel(props: Props) {
  const { layouts, settings, selected } = props;
  const { saveState, actions } = layouts;
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<EditorSettings>) => props.onSettings({ ...settings, ...patch });

  return (
    <section className="overlay panel panel-right" aria-label="Furniture">
      <h1>Furniture</h1>

      <fieldset>
        <legend>Layout</legend>
        <label className="field">
          Layout{' '}
          <select
            value={layouts.activeId ?? ''}
            onChange={(e) => void actions.open(e.target.value)}
            disabled={layouts.loading}
          >
            {layouts.layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Name{' '}
          <input
            type="text"
            value={layouts.name}
            maxLength={200}
            onChange={(e) => actions.rename(e.target.value)}
            disabled={!layouts.activeId}
          />
        </label>
        <div className="buttons">
          <button type="button" onClick={() => void actions.create()}>
            New
          </button>
          <button
            type="button"
            onClick={() => void actions.duplicate()}
            disabled={!layouts.activeId}
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete layout "${layouts.name}"?`)) void actions.remove();
            }}
            disabled={!layouts.activeId}
          >
            Delete
          </button>
        </div>
        <div className="buttons">
          {actions.exportUrl && (
            <a className="button" href={actions.exportUrl} download>
              Export
            </a>
          )}
          <button type="button" onClick={() => fileInput.current?.click()}>
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import layout file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void actions.importFile(file);
            }}
          />
        </div>
        <p className={`save-status ${saveState.status}`} role="status">
          {statusText[saveState.status]}
        </p>
        {saveState.status === 'rejected' && saveState.error && (
          <p className="error">{saveState.error}</p>
        )}
        {saveState.restored && saveState.status !== 'saved' && (
          <p className="note">Restored unsaved changes from this browser.</p>
        )}
        {saveState.status === 'conflict' && (
          <div className="conflict" role="alert">
            <p>This layout was changed elsewhere. Your edits are kept in this browser.</p>
            <div className="buttons">
              <button type="button" onClick={() => void actions.reload()}>
                Reload server copy
              </button>
              <button type="button" onClick={() => void actions.overwrite()}>
                Overwrite with mine
              </button>
            </div>
          </div>
        )}
        {layouts.error && (
          <p className="error" role="alert">
            {layouts.error}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Add to {props.levelName}</legend>
        {props.rooms.length > 0 && (
          <label className="field">
            Room{' '}
            <select value={props.roomId ?? ''} onChange={(e) => props.onRoomChange(e.target.value)}>
              {props.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {props.categories.map((c) => (
          <div key={c.name} className="catalog-group" role="group" aria-label={c.name}>
            <h2>{c.name}</h2>
            {c.types.map((t) => (
              <button
                key={t.id}
                type="button"
                className="catalog-item"
                title={t.description}
                onClick={() => props.onPlace(t.id)}
                disabled={!layouts.activeId}
              >
                <span aria-hidden="true">{t.icon}</span> {t.name}
              </button>
            ))}
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Edit</legend>
        <div className="buttons">
          <button type="button" onClick={props.onUndo} disabled={!props.canUndo} title="Ctrl+Z">
            Undo
          </button>
          <button
            type="button"
            onClick={props.onRedo}
            disabled={!props.canRedo}
            title="Ctrl+Shift+Z"
          >
            Redo
          </button>
        </div>
        {selected ? (
          <div className="selection" aria-label="Selected item">
            <p>
              <strong>{selected.name}</strong> {selected.where}
            </p>
            {selected.problems.map((p) => (
              <p key={p} className="error">
                {p}
              </p>
            ))}
            <div className="buttons">
              <button type="button" onClick={() => props.onRotate(1)} title="R">
                Rotate ⟲
              </button>
              <button type="button" onClick={() => props.onRotate(-1)} title="Shift+R">
                Rotate ⟳
              </button>
              <button type="button" onClick={props.onDuplicate} title="Ctrl+D">
                Duplicate
              </button>
              <button type="button" onClick={props.onDelete} title="Delete">
                Delete
              </button>
            </div>
          </div>
        ) : (
          <p className="note">Click an item to select it; drag to move, drag the ring to rotate.</p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.grid}
            onChange={() => set({ grid: !settings.grid })}
          />{' '}
          Snap to {Math.round(settings.gridStep * 100)} cm grid
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.wallSnap}
            onChange={() => set({ wallSnap: !settings.wallSnap })}
          />{' '}
          Snap to walls
        </label>
        <label className="field">
          Rotation step{' '}
          <select
            value={degrees(settings.rotationStep)}
            onChange={(e) => set({ rotationStep: (Number(e.target.value) * Math.PI) / 180 })}
          >
            {rotationSteps.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'Free' : `${d}°`}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {props.flagged.length > 0 && (
        <fieldset>
          <legend>Needs attention</legend>
          <ul className="flagged">
            {props.flagged.map((f) => (
              <li key={f.id}>
                <button type="button" className="link" onClick={() => props.onSelectItem(f.id)}>
                  {f.label}
                </button>
                : {f.problems.join(', ')}
                {f.canRelocate && (
                  <>
                    {' '}
                    <button type="button" onClick={() => props.onRelocate(f.id)}>
                      Move to {props.levelName}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </section>
  );
}
