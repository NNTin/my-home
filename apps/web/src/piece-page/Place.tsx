import type { CatalogType, HomeModel, ParamValues } from '@my-home/shared';
import { useId, useState } from 'react';
import { placementsApi } from '../api';
import { furniture } from '../catalog/furniture';
import { createContext, createItem } from '../editor/operations';
import { toEditorItem } from '../placements/sync';
import { useEditMode } from '../editMode/editMode';
import { href, navigate } from '../routing';
import type { HomeData } from './uses';

/** The levels of a home that have rooms, in the model's order. */
const levelsWithRooms = (model: HomeModel) =>
  model.levels.filter((l) => model.rooms.some((r) => r.levelId === l.id));

const firstLevel = (model: HomeModel | undefined) =>
  model ? (levelsWithRooms(model)[0]?.id ?? '') : '';

const firstRoom = (model: HomeModel | undefined, levelId: string) =>
  model?.rooms.find((r) => r.levelId === levelId)?.id ?? '';

interface PlaceProps {
  type: CatalogType;
  homes: HomeData[];
  /** The playground's overrides: the new use starts with them. */
  params: ParamValues;
  defaultHomeId: string | undefined;
}

/** "Place" is offered in edit mode only (the piece page's header turns it on). */
export function Place(props: PlaceProps) {
  const [editing] = useEditMode();
  return editing ? <PlaceForm {...props} /> : null;
}

/**
 * "Place" for a furniture type: pick a home, a level and a room; the piece is put on a free spot
 * of that room (as the viewer's furniture panel places it) with the playground's values, then the
 * viewer opens on it to fine-tune the position and rotation.
 */
function PlaceForm({ type, homes, params, defaultHomeId }: PlaceProps) {
  const id = useId();
  const usable = homes.filter((h) => h.model && levelsWithRooms(h.model).length > 0);
  const start = usable.find((h) => h.home.id === defaultHomeId) ?? usable[0];
  const [open, setOpen] = useState(false);
  const [homeId, setHomeId] = useState(start?.home.id ?? '');
  const data = usable.find((h) => h.home.id === homeId);
  const model = data?.model;
  const [levelId, setLevelId] = useState(() => firstLevel(start?.model));
  const [roomId, setRoomId] = useState(() => firstRoom(start?.model, levelId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const chooseHome = (next: string) => {
    const m = usable.find((h) => h.home.id === next)?.model;
    const level = firstLevel(m);
    setHomeId(next);
    setLevelId(level);
    setRoomId(firstRoom(m, level));
  };
  const chooseLevel = (next: string) => {
    setLevelId(next);
    setRoomId(firstRoom(model, next));
  };

  const place = async () => {
    if (!data || !model) return;
    setBusy(true);
    setError(undefined);
    try {
      const ctx = createContext(model, furniture);
      const items = data.placements.filter((p) => p.removedAt === null).map(toEditorItem);
      const item = createItem(ctx, items, {
        id: 'new',
        typeId: type.id,
        levelId,
        ...(roomId !== '' && { roomId }),
        params,
      });
      const created = await placementsApi.create(homeId, {
        typeId: type.id,
        levelId,
        position: item.position,
        rotationY: item.rotationY,
        params,
      });
      navigate(href({ page: 'viewer' }, { home: homeId, focus: created.id, panel: 'furniture' }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="piece-section place" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Place</h2>
      {usable.length === 0 ? (
        <p>No home of this environment has a room to place it in.</p>
      ) : !open ? (
        <>
          <p className="piece-note">
            Put a {type.name.toLowerCase()} with the playground's values into a room, then move and
            turn it in the viewer.
          </p>
          <button type="button" className="button primary" onClick={() => setOpen(true)}>
            Place…
          </button>
        </>
      ) : (
        <form
          className="place-form"
          aria-label="Place"
          onSubmit={(e) => {
            e.preventDefault();
            void place();
          }}
        >
          <label className="field">
            Home
            <select value={homeId} onChange={(e) => chooseHome(e.target.value)}>
              {usable.map((h) => (
                <option key={h.home.id} value={h.home.id}>
                  {h.home.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Level
            <select value={levelId} onChange={(e) => chooseLevel(e.target.value)}>
              {model &&
                levelsWithRooms(model).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {model?.rooms
                .filter((r) => r.levelId === levelId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="buttons">
            <button type="submit" className="button primary" disabled={busy || levelId === ''}>
              {busy ? 'Placing…' : 'Place and open in the viewer'}
            </button>
            <button type="button" className="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
