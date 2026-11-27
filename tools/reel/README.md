# My Home reel

The composition is a 30-second square edit at 1080 × 1080 and 30 fps. It starts with the
mock and real home, turns from the souterrain layout to an elevation of both gardens,
compares historical kitchen renders, and closes with a walk and a moving section.

```sh
cd tools/reel
npm ci
npx playwright install chromium
reel_tmp="$(mktemp -d)"
npm run capture -- "$reel_tmp"
node score.mjs "$reel_tmp/frames"
npm run render -- /path/to/my-home-square.mp4 --public-dir "$reel_tmp/frames"
```

Capture renders the archived viewer frame by frame with a square canvas. The script
makes temporary Git archives and local API fixtures and needs the historical commits
listed in it. It writes PNGs only after the requested tier drew and textures arrived.
Its software capture uses the viewer's FXAA path and reduced-resolution ambient
occlusion with the full-resolution scene and textures. The walk keeps both rooms'
lamps eligible across the doorway. Those adjustments apply in the capture archives. On Linux with a working OpenGL
display, set `REEL_GL=mesa` to use that backend. The default uses headless SwiftShader.

Pass shot names after the temporary directory to capture one part of the edit. Set
`REEL_SAMPLE_FRAMES` to a comma-separated list of frame indices relative to each shot
for a proof. Unfinished shots resume from the PNGs already present. Recapture into a
fresh directory after changing a shot's path or rendering settings.

Use `npm run studio -- --public-dir "$reel_tmp/frames"` to edit with the captured frames.
Verify the final MP4 with the [video skill](../../.claude/skills/my-home-video/SKILL.md).
