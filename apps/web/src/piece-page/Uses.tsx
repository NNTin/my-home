import type { CatalogType, ParamValues, Placement } from '@my-home/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { placementsApi } from '../api';
import { href, Link } from '../routing';
import { History } from './History';
import { Notes } from './Notes';
import { UsePhotos } from './Photos';
import { useEditMode } from '../editMode/editMode';
import { UseEditor } from './UseEditor';
import {
  overrideSummary,
  photosOfUse,
  requestsOfUse,
  rowId,
  whereUsed,
  type HomeData,
  type UseRow,
} from './uses';
import type { WhereUsedState } from './useWhereUsed';

/** The use whose row is open, and which of its panels. */
export interface OpenUse {
  homeId: string;
  useId: string;
  panel: 'edit' | 'history';
}

interface RowProps {
  type: CatalogType;
  row: UseRow;
  data: HomeData;
  attention: boolean;
  open: OpenUse | undefined;
  onOpen(open: OpenUse | undefined): void;
  draft: ParamValues | undefined;
  onDraft: Dispatch<SetStateAction<ParamValues | undefined>>;
  reload(homeId: string): Promise<boolean>;
}

function UseItem({ type, row, data, attention, open, onOpen, draft, onDraft, reload }: RowProps) {
  const { use, homeId, orphan } = row;
  const [editing] = useEditMode();
  const [error, setError] = useState<string>();
  const isOpen = open?.homeId === homeId && open.useId === use.id;
  // Without edit mode the editor is not offered: a use opened for editing shows its history.
  const panel = isOpen ? (open.panel === 'edit' && !editing ? 'history' : open.panel) : undefined;
  const toggle = (next: OpenUse['panel']) =>
    onOpen(panel === next ? undefined : { homeId, useId: use.id, panel: next });
  const photos = photosOfUse(data.photos, use.id);
  const requests = requestsOfUse(data.requests, use.id);
  const summary = overrideSummary(type, use.overrides);
  const roomName = (id: string) => data.model?.rooms.find((r) => r.id === id)?.name;
  const placement = use.source === 'db';

  const remove = async () => {
    try {
      await placementsApi.remove(homeId, use.id, use.version);
      await reload(homeId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <li id={rowId(homeId, use.id)} className={isOpen ? 'use-row open' : 'use-row'}>
      <div className="use-head">
        <h5 className="use-name">{use.name}</h5>
        <p className="use-where">{use.where}</p>
        <p className="use-overrides" aria-label="Overrides">
          {summary.length === 0
            ? 'Type defaults'
            : summary.map((o) => (
                <span key={o.key} className="use-override">
                  {o.color && (
                    <span className="swatch" style={{ background: o.color }} aria-hidden="true" />
                  )}
                  {o.text}
                </span>
              ))}
        </p>
        {(photos.length > 0 || requests.length > 0) && (
          <p className="use-counts">
            {photos.length > 0 && `📷 ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
            {photos.length > 0 && requests.length > 0 && ' · '}
            {requests.length > 0 &&
              `${requests.length} photo request${requests.length === 1 ? '' : 's'}`}
          </p>
        )}
        {use.problems.length > 0 && (
          <ul className="use-problems" aria-label="Problems">
            {use.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="use-actions">
        {!orphan && (
          <Link
            className="button"
            to={href({ page: 'viewer' }, { home: homeId, focus: use.id })}
            aria-label={`Show ${use.name} in model`}
          >
            Show in model
          </Link>
        )}
        {!orphan && editing && (
          <button
            type="button"
            className="button"
            aria-pressed={panel === 'edit'}
            aria-label={`Edit ${use.name}`}
            onClick={() => toggle('edit')}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="button"
          aria-pressed={panel === 'history'}
          aria-label={`${attention ? 'Show history' : 'History'} of ${use.name}`}
          onClick={() => toggle('history')}
        >
          {attention ? 'Show history' : 'History'}
        </button>
        {attention && placement && editing && (
          <button
            type="button"
            className="button"
            aria-label={`Remove ${use.name} (to the trash)`}
            onClick={() => void remove()}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isOpen && (
        <div className="use-body">
          {panel === 'edit' ? (
            <UseEditor
              key={use.id}
              type={type}
              homeId={homeId}
              use={use}
              model={data.model}
              draft={draft}
              onDraft={onDraft}
              onReload={() => reload(homeId)}
            />
          ) : (
            <History
              homeId={homeId}
              useId={use.id}
              refreshKey={`${use.version}:${use.updatedAt ?? ''}`}
              onUndone={() => reload(homeId)}
              canUndo={editing}
            />
          )}
          <UsePhotos
            homeId={homeId}
            use={use}
            photos={data.photos}
            requests={data.requests}
            roomName={roomName}
            onChanged={() => reload(homeId)}
          />
          <Notes subject={{ kind: 'use', id: use.id }} homeId={homeId} />
        </div>
      )}
    </li>
  );
}

const until = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

function Trash({
  homeId,
  trash,
  reload,
}: {
  homeId: string;
  trash: Placement[];
  reload(homeId: string): Promise<boolean>;
}) {
  const [editing] = useEditMode();
  const [error, setError] = useState<string>();
  const restore = async (p: Placement) => {
    try {
      await placementsApi.restore(homeId, p.id);
      await reload(homeId);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <details className="use-trash">
      <summary>In the trash ({trash.length})</summary>
      <ul>
        {trash.map((p) => (
          <li key={p.id}>
            {p.name} <span className="piece-note">until {until(p.purgeAt)}</span>{' '}
            {editing && (
              <button
                type="button"
                className="button"
                aria-label={`Restore ${p.name}`}
                onClick={() => void restore(p)}
              >
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

/**
 * Where-used: every use of the type in this environment, grouped by home and level, with what each
 * overrides, links to the model and, per use, the editor, the history, photos and notes. Uses
 * that need attention come first; nothing is deleted from here.
 */
export function Uses({
  type,
  state,
  reload,
  open,
  onOpen,
  draft,
  onDraft,
}: {
  type: CatalogType;
  state: WhereUsedState;
  reload(homeId: string): Promise<boolean>;
  open: OpenUse | undefined;
  onOpen(open: OpenUse | undefined): void;
  draft: ParamValues | undefined;
  onDraft: Dispatch<SetStateAction<ParamValues | undefined>>;
}) {
  const used = state.status === 'ready' ? whereUsed(type, state.homes) : undefined;
  const byHome = new Map(state.status === 'ready' ? state.homes.map((h) => [h.home.id, h]) : []);
  const item = (row: UseRow, attention: boolean) => (
    <UseItem
      key={`${row.homeId}/${row.use.id}`}
      type={type}
      row={row}
      data={byHome.get(row.homeId)!}
      attention={attention}
      open={open}
      onOpen={onOpen}
      draft={draft}
      onDraft={onDraft}
      reload={reload}
    />
  );
  return (
    <section className="piece-section uses" aria-labelledby="uses-title">
      <h2 id="uses-title">Uses</h2>
      {state.status === 'loading' && <p>Loading the uses…</p>}
      {state.status === 'error' && (
        <p className="error" role="alert">
          The uses could not be loaded: {state.message}
        </p>
      )}
      {used && (
        <>
          <p className="uses-count">
            {used.count} use{used.count === 1 ? '' : 's'} in this environment
          </p>
          {used.attention.length > 0 && (
            <section className="uses-attention" aria-labelledby="attention-title">
              <h3 id="attention-title">Needs attention</h3>
              <ul className="use-list">{used.attention.map((row) => item(row, true))}</ul>
            </section>
          )}
          {used.homes.map(({ data, levels, trash }) => (
            <details key={data.home.id} className="uses-home" open>
              <summary>
                <h3>{data.home.name}</h3>
              </summary>
              {data.error && (
                <p className="error" role="alert">
                  {data.error}
                </p>
              )}
              {data.notice && (
                <p className="piece-note uses-notice" role="status">
                  Saved, but the list could not be refreshed ({data.notice}): it may be out of date.
                  Reload the page to see the latest.
                </p>
              )}
              {!data.error && levels.length === 0 && trash.length === 0 && (
                <p className="piece-note">Not used in this home.</p>
              )}
              {levels.map((level) => (
                <section key={level.id} className="uses-level" aria-label={level.name}>
                  <h4 className="uses-level-name">{level.name}</h4>
                  <ul className="use-list">{level.rows.map((row) => item(row, false))}</ul>
                </section>
              ))}
              {trash.length > 0 && <Trash homeId={data.home.id} trash={trash} reload={reload} />}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
