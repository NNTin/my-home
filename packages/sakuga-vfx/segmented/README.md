# Segmented

Made for my-home (#168, `docs/design/hud.md` §5.2), from upstream's tabs; not from upstream. One choice of a few short
values, as a row: the quality, the level, the named views.

The chosen one is a raised piece filled with the primary tone. Pick another and the piece slides there, stretching
with its speed, and lands with wedges above it, a puff on the side it came from, speed lines and a small カチッ. The
pressed segment squashes. Set from code, it moves at once and plays nothing.

## Use it

```html
<script src="segmented.js"></script>
<sakuga-segmented label="Quality">
  <option value="fast">Fast</option><option value="auto" selected>Auto</option>
</sakuga-segmented>
```

| attribute or property | what it is |
|---|---|
| `label` | the group's name (`role="radiogroup"`) |
| `value` | the chosen option's value; set it from code to move without effects |
| `size="compact"` | the phone's bars: 13 px type, the compact line, effects at 0.7 |
| `disabled` | every choice off |
| an option's `label` | the name read out when its words are shorter ("Attic" read "First floor (attic)") |

- It fires `change` with `detail: { index, value, label }`.
- One tab stop. The arrow keys move and wrap; Home and End go to the ends.
- The options are read again when they change (a home with other levels).

## Limits

- Short words only. A long one is cut off with an ellipsis; its name stays whole.
