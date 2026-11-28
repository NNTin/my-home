import type { PlacementMounting } from '@my-home/shared';
import { SkCheckbox } from '../hud/SkCheckbox';
import { SkField } from '../hud/SkField';
import { useState } from 'react';
import type { EditorSettings } from '../editor/operations';
import type { FurnitureCategory } from '../catalog/furniture';
import type { SyncState, SyncStatus } from '../placements/sync';
import { Link } from '../routing';
import { SkPanel } from '../hud/SkPanel';

export interface SelectedInfo {
  name: string;
  /** The type's name, e.g. "Bed". */
  typeName: string;
  where: string;
  problems: string[];
  /** Its piece page, on this use. */
  href: string;
  /** What it is fixed to, and what its type allows. */
  mounting: PlacementMounting;
  mountings: PlacementMounting[];
  /** Height of its bottom above the floor, in metres (0 under a ceiling). */
  elevation: number;
  /** Where it starts above the floor: the elevation, or the ceiling it hangs at. */
  hangsAt: number;
}

/** A selected window, door, roof window or gate. */
export interface PieceInfo {
  name: string;
  typeName: string;
  href: string;
  /** The spaces an opening links ("Living room", "outside"), where the model's rooms say so (#201). */
  between?: string[];
}

/** A selected room (HUD v2 #201): picked on its floor in view mode. */
export interface RoomInfo {
  name: string;
  levelName: string;
  apartmentName?: string | undefined;
  /** Frames the room and cuts away to its level. */
  onFocus(): void;
}

export interface FlaggedItem {
  id: string;
  label: string;
  problems: string[];
  /** The item has no usable level and can be moved to the current one. */
  canRelocate: boolean;
}

interface Props {
  /** Edit mode: without it the panel only shows, nothing in it changes the furniture. */
  editing: boolean;
  /** The placements are loading, or failed to load. */
  loading: boolean;
  error: string | undefined;
  sync: SyncState;
  levelName: string;
  rooms: { id: string; name: string }[];
  roomId: string | undefined;
  onRoomChange(id: string): void;
  categories: FurnitureCategory[];
  onPlace(typeId: string): void;
  selected: SelectedInfo | undefined;
  piece: PieceInfo | undefined;
  room?: RoomInfo | undefined;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onRotate(steps: number): void;
  onDuplicate(): void;
  onDelete(): void;
  /** Sets the selected item's height above the floor, in metres. */
  onElevation(elevation: number): void;
  onMounting(mounting: PlacementMounting): void;
  settings: EditorSettings;
  onSettings(settings: EditorSettings): void;
  flagged: FlaggedItem[];
  onSelectItem(id: string): void;
  onRelocate(id: string): void;
}

const statusText: Record<SyncStatus, string> = {
  saved: 'All changes saved',
  pending: 'Unsaved changes…',
  saving: 'Saving…',
  offline: 'Offline: changes kept in this browser, retrying',
  rejected: 'Not saved: the server refused a change; the item is back as it was',
  conflict: 'Changed elsewhere',
};

/** "Open piece page" for the selected piece: its type's page, on this use. */
export function PieceLink({ href, name }: { href: string; name: string }) {
  return (
    <Link className="button piece-link" to={href} aria-label={`Open piece page: ${name}`}>
      Open piece page
    </Link>
  );
}

const degrees = (rad: number) => Math.round((rad * 180) / Math.PI);
const cm = (m: number) => Math.round(m * 100);

const mountingLabel: Record<PlacementMounting, string> = {
  floor: 'On the floor',
  wall: 'On a wall',
  ceiling: 'Under the ceiling',
};

/**
 * The height of the item's bottom above the floor in centimetres: typed freely, saved (one edit,
 * one undo step) on Enter or when the field loses focus.
 */
function HeightField({ value, onChange }: { value: number; onChange(metres: number): void }) {
  const [draft, setDraft] = useState<string>();
  const commit = () => {
    if (draft === undefined) return;
    const next = Number(draft);
    setDraft(undefined);
    if (draft.trim() !== '' && Number.isFinite(next) && next !== cm(value)) onChange(next / 100);
  };
  return (
    <label className="field">
      Height above the floor{' '}
      <SkField size="compact">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft ?? String(cm(value))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            // The editor's shortcuts (Delete, R …) must not act while typing a height.
            e.stopPropagation();
          }}
          aria-label="Height above the floor in cm"
        />
      </SkField>{' '}
      cm
    </label>
  );
}

/** How the selected item is mounted: on the floor or a wall, and its height (or its ceiling's). */
function Mounting({ selected, props }: { selected: SelectedInfo; props: Props }) {
  return (
    <div className="mounting">
      {selected.mountings.length > 1 && (
        <label className="field">
          Mounting{' '}
          <SkField size="compact">
            <select
              value={selected.mounting}
              onChange={(e) => props.onMounting(e.target.value as PlacementMounting)}
            >
              {selected.mountings.map((m) => (
                <option key={m} value={m}>
                  {mountingLabel[m]}
                </option>
              ))}
            </select>
          </SkField>
        </label>
      )}
      {selected.mounting === 'ceiling' ? (
        <p className="note">Hangs at the ceiling, {cm(selected.hangsAt)} cm above the floor.</p>
      ) : (
        <HeightField value={selected.elevation} onChange={props.onElevation} />
      )}
    </div>
  );
}
const rotationSteps = [90, 45, 15, 0];

