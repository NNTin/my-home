import {
  catalog,
  effectiveParams,
  openingFitIssues,
  type CatalogType,
  type ParamValues,
  type TypeId,
} from '@my-home/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { previewContext } from '../catalog-page/preview';
import { pieces } from '../catalog/registry';
import { useLayoutMode } from '../overlay/useLayoutMode';
import { href, keptQuery, Link, navigate, useDocumentTitle, useRestoredScroll } from '../routing';
import { Inspector } from './Inspector';
import { Notes } from './Notes';
import { PhotoList } from './Photos';
import { Place } from './Place';
import { decodeOverrides, encodeOverrides } from './playground';
import { DesignParams, Playground } from './Playground';
import { floorOf, sectionLabels, sectionOf, wallStub } from './section';
import { SectionView } from './SectionView';
import { savableOverrides } from './UseEditor';
import { Uses, type OpenUse } from './Uses';
import { contextOfUse, hashedUseId, hashOfUse, photosOfType, rowId, type HomeData } from './uses';
import { useWhereUsed, type WhereUsedState } from './useWhereUsed';
import './piece.css';

const KIND_NAMES = { openings: 'Windows & doors', furniture: 'Furniture' } as const;
const FAMILY_NAMES = {
  window: 'Window',
  door: 'Door',
  gate: 'Gate',
  furniture: 'Furniture',
} as const;

/** "Windows & doors · Window", "Furniture · Bed room". */
const kindLine = (type: CatalogType) =>
  [
    KIND_NAMES[type.kind],
    FAMILY_NAMES[type.family] === KIND_NAMES[type.kind] ? undefined : FAMILY_NAMES[type.family],
    type.category,
  ]
    .filter(Boolean)
    .join(' · ');

/** The `?p=` of the address: a shared playground state. */
const sharedOverrides = (type: CatalogType) =>
  decodeOverrides(type, new URLSearchParams(window.location.search).get('p'));

/** Waits this long after the last change before the address follows the playground. */
const ADDRESS_DELAY = 400;

/**
 * Keeps `?p=` in step with the playground (replacing the history entry, after a pause, so a slider
 * does not flood the history API), next to the kept `?home=`.
 */
function useSharedOverrides(type: CatalogType, overrides: ParamValues) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = { ...keptQuery(), p: encodeOverrides(overrides) };
      // The `#use=` anchor stays.
      const to = href({ page: 'piece', kind: type.kind, typeId: type.id }, query);
      navigate(to + window.location.hash, { replace: true });
    }, ADDRESS_DELAY);
    return () => window.clearTimeout(timer);
  }, [type, overrides]);
}

/** The use a `#use=` anchor asks for; its home is found once the uses are loaded. */
type RequestedUse = Omit<OpenUse, 'homeId'> & { homeId?: string };

const requestedByHash = (): RequestedUse | undefined => {
  const useId = hashedUseId(window.location.hash);
  return useId === undefined ? undefined : { useId, panel: 'edit' };
};

/** The home of a requested use: the given one, else `?home=` if it has it, else the first. */
function resolveOpen(
  requested: RequestedUse | undefined,
  state: WhereUsedState,
): OpenUse | undefined {
  if (!requested) return undefined;
  if (requested.homeId !== undefined) return { ...requested, homeId: requested.homeId };
  if (state.status !== 'ready') return undefined;
  const having = state.homes.filter((h) => h.uses.some((u) => u.id === requested.useId));
  const home = having.find((h) => h.home.id === keptQuery().home) ?? having[0];
  return home && { ...requested, homeId: home.home.id };
}

/** Writes (or clears) the `#use=` anchor without a new history entry. */
const writeHash = (useId: string | undefined) =>
  navigate(`${window.location.pathname}${window.location.search}${useId ? hashOfUse(useId) : ''}`, {
    replace: true,
  });

/** The type's photos (its own and its uses') and its notes, environment-wide. */
function TypePhotosNotes({ type, homes }: { type: CatalogType; homes: HomeData[] | undefined }) {
  return (
    <section className="piece-section photos-notes" aria-labelledby="photos-notes-title">
      <h2 id="photos-notes-title">Photos &amp; notes</h2>
      <h3>Photos</h3>
      {homes ? (
        <PhotoList photos={photosOfType(type.id, homes)} label={`Photos of ${type.name}`} />
      ) : (
        <p>Loading the photos…</p>
      )}
      <Notes subject={{ kind: 'type', id: type.id }} />
    </section>
  );
}

/** Phones (a coarse pointer) get the capped pixel ratio of the viewer. */
const isTouch = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * `/catalog/<kind>/<typeId>`: one piece type in 3D (and, for openings, in section), its
 * dimensions in cm and a playground for its basic parameters (nothing there is saved). Below:
 * Place (furniture), where-used with each use's editor, history, photos and notes, and the type's
 * own photos and notes. `#use=<useId>` opens a use.
 */
export default function PiecePage({ typeId }: { typeId: TypeId }) {
  const type = catalog.get(typeId);
  useDocumentTitle(type?.name);
  const layout = useLayoutMode();
  if (!type) return null;
  return <Piece type={type} layout={layout} />;
}

