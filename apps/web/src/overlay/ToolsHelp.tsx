import { ACTIONS, keyLabel } from '../keys/actions';
import { SkFold } from '../hud/SkFold';

/** What a hand does on this device, and the keys (HUD v2 #203: gesture help and shortcut discovery, in Tools). */
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
/** The keys, from the one action list (keys/actions.ts, #204): what the dispatcher does is what the help says. */
const KEYS: [string, string][] = ACTIONS.map((a) => [
  a.keys.map(keyLabel).join(' or '),
  a.group === 'Viewer' ? a.name : `${a.name} (${a.group})`,
]);

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

/** Folded away until wanted: the hand's gestures for this device, then the keys (§ Utility, "Tools"). */
export function ToolsHelp({ touch, open = false }: { touch: boolean; open?: boolean }) {
  return (
    <SkFold className="toggle-group" size="compact" title="Gestures and keys" defaultOpen={open}>
      {list(touch ? TOUCH : POINTER)}
      {/* The keys for a keyboard; their settings come with #205 (Shortcut settings), next to this. */}
      {list(KEYS)}
    </SkFold>
  );
}
