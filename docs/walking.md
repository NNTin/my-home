# Walking and taking photos

A virtual figure walks through the home. The owner steers it on the phone to where they really stand, turns it
the same way, and takes a photo: the photo is stored with the figure's pose ([photos.md](photos.md)).

Start with **Walk and take photos** in the view controls, or open the viewer with `?walk=first` or `?walk=third`.

## Controls

|              | Phone                                        | Desktop                                  |
| ------------ | -------------------------------------------- | ---------------------------------------- |
| Walk         | movement pad: push up or down                | `W` `S` or `↑` `↓`                       |
| Turn         | movement pad: push left or right             | `Q` `E` or `←` `→`                       |
| Sidestep     |                                              | `A` `D`                                  |
| Look around  | drag on the view (first person)              | drag on the view with the mouse          |
| Switch view  | **Overview** / **First person**              | the same                                 |
| Take a photo | the camera button (opens the phone's camera) | the camera button (opens a file chooser) |

The pad both walks and turns, so one thumb is enough in portrait. In first person the camera is the figure's
eyes; the whole building is drawn and room names are hidden. In the overview the camera orbits the figure
(drag and pinch as usual) and the **cutaway follows the figure's level**, so you look into the floor it is on;
outdoors the whole building shows.

The 🧭 button (on devices with orientation sensors) turns the figure with the phone's compass, using the plan's
`northBearing`. Compasses are easily a few degrees off indoors, so check the view before saving.

## What blocks the figure

The rules live in [`apps/web/src/walk/world.ts`](../apps/web/src/walk/world.ts), pure geometry with unit tests on
the real home:

- **Surfaces carry it**: level floors, stair treads, terrain patches and outbuilding floors. It stands on the
  highest surface within one step (0.4 m) of its feet. That makes stairs, outdoor steps and gentle slopes work;
  a higher drop, a void (the stairwell seen from above) or a slope steeper than about 31° stops it. Under a stair
  flight it needs headroom.
- **Blockers stop it**: walls, fences, outbuilding walls and the furniture of the active layout, wherever they
  overlap its body in height. **Doorways are open** (`door` and `french-door` openings; windows and garage doors
  are not), a boundary without a wall (kitchen to corridor) needs nothing, and a fence of kind `gate` is open.
- It slides along what it touches instead of sticking.

The figure is 0.44 m wide and 1.7 m tall with its eyes at 1.6 m. It starts just inside the first entrance that
is a door (`apartments[].entrances`), else at an entrance stair, else in a room of the lowest level.

Level changes come from the stair treads alone: half-way up, the figure counts as being on the upper level, and
the cutaway and the photo's `levelId` follow.

## Taking a photo

1. Walk to where you stand and look the way you look. Press the camera button and take the photo.
2. The sheet shows the photo, where the figure is, a note field and tags. The arrow buttons move the figure by
   10 cm or turn and tilt it by 5°, for fine corrections.
3. **Save photo** uploads it with the figure's pose **at that moment**: position (eye height), yaw, pitch, level
   and the camera's horizontal field of view. A progress bar shows the upload; if it fails, the photo and the
   note stay and **Try again** repeats it.
4. Afterwards **Update pose** corrects the pose of the saved photo from the figure's current pose.

When an agent or the owner has [asked for a photo](photos.md#photo-requests), the spot shows as a translucent
ghost figure and the request's question appears when the figure reaches it. The sheet then offers "Answers the
request"; saving with it ticked fulfils the request. See [Browsing photos](photos.md#browsing-photos).

Before the upload the browser scales the photo to at most 2560 px and re-encodes it, which keeps uploads around
1 MB and already drops the file's metadata; the api strips metadata again. The field of view comes from the
35 mm focal length in the photo's EXIF data when present (the only value read from it), otherwise from a
typical phone camera (26 mm).

## Code

| Part                                  | Where                                                               |
| ------------------------------------- | ------------------------------------------------------------------- |
| Walkable world, collision, start pose | `apps/web/src/walk/world.ts`                                        |
| Figure, input mapping, pose maths     | `apps/web/src/walk/figure.ts`                                       |
| Frame loop, keyboard                  | `apps/web/src/walk/useWalk.ts`                                      |
| Controls, capture sheet               | `apps/web/src/walk/WalkHud.tsx`, `CaptureSheet.tsx`, `Joystick.tsx` |
| Figure and camera in the 3D scene     | `apps/web/src/scene/WalkRig.tsx`                                    |

The frame loop runs outside the canvas and only the controls re-render while the figure moves; the 3D scene
reads the figure from a ref every frame.

## Testing on an environment

```sh
S=.claude/skills/my-home-environments/scripts
$S/walk-smoke.sh staging                                   # phone-sized smoke test of the movement pad
$S/screenshot.sh staging --viewport 390x844 --path '/?walk=first' --pad 0,-44,2000
```
