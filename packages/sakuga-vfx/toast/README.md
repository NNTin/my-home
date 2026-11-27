# Toast

A notification that streaks in from the left as a smear, with speed lines behind it, lands in a cloud of dust with ズザッ in dotted letters, wobbles, and after a while leaves by shrinking.

## Run it

```sh
python3 -m http.server 8000     # from the repo folder
# open http://localhost:8000/toast/
```

## Use it

```html
<script src="toast.js"></script>
<sakuga-toast style="position: fixed; left: 24px; bottom: 24px"></sakuga-toast>
```

```js
el.show('Saved successfully!');
el.hide();
el.open;    // true while it is showing
```

| attribute | what it sets | default |
|---|---|---|
| `duration` | seconds it stays | 2.6 |
| `message` | the words when `show()` is given none | Saved successfully! |

- **Put the element where the toast should be.** It is 236 by 56 pixels and keeps that space while hidden; position it yourself, usually fixed in a corner.
- **The message is in a `role="status"` region,** so a screen reader reads it out. The ✕ is a real button.
- **One at a time.** Calling `show()` again replaces the message and plays the arrival again.

## Limits

- **No stack** of several toasts. Two kinds: the tick, and `kind="warn"` (made here).
- **Two lines** (made here; upstream had one). A longer message is cut off with an ellipsis.

## Made here (my-home, #168)

| attribute | what it sets |
|---|---|
| `kind="warn"` | a pink ! instead of the tick, a pink shadow, and the message in a `role="alert"` region |

The toast's width follows its text from 236 up to 320 pixels, and the message wraps to two lines before the ellipsis.
