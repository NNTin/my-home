# The loading screen

While the app loads, a card with Sakuga VFX's progress bar (`<sakuga-progress>`, `packages/sakuga-vfx/progress`)
stands in the middle of the page. It replaced the plain "Loading home…" and "Loading…" texts (#166).

## It comes first

- `apps/web/index.html` holds the screen: `#boot`, the card and the element, with a small style of its own (the
  app's CSS comes with the main chunk).
- The build puts `progress.js` in `<head>` as a classic, blocking `<script>`, before the module entry
  (`sakugaProgress()` in `apps/web/vite.config.ts`). The file is copied as it is into
  `assets/sakuga-progress-<hash>.js` (cached for good, like every hashed asset); the dev server serves it from the
  package. So the element is defined before the parser reaches it, and the bar is on screen from the first
  paint, while the main chunk is still on its way. The browser fetches both at once.
- Upstream's rule holds: the file is loaded with a script tag, never bundled, split or rewritten
  (`packages/sakuga-vfx/AGENTS.md`).
- Its size has a budget of its own: `first` in `apps/web/bundle-budget.json` (25 kB gzipped; 21.0 kB in #166).
  `pnpm check:bundle` measures each classic script of `index.html` and prints the first load in all (index.html,
  those scripts, the main chunk and its CSS: 487.3 kB in #166, 464.6 kB before).

## It shows real progress only

`apps/web/src/loading/loading.ts` drives the bar once the main chunk runs. A load follows a **plan** of steps, each
worth part of the bar, and a step moves only when what it names has arrived, never on a timer:

| plan                         | step       | when it is done                                                                      | share |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------ | ----- |
| `viewer` (`/`)               | `app`      | the main chunk runs (the bar sits at 0 until then)                                   | 25 %  |
|                              | `homes`    | the list of homes has arrived                                                        | 5 %   |
|                              | `home`     | the home's document has arrived                                                      | 15 %  |
|                              | `views`    | the lazy chunk of the named views has arrived or failed                              | 5 %   |
|                              | `scene`    | the first frame is drawn (`scene/Frame.tsx`)                                         | 15 %  |
|                              | `textures` | the texture files the first frame asked for, arrived or failed, in part as they come | 35 %  |
| `page` (`/catalog`, a piece) | `app`      | the main chunk runs                                                                  | 50 %  |
|                              | `page`     | the page's lazy chunk has arrived                                                    | 50 %  |

- The bar is full when every step is done, and only then. A step never goes back.
- Once the first frame is drawn the dark backdrop goes, and the view is seen under the card while the textures
  come. The screen never catches a tap (`pointer-events: none`).
- At the end the bar plays its end (the burst, ドン! and the check). `HOLD_MS` later the card leaves by shrinking.
- A failure (an api error, no homes, an address with no page) takes the screen away at once, unfilled, with no
  end: the page says what went wrong. A step that never comes (no WebGL) lets it go after `GIVE_UP_MS`.
- A later load (the catalogue's chunk the first time it is opened, the viewer again after the catalogue) makes the
  screen again and starts from nothing.
- With reduced motion the bar still fills and says "Complete ✓"; its effects are off, and the screen goes as
  soon as it is full.

## A photo upload

The capture sheet (`walk/CaptureSheet.tsx`) shows the upload's bytes sent (`photosApi.upload`'s `onProgress`)
with the same bar, through `loading/SakugaProgress.tsx`. It stays after the photo is saved until it has played its
end, then shrinks away. Without `progress.js` (its script did not load, or in jsdom) it is the browser's own bar.

## The browser scripts

The HUD draws on canvases of its own (one over the page, one inside a control). The smokes and `screenshot.mjs`
name the scene's canvas with `SCENE` and wait for the screen to have gone (`loadingScreenGone`) before a shot:
`.claude/skills/my-home-environments/scripts/scene.mjs`. Each of `walk`, `mobile` and `catalog` checks that the
screen goes once the view or the page is in.
