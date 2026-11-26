# Render mode

Render mode makes one still of the view on screen by progressive path tracing: the only tier with bounce light,
and the only part of the app that uses WebGPU. The design is `docs/design/realistic-render.md` § 9.

## Making a still

On a desktop with a graphics card and a browser with WebGPU (current Chrome, Edge or Safari):

1. Choose the view: a named view (`docs/views.md`) or the free view, the backdrop, what is shown.
2. Press **Render** in the Views control. The still appears over the 3D view: first the view as it was, then
   the traced image, which gets cleaner as samples are added.
3. A line at the foot says how far it is: "Rendering: 96 of 256 samples, 23 s". It stops by itself at 256
   samples a pixel; **Stop** ends it sooner and keeps the image.
4. **Save image** saves the still as it is, as `my-home-<view>-render-<date>-<time>.png`. The button in the
   panel does the same while render mode is on.
5. **Close**, Escape or **Render** again goes back to the view, as it was.

While render mode is on, another view, another cut of a section, another backdrop, a level switched on or off,
or a resized window starts the still over. The 3D view under it cannot be turned: close render mode first.

What a still is:

- One pixel for each CSS pixel of the 3D view, at most 1920 wide. (The viewer's own "Save image" is twice
  the view.)
- The same home, furniture, finishes, sun, lamps and backdrop as the view it replaces. A section is cut for
  real: daylight falls into the cut rooms, and what is cut shows its dark face.
- Not in it: the grass tufts of the lawns, the compass letters, room names, markers and handles.

## Who gets it

- **No WebGPU, or WebGPU without a graphics card** (a "fallback adapter": headless Chromium, a virtual
  machine): **Render** answers with one sentence, "This browser cannot make path-traced renders". The view
  stays as it is and nothing is downloaded.
- **A phone:** the button is not there.
- Not over a photo's view ("view from here"), and not while walking.

The chunk `render-path` (the WebGPU renderer and the tracer, about 300 kB gzipped; at most 340 kB) is asked
for only after **Render** is pressed and the browser has said it has WebGPU on a graphics card.

## The measuring page

`/?render=measure` is the decision gate of the design: it measures how long this machine takes to a clean
still. On a desktop with a graphics card:

1. Open the link and leave the tab in front. The page traces the cutaway, the section and the eye-level view,
   one after the other, at 1920 x 1080 px to 256 samples a pixel. A view is given up after 180 s.
2. Each still appears under the canvas when its view is done, with "Save image".
3. At the end the page shows a table. "Copy the table" puts it on the clipboard as markdown: paste it into the
   issue, with the three images.

What the table says:

| Row or column                        | Meaning                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| WebGPU adapter, Graphics (WebGL)     | The graphics card as the browser names it, twice: the second has the model |
| `render-path`, gzipped as CI         | The chunk gzipped in the browser: the number the 340 kB budget is about    |
| `render-path`, as the server sent it | The bytes downloaded, compressed as the server chose (named if it says)    |
| `render-path`, uncompressed          | The chunk's files as they run                                              |
| Clean still                          | Seconds until the image was clean, and the samples it had then             |
| Sample target                        | Seconds to 256 samples a pixel, or what was reached at the time limit      |
| First sample                         | Seconds until the tracer had compiled and drawn anything                   |
| Gate (60 s)                          | `pass` when the view was clean within 60 s                                 |
| Pixels changed since the one before  | The share of pixels that changed by more than 4 of 255 levels              |

**Clean** is a number, so that two machines can be compared: the image is kept at 16, 32, 64, 128 and 256
samples, and it is clean at the first of these after which twice the samples change fewer than 1 % of its
pixels by more than 4 levels. Look at the stills as well: the number does not see a wrong colour.