export function FurniturePanel(props: Props) {
  const { sync, settings, selected, piece } = props;
  const set = (patch: Partial<EditorSettings>) => props.onSettings({ ...settings, ...patch });

  return (
    <SkPanel className="overlay panel panel-right" label="Furniture">
      <h1>Furniture</h1>
      <p className={`save-status ${sync.status}`} role="status">
        {props.loading ? 'Loading furniture…' : statusText[sync.status]}
      </p>
      {(sync.status === 'rejected' || sync.status === 'offline') && sync.error && (
        <p className="error">{sync.error}</p>
      )}
      {sync.restored && sync.status !== 'saved' && (
        <p className="note">Restored unsaved changes from this browser.</p>
      )}
      {sync.status === 'conflict' && (
        <p className="conflict" role="alert">
          Changed elsewhere (by an agent or another tab), reloaded:{' '}
          {sync.changedElsewhere?.join(', ')}
        </p>
      )}
      {props.error && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}

      {!props.editing && (
        <p className="note">
          View mode: furniture cannot be moved or changed. Press Edit to place, move or change it.
        </p>
      )}

      {props.editing && (
        <fieldset>
          <legend>Add to {props.levelName}</legend>
          {props.rooms.length > 0 && (
            <label className="field">
              Room{' '}
              <SkField size="compact">
                <select
                  value={props.roomId ?? ''}
                  onChange={(e) => props.onRoomChange(e.target.value)}
                >
                  {props.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </SkField>
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
                  disabled={props.loading || props.error !== undefined}
                >
                  <span aria-hidden="true">{t.icon}</span> {t.name}
                </button>
              ))}
            </div>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>{props.editing ? 'Edit' : 'Selection'}</legend>
        {props.editing && (
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
        )}
        {selected ? (
          <div className="selection" aria-label="Selected item">
            <p>
              <strong>{selected.name}</strong> ({selected.typeName}) {selected.where}
            </p>
            {selected.problems.map((p) => (
              <p key={p} className="error">
                {p}
              </p>
            ))}
            {props.editing && <Mounting selected={selected} props={props} />}
            <div className="buttons">
              {props.editing && (
                <>
                  <button type="button" onClick={() => props.onRotate(1)} title="R">
                    Rotate ⟲
                  </button>
                  <button type="button" onClick={() => props.onRotate(-1)} title="Shift+R">
                    Rotate ⟳
                  </button>
                  <button type="button" onClick={props.onDuplicate} title="Shift+D">
                    Duplicate
                  </button>
                  <button type="button" onClick={props.onDelete} title="Delete">
                    Delete
                  </button>
                </>
              )}
              <PieceLink href={selected.href} name={selected.name} />
            </div>
          </div>
        ) : piece ? (
          <div className="selection piece-chip" aria-label="Selected piece">
            <p>
              <strong>{piece.name}</strong> ({piece.typeName})
            </p>
            {piece.between && piece.between.length > 0 && (
              <p className="note">Between {piece.between.join(' and ')}</p>
            )}
            <div className="buttons">
              <PieceLink href={piece.href} name={piece.name} />
            </div>
          </div>
        ) : props.room ? (
          <div className="selection room-chip" aria-label="Selected room">
            <p>
              <strong>{props.room.name}</strong> ({props.room.levelName}
              {props.room.apartmentName ? ` · ${props.room.apartmentName}` : ''})
            </p>
            <div className="buttons">
              <button type="button" onClick={props.room.onFocus}>
                Focus room
              </button>
            </div>
          </div>
        ) : (
          <p className="note">
            {props.editing
              ? 'Click an item to select it; drag to move (a wall cabinet along its wall), drag the ring to rotate. Click a window, door or gate to open its piece page.'
              : 'Click an item, window, door, gate or a room’s floor to see what it is.'}
          </p>
        )}
        {props.editing && (
          <>
            <SkCheckbox
              className="toggle"
              size="compact"
              checked={settings.grid}
              onChange={() => set({ grid: !settings.grid })}
            >
              Snap to {Math.round(settings.gridStep * 100)} cm grid
            </SkCheckbox>
            <SkCheckbox
              className="toggle"
              size="compact"
              checked={settings.wallSnap}
              onChange={() => set({ wallSnap: !settings.wallSnap })}
            >
              Snap to walls
            </SkCheckbox>
            <label className="field">
              Rotation step{' '}
              <SkField size="compact">
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
              </SkField>
            </label>
          </>
        )}
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
    </SkPanel>
  );
}
