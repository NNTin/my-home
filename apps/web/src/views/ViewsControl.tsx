import { SkButton } from '../hud/SkButton';
import { SkField } from '../hud/SkField';
import { SkSegmented } from '../hud/SkSegmented';
import { SkSlider } from '../hud/SkSlider';
import type { HomeScene } from '../builder/buildHome';
import { BACKDROPS, type Backdrop } from '../lighting/rig';
import {
  defaultView,
  eyeRooms,
  LOOKS,
  sectionRange,
  VIEW_KINDS,
  type NamedView,
  type ViewKind,
} from './named';

/**
 * The "Views" control of the View panel (docs/design/realistic-render.md §7.1, §7.3): the named
 * views, what each can be set to, and the backdrop.
 */

const LABEL: Record<ViewKind, string> = {
  cutaway: 'Cutaway',
  section: 'Section',
  eye: 'Eye level',
};

const BACKDROP_LABEL: Record<Backdrop, string> = {
  sky: 'Sky',
  'studio-light': 'Studio, light',
  'studio-dark': 'Studio, dark',
};

const capital = (word: string) => word[0]!.toUpperCase() + word.slice(1);

export interface ViewsControlProps {
  scene: HomeScene;
  /** The named view whose look the scene has; undefined in the free view. */
  view: NamedView | undefined;
  /** Opens a named view, or with undefined goes back to the free view ("Reset view"). */
  onView(view: NamedView | undefined): void;
  backdrop: Backdrop;
  onBackdrop(backdrop: Backdrop): void;
  /** The level a cutaway opens on: the one being looked into. */
  levelId?: string | undefined;
  /** "Save image" (§7.4); `saving` while one is being drawn. */
  onSave(): void;
  saving: boolean;
  /**
   * "Render" (§9): turns render mode on and off. Not given where it is not offered: on a phone,
   * and while the view is a photo's.
   */
  onRender?: (() => void) | undefined;
  /** Render mode is on. */
  rendering?: boolean;
}

export function ViewsControl({
  scene,
  view,
  onView,
  backdrop,
  onBackdrop,
  levelId,
  onSave,
  saving,
  onRender,
  rendering = false,
}: ViewsControlProps) {
  const open = (kind: ViewKind) => {
    const next = defaultView(scene, kind, kind === 'cutaway' ? levelId : undefined);
    if (next) onView(next);
  };
  const rooms = eyeRooms(scene);
  return (
    <fieldset className="views-control">
      <legend>Views</legend>
      {/* One choice of four: a segmented row (docs/design/hud.md §4.4). */}
      <SkSegmented
        label="View"
        size="compact"
        className="views-choice"
        value={view?.kind ?? 'free'}
        options={[
          { value: 'free', label: 'Free' },
          ...VIEW_KINDS.map((kind) => ({ value: kind, label: LABEL[kind] })),
        ]}
        onChange={(kind) => (kind === 'free' ? onView(undefined) : open(kind))}
      />
      {view?.kind === 'cutaway' && (
        <label className="field">
          Level{' '}
          <SkField size="compact">
            <select
              value={view.levelId}
              onChange={(e) => onView({ kind: 'cutaway', levelId: e.target.value })}
            >
              {[...scene.levels].reverse().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </SkField>
        </label>
      )}
      {view?.kind === 'section' && (
        <>
          <label className="field">
            Looking{' '}
            <SkField size="compact">
              <select
                value={view.look}
                onChange={(e) => {
                  const look = LOOKS.find((l) => l === e.target.value) ?? view.look;
                  // The same share of the way through the house, seen from the new side.
                  const share = view.at / (sectionRange(scene, view.look).depth || 1);
                  onView({ kind: 'section', look, at: share * sectionRange(scene, look).depth });
                }}
              >
                {LOOKS.map((l) => (
                  <option key={l} value={l}>
                    {capital(l)}
                  </option>
                ))}
              </select>
            </SkField>
          </label>
          <div className="field cut-at">
            <span aria-hidden="true">Cut at</span>
            <SkSlider
              label="Cut at"
              min={0}
              max={Math.round(sectionRange(scene, view.look).depth * 100) / 100}
              step={0.05}
              unit=" m"
              value={view.at}
              onInput={(at) => onView({ ...view, at })}
            />
          </div>
        </>
      )}
      {view?.kind === 'eye' && rooms.length > 1 && (
        <label className="field">
          Room{' '}
          <SkField size="compact">
            <select
              value={view.roomId}
              onChange={(e) => {
                const next = defaultView(scene, 'eye', e.target.value);
                if (next) onView(next);
              }}
            >
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {r.name}
                </option>
              ))}
            </select>
          </SkField>
        </label>
      )}
      <label className="field">
        Backdrop{' '}
        <SkField size="compact">
          <select
            value={backdrop}
            onChange={(e) => onBackdrop(BACKDROPS.find((b) => b === e.target.value) ?? backdrop)}
          >
            {BACKDROPS.map((b) => (
              <option key={b} value={b}>
                {BACKDROP_LABEL[b]}
              </option>
            ))}
          </select>
        </SkField>
      </label>
      <div className="buttons">
        <SkButton variant="secondary" size="compact" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save image'}
        </SkButton>
        {onRender && (
          <SkButton size="compact" pressed={rendering} onClick={onRender}>
            Render
          </SkButton>
        )}
      </div>
    </fieldset>
  );
}