**The chunk's three sizes.** The budget (`apps/web/bundle-budget.json`, D104) is the built files gzipped at
level 9, which CI measures (`pnpm check:bundle`). What a browser downloads is what the server sends: nginx
(`apps/web/nginx/default.conf.template`) gzips at its default level 1, which is about a fifth larger (356.9 kB
against 295.5 kB for the same file in #119). The page gzips the files once more in the browser, at level 6: about
a kilobyte over CI's number.

On a fast graphics card two of these sample counts can fall between two looks at the tracer (it is asked
five times a second). The image is then compared with one of a quarter of its samples instead of half: the
stricter test, so "clean" is never said too soon.

The address takes more, for trying things without a new build:

| Parameter       | Does                                                         | Default     |
| --------------- | ------------------------------------------------------------ | ----------- |
| `size=1280x720` | The image's size in pixels                                   | `1920x1080` |
| `samples=128`   | The sample target                                            | `256`       |
| `bounces=5`     | How often a path may scatter                                 | `8`         |
| `limit=300`     | Seconds after which a view is given up                       | `180`       |
| `kernel=mega`   | The tracer's other backend (one kernel instead of wavefront) | wavefront   |
| `views=eye`     | Only these fixed views, comma separated, in the fixed order  | all three   |
| `adapter=any`   | Lets a software WebGPU adapter through (also for **Render**) | refused     |

## For developers

| Part                                                            | File                                            | Chunk          |
| --------------------------------------------------------------- | ----------------------------------------------- | -------------- |
| The WebGPU check, the sentence                                  | `views/renderSupport.ts`                        | `render-views` |
| The "Render" button                                             | `views/ViewsControl.tsx`                        | `render-views` |
| The way in: the check, the chunk, what the frame is made of     | `views/RenderMode.tsx`                          | `render-views` |
| The camera of the frame on screen                               | `views/ImageExport.tsx`                         | `render-views` |
| `rendering`, the two refs, "Save image" while it is on          | `Viewer.tsx`                                    | main           |
| The still on screen: the line, "Stop", "Save image", "Close"    | `render-mode/RenderStill.tsx`                   | `render-path`  |
| One still: its canvas and tracer, starting over, the saved PNG  | `render-mode/still.ts`                          | `render-path`  |
| What is traced: meshes, materials, lights, studio, the backdrop | `render-mode/traceScene.ts`                     | `render-path`  |
| The cut of a section: clipping, caps                            | `render-mode/cut.ts`                            | `render-path`  |
| The studio as an equirectangular image                          | `render-mode/studio.ts`                         | `render-path`  |
| The renderer and the tracer                                     | `render-mode/tracer.ts`                         | `render-path`  |
| The gate: its arithmetic and report, its run, its page          | `render-mode/measure.ts`, `gate.ts`, `Gate.tsx` | `render-path`  |

- **`render-mode/tracer.ts` is the one file that knows the tracer.** Everything else is plain three.js and is
  tested in jsdom, with "Our home" and its seed (`traceScene.test.ts`).
- **The traced image cannot be made on the agents' machine or in CI.** Their Chromium has a WebGPU adapter,
  but it is SwiftShader: the tracer's kernels do not finish compiling on it, or the browser's GPU process dies.
  What a still looks like, and how long it takes, is the owner's check. `mobile-smoke` checks the rest on
  staging: the button, that the chunk is not asked for before the press, and the sentence.
- **A new object as `inputs` of `RenderStill` starts the still over.** `RenderMode` builds it in a `useMemo`:
  keep what it depends on to what the frame is made of, or a still restarts on every render of the viewer.
- **The viewer under the still is not stopped** (D102): it rests, and its one frame after a change of view is
  what shows through the empty canvas until the first sample.
- The tracer changes the geometry it is given (it adds tangents): it gets batches of its own, never the
  viewer's. Its materials are copies; its textures are the viewer's images, uploaded to its own device.
- The backdrop is not in the traced image: it is the CSS background of the canvas' box (D23), and is painted
  under the image when it is saved (`paintBackdrop`).
