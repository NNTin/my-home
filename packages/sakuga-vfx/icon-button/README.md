# Icon Button

Made for my-home (#168, `docs/design/hud.md` §5.1), not from upstream. A square paper button with an ink-line icon, for
rows of tools: the furniture toolbar, the look buttons, the sheet's size and close.

Press and it squashes, keeping its volume. Let go and three pink wedges fly off its corner, or the way it points
(`dir`); a turn draws a crescent around it, sweeping the way it turns; `hit="puff"` leaves a puff where the icon was
(Delete). It springs back with one overshoot. **No word:** these come in rows and in repeats (five taps on ▲).

## Run it

```sh
python3 -m http.server 8000     # from packages/sakuga-vfx
# open http://localhost:8000/icon-button/
```

## Use it

```html
<script src="icon-button.js"></script>
<script src="../icons/icons.js"></script>
<sakuga-icon-button label="Rotate left" icon="rotate-left" dir="ccw"></sakuga-icon-button>
```

| attribute | what it sets | default |
|---|---|---|
| `label` | the accessible name (**required**: there is no text) | the icon's name |
| `icon` | a named icon from `icons/icons.js`; or slot an `<svg>` | none |
| `dir` | where the wedges go: `up`, `down`, `left`, `right`; `cw` or `ccw` draws a crescent | the top right corner |
| `hit="puff"` | a puff where the icon was instead of wedges | |
| `size="compact"` | 34 px (a 44 px hit area inside the shadow root), effects at 0.7 | 44 px |
| `href` | a real link (`<a>`); no `href` while disabled | |
| `pressed` | a toggle button: `aria-pressed`, an ink fill with a card-coloured icon | |
| `disabled` | half strength, no shadow, no effects | |

- It fires an ordinary `click`. `disabled` and `pressed` are properties too; set from code they change at once and
  play nothing.
- The icon is `aria-hidden`; the inner `<button>` (or `<a>`) has `aria-label` from `label`.

## Limits

- `icons.js` must load after a component file (it needs `window.SakugaFX`). An icon button on a page whose icons come
  later waits for the document to finish loading before it draws its icon.
- The crescent of `dir="cw|ccw"` is drawn over the button's top corner only.
