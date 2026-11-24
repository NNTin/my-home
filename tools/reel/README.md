# My Home reel

The Remotion composition is a 30-second portrait edit at 1080 × 1920 and 30 fps.
The archived viewer captures are reproducible from Git and the private kitchen photo.

From a checkout containing the historical commits, create a temporary directory.
Use the project's photo-modelling workflow to download a kitchen reference into that
directory. The capture takes its metadata JSON and the WebP with the same filename.

```sh
cd tools/reel
npm ci
npx playwright install chromium
reel_tmp=/path/to/temporary-directory
npm run capture -- "$reel_tmp" "$reel_tmp/reference/photo-id.json"
node score.mjs "$reel_tmp/assets"
npm run render -- /path/to/my-home-reel.mp4 --public-dir "$reel_tmp/assets"
```

Capture uses temporary Git archives and their locked dependencies. The kitchen
motion compares `1da8338`, `287cc95`, `e49f812`, and `6820266` at matching camera
positions. The floor plan comes from `982af73`. The optional shot names after the
photo metadata path let you recapture individual assets. Keep the photo and
captured media outside Git.

To edit in Remotion Studio, run `npm run studio -- --public-dir "$reel_tmp/assets"`.
