import { useEffect, useRef } from 'react';
import type { HomeScene } from '../builder/buildHome';
import { roofIndex, showUpTo, type Visibility } from '../builder/visibility';
import { HudIcon } from '../hud/HudIcon';
import { SkButton } from '../hud/SkButton';
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

/** A single cutaway level chip opens the existing keyboard-operable Sakuga selector. */
export function LevelControl({
  scene,
  visibility,
  onChange,
  open,
  onToggle,
  onDismiss,
  tone,
}: {
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  open: boolean;
  onToggle(): void;
  onDismiss(): void;
  tone: 'dark' | 'light';
}) {
  const control = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const group = control.current?.querySelector('sakuga-segmented');
    (group?.shadowRoot ?? group)?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (control.current && !event.composedPath().includes(control.current)) onDismiss();
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open, onDismiss]);
  const roof = roofIndex(scene);
  // Top down like the building: the roof first, the lowest level last.
  const roofOption = { id: 'roof', name: 'Roof', label: 'Roof', index: roof };
  const options = [
    roofOption,
    ...[...scene.levels]
      .reverse()
      .map((l) => ({ id: l.id, name: l.name, label: shortLevelName(l.name), index: l.index })),
  ];
  const chosen =
    options.find((o) => o.index === Math.min(visibility.maxLevelIndex, roof)) ?? roofOption;
  return (
    <div className="hud-level" ref={control}>
      <SkButton
        className="hud-level-trigger"
        size="compact"
        variant="secondary"
        appearance="clear"
        expanded={open}
        tone={tone}
        backing
        aria-label={`Level: ${chosen.name}`}
        onClick={onToggle}
      >
        {chosen.label} <HudIcon name={open ? 'chevron-up' : 'chevron-down'} />
      </SkButton>
      {open && (
        <SkSegmented
          className="segmented"
          size="compact"
          label="Show up to level"
          value={chosen.id}
          options={options.map((o) => ({ value: o.id, label: o.label, name: o.name }))}
          onChange={(id) => {
            const o = options.find((x) => x.id === id);
            if (o) onChange(showUpTo(scene, visibility, o.index));
          }}
        />
      )}
    </div>
  );
}
