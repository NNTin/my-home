import { useState, type KeyboardEvent } from 'react';
import { SkButton } from '../hud/SkButton';
import { SkIconButton } from '../hud/SkIconButton';
import { SkFold } from '../hud/SkFold';
import { SkInput } from '../hud/SkInput';
import { ACTIONS, chordOf, keyLabel, type Action, type ActionId } from '../keys/actions';
import {
  anyCustomized,
  conflictFor,
  customized,
  FIXED,
  persistent,
  reserved,
  resetAction,
  restoreAll,
  setSlot,
  SLOTS,
  slotsOf,
  useBindings,
} from '../keys/bindings';

/** What the capture is doing: listening on a slot, or holding a chord another action already has. */
type Capture =
  | { id: ActionId; slot: number; refused?: string }
  | { id: ActionId; slot: number; chord: string; other: Action };

const GROUPS = ['Viewer', 'Orbit', 'Walk', 'Edit'] as const;

/**
 * Tools → Keyboard shortcuts (HUD v2 #205, hotkeys.md § Discovery and configuration): every action with the keys that
 * apply, grouped by mode and searchable; a slot records the next key; clear, reset and restore all defaults; a key
 * another action of an overlapping mode has is offered back (retry) or taken from it (reassign) in one change.
 */
export function KeyboardShortcuts({ open = false }: { open?: boolean }) {
  useBindings();
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState<Capture>();
  const [confirmAll, setConfirmAll] = useState(false);
  const [resetClash, setResetClash] = useState<{ id: ActionId; other: Action }>();
  const q = query.trim().toLowerCase();
  const shown = ACTIONS.filter(
    (a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.group.toLowerCase().includes(q) ||
      slotsOf(a.id).some((c) => c && keyLabel(c).toLowerCase().includes(q)),
  );

  // The capture: the next key press on the slot, taken from the viewer (it is a setting, not a command).
  const record = (e: KeyboardEvent, id: ActionId, slot: number) => {
    if (!capture || 'chord' in capture || capture.id !== id || capture.slot !== slot) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setCapture(undefined);
    if (e.repeat || e.nativeEvent.isComposing) return;
    const chord = chordOf(e.nativeEvent);
    // A lone modifier: wait for the key it goes with.
    if (!chord) return;
    if (reserved(chord))
      return setCapture({ id, slot, refused: `${keyLabel(chord)} is the browser's or the page's` });
    const other = conflictFor(id, chord);
    if (other) return setCapture({ id, slot, chord, other });
    setSlot(id, slot, chord);
    setCapture(undefined);
  };

  const row = (a: Action) => {
    const slots = slotsOf(a.id);
    const fixed = FIXED.has(a.id);
    return (
      <div key={a.id} className="shortcut">
        <span className="shortcut-name">{a.name}</span>
        <span className="shortcut-slots">
          {Array.from({ length: SLOTS }, (_, i) => {
            const chord = slots[i];
            const listening = capture?.id === a.id && capture.slot === i && !('chord' in capture);
            const text = listening ? 'Press a key…' : chord ? keyLabel(chord) : '—';
            if (fixed) return i === 0 ? <kbd key={i}>{text}</kbd> : null;
            return (
              <span key={i} className="shortcut-slot">
                {/* The slot records the next key: its keydown and its focus leaving reach this span from the
                    button (sakuga-button) inside. */}
                <span
                  className="key-capture"
                  onKeyDown={(e) => record(e, a.id, i)}
                  onBlur={() => listening && setCapture(undefined)}
                >
                  <SkButton
                    className="key"
                    size="compact"
                    variant="secondary"
                    aria-label={`${a.name}, key ${i + 1}: ${chord ? keyLabel(chord) : 'none'}. Change`}
                    pressed={listening}
                    onClick={() => setCapture(listening ? undefined : { id: a.id, slot: i })}
                  >
                    {text}
                  </SkButton>
                </span>
                {chord && (
                  <SkIconButton
                    size="compact"
                    appearance="clear"
                    icon="close"
                    label={`Clear ${a.name}, key ${i + 1}`}
                    onClick={() => setSlot(a.id, i, null)}
                  />
                )}
              </span>
            );
          })}
          {fixed && <span className="note">fixed</span>}
          {!fixed && customized(a.id) && (
            <SkButton
              size="compact"
              variant="secondary"
              aria-label={`Reset ${a.name}`}
              onClick={() => {
                const other = resetAction(a.id);
                if (other) setResetClash({ id: a.id, other });
              }}
            >
              Reset
            </SkButton>
          )}
        </span>
        {capture?.id === a.id && 'refused' in capture && capture.refused && (
          <p className="warning" role="alert">
            {capture.refused}: press another key, or Escape.
          </p>
        )}
        {capture?.id === a.id && 'chord' in capture && (
          <p className="conflict" role="alert">
            {keyLabel(capture.chord)} is “{capture.other.name}” ({capture.other.group}).{' '}
            <SkButton
              size="compact"
              variant="secondary"
              onClick={() => setCapture({ id: a.id, slot: capture.slot })}
            >
              Retry
            </SkButton>{' '}
            <SkButton
              size="compact"
              variant="secondary"
              onClick={() => {
                // One change: the other action's slot is cleared as this one is written.
                setSlot(a.id, capture.slot, capture.chord, capture.other.id);
                setCapture(undefined);
              }}
            >
              Reassign
            </SkButton>
          </p>
        )}
        {resetClash?.id === a.id && (
          <p className="conflict" role="alert">
            Its default is “{resetClash.other.name}”’s now.{' '}
            <SkButton
              size="compact"
              variant="secondary"
              onClick={() => {
                // Its defaults back, taken from the other action in the same change.
                resetAction(a.id, true);
                setResetClash(undefined);
              }}
            >
              Reassign
            </SkButton>{' '}
            <SkButton size="compact" variant="secondary" onClick={() => setResetClash(undefined)}>
              Keep
            </SkButton>
          </p>
        )}
      </div>
    );
  };

  return (
    <SkFold
      className="toggle-group shortcuts"
      size="compact"
      title="Keyboard shortcuts"
      defaultOpen={open}
    >
      <SkInput
        label="Search the shortcuts"
        type="search"
        placeholder="An action or a key"
        value={query}
        onInput={setQuery}
      />
      {GROUPS.map((group) => {
        const actions = shown.filter((a) => a.group === group);
        return (
          actions.length > 0 && (
            <div key={group} className="shortcut-group" role="group" aria-label={group}>
              <h2>{group}</h2>
              {actions.map(row)}
            </div>
          )
        );
      })}
      {!persistent && (
        <p className="note">This browser cannot keep them: they last for this visit.</p>
      )}
      {confirmAll ? (
        <p className="conflict" role="alert">
          Restore every key to its default?{' '}
          <SkButton
            size="compact"
            variant="secondary"
            onClick={() => {
              restoreAll();
              setConfirmAll(false);
            }}
          >
            Restore
          </SkButton>{' '}
          <SkButton size="compact" variant="secondary" onClick={() => setConfirmAll(false)}>
            Keep mine
          </SkButton>
        </p>
      ) : (
        <SkButton
          className="shortcuts-restore"
          size="compact"
          variant="secondary"
          onClick={() => (anyCustomized() ? setConfirmAll(true) : restoreAll())}
        >
          Restore all defaults
        </SkButton>
      )}
    </SkFold>
  );
}
