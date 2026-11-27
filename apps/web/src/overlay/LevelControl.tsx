import type { HomeScene } from '../builder/buildHome';
import { roofIndex, showUpTo, type Visibility } from '../builder/visibility';
import { SkSegmented } from '../hud/SkSegmented';

/**
 * A level's name for a narrow button: "First floor (attic)" becomes "Attic" and "Ground floor"
 * becomes "Ground". The full name stays the button's accessible name.
 */
export function shortLevelName(name: string): string {
  const bracketed = /\(([^)]+)\)\s*$/.exec(name)?.[1];
  const short = (bracketed ?? name.replace(/\s+floor$/i, '')).trim();
  return short === '' ? name : short.charAt(0).toUpperCase() + short.slice(1);
}

/**
 * The cutaway level, "Show up to level": a compact segmented row (docs/design/hud.md §4.1), one tab stop, the
 * arrow keys. The same control in the phone's top bar and the desktop's upper left corner (HUD v2 #200, V14).
 */
export function LevelControl({
  scene,
  visibility,
  onChange,
}: {
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
}) {
  const roof = roofIndex(scene);
  // Top down like the building: the roof first, the lowest level last.
  const options = [
    { id: 'roof', name: 'Roof', label: 'Roof', index: roof },
    ...[...scene.levels]
      .reverse()
      .map((l) => ({ id: l.id, name: l.name, label: shortLevelName(l.name), index: l.index })),
  ];
  const chosen = Math.min(visibility.maxLevelIndex, roof);
  return (
    <SkSegmented
      className="segmented"
      size="compact"
      label="Show up to level"
      value={options.find((o) => o.index === chosen)?.id ?? 'roof'}
      options={options.map((o) => ({ value: o.id, label: o.label, name: o.name }))}
      onChange={(id) => {
        const o = options.find((x) => x.id === id);
        if (o) onChange(showUpTo(scene, visibility, o.index));
      }}
    />
  );
}
