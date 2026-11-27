# Badge

Made for my-home (#168, `docs/design/hud.md` §5.12), not from upstream. A small paper chip for a status ("Saving…",
"Saved"), a count (the open photo requests) or a notice.

It **pops in** from 0.4 on a spring with one overshoot and a puff; **squashes once** when its text changes; with `done`
a pink **check draws** itself with a glint; and it **leaves by shrinking** to nothing, never by fading. **No word:** a
status changes often.

## Run it

```sh
python3 -m http.server 8000     # from packages/sakuga-vfx
# open http://localhost:8000/badge/
```

## Use it

```html
<script src="badge.js"></script>
<sakuga-badge shown>Saving…</sakuga-badge>
<sakuga-badge count="3" label="3 requested" shown></sakuga-badge>
```

| attribute | what it sets |
|---|---|
| `shown` | there or not. As the page is built it just appears (or not); changed later, it pops in or shrinks away. Also a property |
| `kind="warn"` | a pink ! before the text and a pink shadow; `role="alert"` |
| `count` | a pink disc with the number. A higher number pops it with a puff, a lower one squashes it |
| `label` | with `count`: its accessible name (`role="img"`); without one the count is decoration (`aria-hidden`) |
| `done` | the check draws with a glint; removed, the check goes |
| `duration` | seconds: it leaves by itself that long after it arrived or its text changed. A new text brings it back while `shown` |

- The text is the element's content: change it and the badge squashes.
- `role="status"` (or `alert` with `kind="warn"`) unless the page gave it a role; `aria-hidden` while it is away.

## Limits

- One line: a long text is cut off with an ellipsis (give the host a `max-width`).
- Gone, it takes no room, but the host element stays in the page.
