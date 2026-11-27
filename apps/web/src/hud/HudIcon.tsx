import { sakuga } from './sakuga';
import type { IconName } from './SkIconButton';

/**
 * An ink-line icon in a control's text (docs/design/hud.md §3.2: the emoji go). Decoration: the control has the
 * name. Nothing where Sakuga did not run (jsdom, a failed load); the text says it all.
 */
export function HudIcon({ name }: { name: IconName }) {
  const markup = sakuga()?.icon?.(name);
  if (!markup) return null;
  return (
    <span className="hud-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
  );
}
