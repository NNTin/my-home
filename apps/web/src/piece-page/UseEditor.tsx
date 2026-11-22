import {
  ApiError,
  effectiveParams,
  openingFitIssues,
  type CatalogType,
  type HomeModel,
  type ParamValues,
  type Use,
} from '@my-home/shared';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { ApiRequestError, openingOverridesApi, placementsApi } from '../api';
import { BasicControl } from './Playground';
import { overrideSummary, contextOfUse } from './uses';

/** The overrides the type still takes (ignored keys are dropped: saving them would be refused). */
export function savableOverrides(type: CatalogType, overrides: ParamValues): ParamValues {
  const { ignored } = effectiveParams(type, overrides);
  return Object.fromEntries(Object.entries(overrides).filter(([k]) => !ignored.includes(k)));
}

/** Equal overrides, whatever the key order. */
export function sameOverrides(a: ParamValues, b: ParamValues): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

type Failure =
  | { kind: 'fit'; issues: string[] }
  | { kind: 'conflict' }
  | { kind: 'reloaded' }
  | { kind: 'error'; message: string };

const failureOf = (err: unknown): Failure => {
  if (err instanceof ApiRequestError) {
    if (err.status === 409) return { kind: 'conflict' };
    const body = ApiError.safeParse(err.body);
    if (err.status === 422 && body.success) {
      return {
        kind: 'fit',
        issues: body.data.issues?.map((i) => i.message) ?? [body.data.message],
      };
    }
  }
  return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
};

interface Props {
  type: CatalogType;
  homeId: string;
  use: Use;
  model: HomeModel | undefined;
  /** The unsaved values (undefined: none, the form shows the saved ones). */
  draft: ParamValues | undefined;
  onDraft: Dispatch<SetStateAction<ParamValues | undefined>>;
  /**
   * Loads the home's uses again (after a write, or to see what changed elsewhere); false when that
   * failed and the use shown is the one from before.
   */
  onReload(): Promise<boolean>;
}

/**
 * The basic parameters of one use, saved to this environment's database: the playground's
 * controls, initialised with the use's values, each marked as overridden or the type default.
 * Furniture can also be renamed and moved to the trash.
 */
export function UseEditor({ type, homeId, use, model, draft, onDraft, onReload }: Props) {
  const saved = savableOverrides(type, use.overrides);
  const current = draft ?? saved;
  const values = effectiveParams(type, current).values;
  const dirty = !sameOverrides(current, saved);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [name, setName] = useState(use.name);
  // A placement (furniture or a fixture): PATCH, rename and remove; a git use: its override.
  const placed = use.source === 'db';
  const hole = contextOfUse(type, values, model, use.id);
  const issues =
    type.kind === 'openings' && type.placement !== 'fence'
      ? openingFitIssues(type, values, hole)
      : [];
  const basic = Object.entries(type.params).filter(([, spec]) => spec.tier === 'basic');

  const set = (key: string, value: string | number) => {
    setFailure(undefined);
    onDraft({ ...current, [key]: value });
  };
  const reset = (key: string) => {
    setFailure(undefined);
    onDraft(Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)));
  };

  const write = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      // Without a fresh copy the form keeps its values: they are what was saved.
      if (await onReload()) after?.();
      setFailure(undefined);
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    write(
      () =>
        placed
          ? placementsApi.update(homeId, use.id, { version: use.version, params: current })
          : openingOverridesApi.put(homeId, use.id, { version: use.version, params: current }),
      // Edits and use switches replace the draft object: acknowledge only this revision.
      () => onDraft((latest) => (latest === draft ? undefined : latest)),
    );

  const reload = async () => {
    setBusy(true);
    try {
      await onReload();
      setFailure({ kind: 'reloaded' });
    } catch (err) {
      setFailure(failureOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="use-editor" aria-label={`Edit ${use.name}`}>
      {basic.length === 0 && <p>This type has no basic parameters.</p>}
      {basic.map(([key, spec]) => {
        const overridden = key in current;
        return (
          <div key={key} className={overridden ? 'use-param overridden' : 'use-param'}>
            <BasicControl spec={spec} value={values[key]!} onChange={(v) => set(key, v)} />
            <p className="use-param-source">
              {overridden ? (
                <>
                  <span>Overridden</span>{' '}
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Reset ${spec.label.toLowerCase()} to type default`}
                    onClick={() => reset(key)}
                  >
                    Reset to type default
                  </button>
                </>
              ) : (
                <span>Type default</span>
              )}
            </p>
          </div>
        );
      })}
      {issues.length > 0 && (
        <ul className="fit-issues" role="status" aria-label="Does not fit">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {failure?.kind === 'fit' && (
        <ul className="fit-issues" role="alert" aria-label="Not saved">
          {failure.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {failure?.kind === 'conflict' && (
        <div className="use-conflict" role="alert">
          <p>Changed elsewhere: this use was saved by someone else since it was loaded.</p>
          <button type="button" className="button" disabled={busy} onClick={() => void reload()}>
            Reload (keeps your values)
          </button>
        </div>
      )}
      {failure?.kind === 'reloaded' && (
        <p className="use-conflict" role="status">
          Saved now:{' '}
          {overrideSummary(type, saved)
            .map((o) => o.text)
            .join(', ') || 'type defaults'}
          . Your unsaved values are kept below; Save replaces the saved ones.
        </p>
      )}
      {failure?.kind === 'error' && (
        <p className="error" role="alert">
          {failure.message}
        </p>
      )}
      <div className="buttons">
        <button
          type="button"
          className="button primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          type="button"
          className="button"
          disabled={!dirty || busy}
          onClick={() => {
            setFailure(undefined);
            onDraft(undefined);
          }}
        >
          Discard changes
        </button>
      </div>
      {placed && (
        <div className="use-furniture">
          <label className="field">
            Name
            <input
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="buttons">
            <button
              type="button"
              className="button"
              disabled={busy || name.trim() === '' || name.trim() === use.name}
              onClick={() =>
                void write(() =>
                  placementsApi.update(homeId, use.id, { version: use.version, name: name.trim() }),
                )
              }
            >
              Rename
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void write(() => placementsApi.remove(homeId, use.id, use.version))}
            >
              Remove (to the trash)
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
