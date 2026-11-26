# Render mode

Render mode makes one still of a view by progressive path tracing: the only tier with bounce light, and the only
part of the app that uses WebGPU. The design is `docs/design/realistic-render.md` § 9. It is built in two parts
(#119): first a measurement that decides which tracer it uses, then the "Render" button. **Only the measurement
exists so far.**

## The measuring page

`/?render=measure`, on a desktop with a graphics card and a browser with WebGPU (current Chrome, Edge or
Safari).

1. Open the link and leave the tab in front. The page traces the cutaway, the section and the eye-level view,
   one after the other, at 1920 x 1080 px to 256 samples a pixel. A view is given up after 180 s.
2. Each still appears under the canvas when its view is done, with "Save image".
3. At the end the page shows a table. "Copy the table" puts it on the clipboard as markdown: paste it into the
   issue, with the three images.

What the table says:

| Row or column                       | Meaning                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------- |
| WebGPU adapter, Graphics (WebGL)    | The graphics card as the browser names it, twice: the second has the model |
| `render-path` chunk                 | The lazy chunk's size as this browser downloaded it                        |
| Clean still                         | Seconds until the image was clean, and the samples it had then             |
| Sample target                       | Seconds to 256 samples a pixel, or what was reached at the time limit      |
| First sample                        | Seconds until the tracer had compiled and drawn anything                   |
| Gate (60 s)                         | `pass` when the view was clean within 60 s                                 |
| Pixels changed since the one before | The share of pixels that changed by more than 4 of 255 levels              |

**Clean** is a number, so that two machines can be compared: the image is kept at 16, 32, 64, 128 and 256
samples, and it is clean at the first of these after which twice the samples change fewer than 1 % of its
pixels by more than 4 levels. Look at the stills as well: the number does not see a wrong colour.

The address takes more, for trying things without a new build:

| Parameter       | Does                                                         | Default     |
| --------------- | ------------------------------------------------------------ | ----------- |
| `size=1280x720` | The image's size in pixels                                   | `1920x1080` |
| `samples=128`   | The sample target                                            | `256`       |
| `bounces=5`     | How often a path may scatter                                 | `8`         |
| `limit=300`     | Seconds after which a view is given up                       | `180`       |
| `kernel=mega`   | The tracer's other backend (one kernel instead of wavefront) | wavefront   |
| `adapter=any`   | Lets a software WebGPU adapter through                       | refused     |

## Who gets it

- **No WebGPU, or WebGPU without a graphics card** (a "fallback adapter": headless Chromium, a virtual
  machine): one sentence, "This browser cannot make path-traced renders", and nothing is downloaded.
- **A phone:** the same sentence. Render mode is for desktops.

The chunk `render-path` (the WebGPU renderer and the tracer, about 294 kB gzipped) is asked for only after
the browser has said it has WebGPU on a graphics card.

## For developers

| Part                                              | File                                | Chunk          |
| ------------------------------------------------- | ----------------------------------- | -------------- |
| The WebGPU check, the sentence                    | `views/renderSupport.ts`            | `render-views` |
| The way in (`?render=measure`), loads the chunk   | `views/RenderMode.tsx`              | `render-views` |
| What is traced: meshes, materials, lights, studio | `render-mode/traceScene.ts`         | `render-path`  |
| The cut of a section: clipping, caps              | `render-mode/cut.ts`                | `render-path`  |
| The studio as an equirectangular image            | `render-mode/studio.ts`             | `render-path`  |
| The renderer and the tracer                       | `render-mode/tracer.ts`             | `render-path`  |
| The gate: its arithmetic and report, its run      | `render-mode/measure.ts`, `gate.ts` | `render-path`  |
| The measuring page                                | `render-mode/Gate.tsx`              | `render-path`  |

- Everything but `tracer.ts` and the page is plain three.js and is tested in jsdom, with "Our home" and its
  seed (`traceScene.test.ts`).
- **The traced image cannot be made on the agents' machine or in CI.** Their Chromium has a WebGPU adapter,
  but it is SwiftShader: the tracer's kernels do not finish compiling on it, or the browser's GPU process dies.
  What a still looks like is the owner's check.
- The tracer changes the geometry it is given (it adds tangents): it gets batches of its own, never the
  viewer's.