function Piece({ type, layout }: { type: CatalogType; layout: ReturnType<typeof useLayoutMode> }) {
  const piece = pieces.get(type.id)!;
  const [overrides, setOverrides] = useState(() => sharedOverrides(type));
  const [view, setView] = useState<'3d' | 'section'>('3d');
  const [showDimensions, setShowDimensions] = useState(true);
  const resetRef = useRef<() => void>(undefined);
  useSharedOverrides(type, overrides);
  useRestoredScroll();
  const { state, reload } = useWhereUsed(type);
  const [requested, setRequested] = useState(requestedByHash);
  /** The unsaved values of the open use's editor. */
  const [draft, setDraft] = useState<ParamValues>();
  const open = resolveOpen(requested, state);
  const openUse = (next: OpenUse | undefined) => {
    setRequested(next);
    setDraft(undefined);
    writeHash(next?.useId);
  };

  // A `#use=` anchor opens that use and scrolls to it: on the first load and when it changes.
  const scrollTo = useRef(requested?.useId);
  useEffect(() => {
    const onHash = () => {
      const next = requestedByHash();
      if (next?.useId === undefined) return;
      scrollTo.current = next.useId;
      setRequested(next);
      setDraft(undefined);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!open || scrollTo.current !== open.useId) return;
    const row = document.getElementById(rowId(open.homeId, open.useId));
    if (!row) return;
    scrollTo.current = undefined;
    row.scrollIntoView?.({ block: 'start' });
  });

  /** The open use, previewed with its real hole or size and the editor's values. */
  const [openHome, openId] = [open?.homeId, open?.useId];
  const shown = useMemo(() => {
    if (openId === undefined || state.status !== 'ready') return undefined;
    const data = state.homes.find((h) => h.home.id === openHome);
    const use = data?.uses.find((u) => u.id === openId);
    return data && use ? { data, use } : undefined;
  }, [openHome, openId, state]);

  const opening = type.kind === 'openings';
  const stub = type.placement === 'wall' ? 'wall' : 'none';
  const scene = useMemo(() => {
    const values = effectiveParams(
      type,
      shown ? (draft ?? savableOverrides(type, shown.use.overrides)) : overrides,
    ).values;
    const ctx = shown
      ? contextOfUse(type, values, shown.data.model, shown.use.id)
      : previewContext(type, values);
    const parts = piece.parts(values, ctx);
    const section = opening
      ? sectionOf(parts, ctx, { stub, own: piece.section?.(values, ctx) })
      : [];
    return {
      values,
      ctx,
      parts,
      lines: piece.dimensions(values, ctx),
      context: stub === 'wall' ? wallStub(ctx) : [],
      section,
      sectionLabels: opening ? sectionLabels(section, ctx, { stub }) : [],
      issues: opening ? openingFitIssues(type, values, ctx) : [],
    };
  }, [type, piece, overrides, opening, stub, shown, draft]);

  // Wall openings stand on the floor under the sill, furniture and gates on the ground at 0.
  const ground = stub === 'wall' ? floorOf(scene.ctx) : type.placement === 'roof' ? undefined : 0;
  const home = keptQuery();
  const phone = layout !== 'desktop';

  return (
    <div className={`page piece-page ${phone ? `mobile ${layout}` : 'desktop'}`}>
      <header className="page-header">
        <Link className="page-back" to={href({ page: 'catalog' }, home)}>
          ← Catalogue
        </Link>
        <h1>
          <span aria-hidden="true">{type.icon}</span> {type.name}
        </h1>
        <p className="piece-kind">{kindLine(type)}</p>
      </header>
      <main className="page-main">
        <p className="piece-description">{type.description}</p>
        <div className="piece-layout">
          <section className="piece-stage" aria-label="Preview">
            {opening && (
              <div className="piece-views" role="group" aria-label="View">
                <button type="button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
                  3D
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'section'}
                  onClick={() => setView('section')}
                >
                  Section
                </button>
              </div>
            )}
            {shown && (
              <p className="piece-showing" role="status">
                Showing <strong>{shown.use.name}</strong> ({shown.use.where})
                {opening && shown.use.source === 'git' ? ' in its real opening' : ''}
                {draft ? ', with unsaved changes' : ''}.
              </p>
            )}
            <div className="piece-viewport">
              {view === 'section' ? (
                <SectionView
                  shapes={scene.section}
                  labels={scene.sectionLabels}
                  floor={stub === 'wall' ? floorOf(scene.ctx) : undefined}
                />
              ) : (
                <Inspector
                  parts={scene.parts}
                  context={scene.context}
                  lines={scene.lines}
                  showDimensions={showDimensions}
                  ground={ground}
                  touch={isTouch()}
                  resetRef={resetRef}
                />
              )}
            </div>
            {view === '3d' && (
              <div className="piece-tools">
                <button type="button" className="button" onClick={() => resetRef.current?.()}>
                  Reset view
                </button>
                <label className="piece-toggle">
                  <input
                    type="checkbox"
                    checked={showDimensions}
                    onChange={(e) => setShowDimensions(e.target.checked)}
                  />
                  Dimensions
                </label>
              </div>
            )}
            <h2 id="dimensions-title">Dimensions</h2>
            <dl className="piece-dimensions" aria-labelledby="dimensions-title">
              {scene.lines.map((line, i) => (
                <div key={i}>
                  <dt>{line.name ?? `Dimension ${i + 1}`}</dt>
                  <dd>{line.label}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="piece-panel">
            <Playground
              type={type}
              values={scene.values}
              overrides={overrides}
              issues={scene.issues}
              onChange={setOverrides}
            />
            <DesignParams type={type} values={scene.values} />
            {type.kind === 'furniture' && state.status === 'ready' && (
              <Place type={type} homes={state.homes} params={overrides} defaultHomeId={home.home} />
            )}
            <Uses
              type={type}
              state={state}
              reload={reload}
              open={open}
              onOpen={openUse}
              draft={draft}
              onDraft={setDraft}
            />
            <TypePhotosNotes
              type={type}
              homes={state.status === 'ready' ? state.homes : undefined}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
