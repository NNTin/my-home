import { SkFold } from '../hud/SkFold';

/** What a hand does on this device (HUD v2 #203: gesture help, in Tools). */
const TOUCH: [string, string][] = [
  ['One finger', 'turn the view'],
  ['Two fingers', 'pinch to zoom, drag to move'],
  ['Tap', 'select a room, an item, a window or a door'],
  ['In Edit: drag an item', 'move it; a long press opens its details'],
  ['Walk: the pad', 'walk and turn; drag the view to look'],
];
const POINTER: [string, string][] = [
  ['Drag', 'turn the view'],
  ['Right drag, or Shift and drag', 'move the view'],
  ['Wheel', 'zoom'],
  ['Click', 'select a room, an item, a window or a door'],
  ['In Edit: drag an item', 'move it; drag its ring to rotate it'],
];

const list = (rows: [string, string][]) => (
  <dl className="tools-help-list">
    {rows.map(([what, does]) => (
      <div key={what}>
        <dt>{what}</dt>
        <dd>{does}</dd>
      </div>
    ))}
  </dl>
);

/** Folded away until wanted: the hand's gestures for this device (§ Utility, "Tools"; touch instructions first). */
export function ToolsHelp({ touch }: { touch: boolean }) {
  // The keys are their own list beside it, with their settings (KeyboardShortcuts, #205).
  return (
    <SkFold className="toggle-group" size="compact" title="Gestures">
      {list(touch ? TOUCH : POINTER)}
    </SkFold>
  );
}
