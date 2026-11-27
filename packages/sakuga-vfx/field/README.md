# Field

Made for my-home (#168, `docs/design/hud.md` §5.3); not from upstream. A paper frame around a native control that has no
Sakuga element of its own: a `<select>`, an `<input>` of type number, date, color or file, or a `<textarea>`.

The control stays real and in the page, slotted: its value, its form, the phone's own pickers and a screen reader's
all work as they do. The element draws the frame and reacts:
- **Focus:** three wedges off the corner.
- **A change of a select, colour or date:** the frame gives a little, with two wedges and a small カチッ.
- **Typing:** the frame gives a little, and nothing is drawn.
- **Invalid:** a pink shadow and a !.

## Use it

```html
<script src="field.js"></script>
<sakuga-field label="Backdrop"><select aria-label="Backdrop">…</select></sakuga-field>
```

| attribute | what it sets |
|---|---|
| `label` | a caption inside the frame (the control keeps its own name) |
| `invalid` | the pink shadow and ! |
| `size="compact"` | 34 px, the compact line, effects at 0.7 |

- The width is `--sk-field-width` (230 px by default; the app sets 100 % in its panels).
- A select gets a chevron drawn in ink.

## Limits

- A page whose own CSS styles every `select` or `input` must leave a field's control alone (`:not(sakuga-field > *)`):
  page CSS wins over the element's `::slotted` styles.
