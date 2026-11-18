# Tools

Everything is user-wide and outside the repository; nothing needs sudo. `scripts/tools.sh check` reports all of
it.

| Tool                              | Where                                                                                  | Needed for                                        | Install / check                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ImageMagick `convert`, `identify` | system (`/usr/bin`)                                                                    | `fetch.sh` (WebP → JPEG), `grid.sh`               | preinstalled on the NUC; `convert -version`                                                  |
| TrueType font                     | `/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf` (found with `fc-match`) | grid labels                                       | ImageMagick has no default font here; override with `MY_HOME_GRID_FONT`                      |
| `python3` (3.11, stdlib)          | system                                                                                 | `measure.py`                                      | always run with `python3 -I` (no PIL, no numpy needed)                                       |
| `jq`, `curl`                      | system                                                                                 | all scripts                                       |                                                                                              |
| Playwright 1.65.1 + Chromium      | `~/.cache/my-home-environments/playwright`, `~/.cache/ms-playwright`                   | `overlay-shots.sh`                                | `.claude/skills/my-home-environments/scripts/screenshot.sh --check` installs and verifies it |
| numpy + OpenCV (optional)         | `~/.cache/my-home-photo-tools/venv-cv` (`MY_HOME_PHOTO_TOOLS`)                         | line detection, PnP pose refinement, undistortion | `scripts/tools.sh install`, then `scripts/tools.sh check`                                    |

## The OpenCV venv (what `tools.sh install` does)

The NUC's Python has **no pip and no ensurepip**, so `python3 -m venv` fails. Bootstrap pip instead:

```sh
T=$HOME/.cache/my-home-photo-tools
mkdir -p $T/dl
python3 -m venv --without-pip $T/venv-cv
curl -fsSL https://bootstrap.pypa.io/get-pip.py -o $T/dl/get-pip.py
cd $T && ao-heavy $T/venv-cv/bin/python -I $T/dl/get-pip.py -q
ao-heavy $T/venv-cv/bin/python -I -m pip install -q --upgrade numpy opencv-python-headless
$T/venv-cv/bin/python -I -c "import numpy, cv2; print(numpy.__version__, cv2.__version__)"
```

Tested with numpy 2.4.6 and OpenCV 5.1.0. Use it for:

- `cv2.HoughLinesP` / `cv2.createLineSegmentDetector`, to find long straight edges for vanishing points;
- `cv2.solvePnP`, to refine a pose from 4+ known room corners (pixel ↔ model points);
- `cv2.undistort` when wide-angle distortion matters.

Run heavy OpenCV jobs through `ao-heavy`, with at most 2 threads (`OMP_NUM_THREADS=2`, `cv2.setNumThreads(2)`).

## Not useful here

- `exiftool`: uploads have no EXIF (the server re-encodes them to WebP).
- COLMAP or other multi-view reconstruction: too few overlapping photos, and too heavy for the NUC's budget.
  Single-view calibration with known sizes is enough for ±5–15 cm.
