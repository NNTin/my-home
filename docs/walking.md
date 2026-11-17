# Walking and taking photos

A virtual figure walks through the home. The owner steers it on the phone to where they really stand, turns it
the same way, and takes a photo: the photo is stored with the figure's pose ([photos.md](photos.md)).

Start with **Walk and take photos** in the view controls (**🚶 Walk** in the top bar [on a phone](mobile.md)),
or open the viewer with `?walk=first` or `?walk=third`.

## Controls

|              | Phone                                        | Desktop                                  |
| ------------ | -------------------------------------------- | ---------------------------------------- |
| Walk         | movement pad: push up or down                | `W` `S` or `↑` `↓`                       |
| Turn         | movement pad: push left or right             | `Q` `E` or `←` `→`                       |
| Sidestep     |                                              | `A` `D`                                  |
| Look around  | drag on the view (first person), or **▲ ▼**  | drag on the view with the mouse          |
| Switch view  | **Overview** / **First person**              | the same                                 |
| Take a photo | the camera button (opens the phone's camera) | the camera button (opens a file chooser) |

The pad both walks and turns, so one thumb is enough in portrait. In first person the camera is the figure's
eyes; the whole building is drawn and room names are hidden. In the overview the camera orbits the figure
(drag and pinch as usual) and the **cutaway follows the figure's level**, so you look into the floor it is on;
outdoors the whole building shows.

On a phone, **🧭 Heading** and **↕ Tilt** hand parts of the view to the phone's sensors; see
[Turning and tilting with the phone](#turning-and-tilting-with-the-phone). **▲ ▼** next to the camera button
look up and down in steps of 10°, and the bar shows the current tilt.

## Turning and tilting with the phone

Two independent modes, each a button in the bar on devices with orientation sensors:

- **↕ Tilt**: tilting the phone up and down tilts the view. With the phone upright and its camera level the
  view is level; tipping the top away from you looks down, towards you looks up. It needs only gravity, so it
  works everywhere, also where the compass does not, and without **Heading**.
- **🧭 Heading**: the phone's compass turns the figure, so facing a wall in the real room faces it in the model.

On an iPhone the first tap asks for permission to read the motion sensors; one answer covers both modes.
Whatever the sensors do not drive stays in your hands:

| Control                 | Heading off    | Heading on                                              |
| ----------------------- | -------------- | ------------------------------------------------------- |
| Drag sideways           | turns the view | corrects the compass (the offset shows as "offset +7°") |
| Movement pad left/right | turns          | sidesteps (the phone does the turning)                  |

| Control               | Tilt off          | Tilt on                           |
| --------------------- | ----------------- | --------------------------------- |
| Drag up/down, **▲ ▼** | looks up and down | ignored (the phone sets the tilt) |

Switching a mode on eases the view to where the phone points over about 0.3 s instead of snapping. The view
follows a turn within that time, and ignores changes under 1.5° while at rest, so a phone held still gives a
still view. The bar says when a mode gets no data from the device, and when the sensors are paused because
the page is in the background; they resume by themselves.

### From the sensors to the plan

One chain, in [`apps/web/src/walk/orientation.ts`](../apps/web/src/walk/orientation.ts), each step unit-tested:

1. **Camera direction.** The browser describes the phone by `alpha`, `beta`, `gamma`: the rotation
   `Rz(alpha) · Rx(beta) · Ry(gamma)` from the phone's axes (x right, y to its top, z out of the screen) to
   the earth's (east, north, up). The back camera looks along the phone's −z. Its direction gives the
   **bearing** (degrees clockwise from north) and the **pitch** (positive looking up). Using the whole rotation
   keeps the bearing steady when the phone is tilted, and makes landscape work without a special case: the
   screen orientation (`screen.orientation.angle`) only matters for the roll and for a phone lying flat.
2. **Which events count.** For the heading only an **absolute** event (`deviceorientationabsolute`, or
   `deviceorientation` with `absolute === true`): a relative `alpha` is never used as a compass. Safari reports
   the heading itself (`webkitCompassHeading`, for a phone upright in portrait), which is corrected by adding
   the screen angle; its accuracy (`webkitCompassAccuracy`) shows in the bar as "±12°". The tilt is taken from
   any event.
3. **Magnetic to true north.** true bearing = magnetic bearing + **declination** (east positive) +
   **calibration offset**.
4. **True north to the plan.** plan heading (clockwise from the plan's −z) = true bearing +
   `building.northBearing`. The figure's yaw is its negative, in radians.

The **declination** is a setting of the home, `building.magneticDeclination`
([home-model.md](home-model.md#orientation)). Enter it once in the **Calibrate** sheet from a declination chart
for your area; it is 0 until then. The sheet also asks where the value is from (a chart or model, or measured on site), which is stored as its provenance. Saving changes only the declination of the home as it is stored at that moment, so edits made elsewhere in the meantime are kept. The app never works it out from a location, and never asks for one.

### Calibrating

Steel, appliances and wiring bend a compass indoors, often by several degrees and differently from room to
room. **Calibrate** (while Heading is on) corrects for it:

- point the phone at one of the listed doors or windows of the room and tap its name: the offset becomes the
  difference between where the compass says you look and where that opening is in the model; or
- drag the view sideways until it matches what you see.

The offset is shown in the bar, kept **per device** (in the browser's local storage, not in the home), and
**Reset** clears it.

### What is stored with a photo

With Heading or Tilt on, the photo's view is the one at the **tap on the camera button**. The camera app
that opens next hides the page, and afterwards the phone is usually tipped towards you while you read the
sheet and type a note; so the view goes back to where it was at the tap and the phone stops driving it until
the sheet is closed. The arrow buttons in the sheet adjust the pose from there.

Every photo taken while walking stores a **sensor snapshot** next to its pose
([photos.md](photos.md#sensor-snapshot)): whether the heading was measured by the compass or set by hand,
whether the tilt came from the phone, the raw angles, the accuracy, and the declination and offset that were
applied. Only orientation: nothing about where the phone is.

### Checking it on real phones

`compass-smoke.sh` (see the end of this page) covers all of this with mocked sensor events. What only a real
phone shows is this list, to be run on **Android Chrome** and **iPhone Safari** at `?walk=first`, standing in
the home:

1. **Buttons and permission.** Are there **🧭 Heading** and **↕ Tilt** buttons? Tap **Tilt**. iPhone: a
   permission prompt must appear; allow it. Android: note whether one appears. Does the button show "on"?
2. **Tilt.** Hold the phone upright: the bar should show about 0°. Tip it down towards the floor and up
   towards the ceiling. Does the view follow, the right way round, and stop near straight up and down?
3. **Tilt at rest.** Hold it still for ten seconds. Does the view tremble?
4. **Heading.** Tap **Heading**. Turn slowly through a full circle. Does the view turn with you, the same
   way, without jumps, also when passing north?
5. **Does it face the right way?** Stand in the corridor and point the phone at a door you can identify in
   the model. Is that door in the middle of the view? Note how many degrees it is off and to which side.
6. **Calibrate.** Open **Calibrate**, point at that door, tap its name. Is it centred now? Walk to a second
   room and check another door: how far off is it there?
7. **Drag to correct.** With Heading on, drag sideways. Does the view turn and "offset" change, and does it
   stay when you let go?
8. **Landscape.** Turn the phone to landscape, both ways. Does the view still face where the camera points,
   and does tilting still work?
9. **Compass rose.** Does the small compass rose turn as you turn?
10. **Walking.** Push the movement pad up: do you walk where the phone points? Left and right: do you
    sidestep?
11. **Accuracy.** iPhone: is "±N°" shown, and does it change when you wave the phone in a figure of eight?
12. **Away and back.** Switch to another app and back, and lock and unlock the phone. Do the modes resume?
13. **Capture.** With both modes on, take a photo and save it. In the gallery, does its detail say "Heading
    measured by the phone", and does its view cone (with a ring) point the way you faced?
14. **Without sensors.** Switch both modes off: do dragging and **▲ ▼** look around? iPhone, in a fresh tab:
    refuse the permission. Is there a clear message, and do dragging and **▲ ▼** still work?

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
1 MB and already drops the file's metadata; the api strips metadata again. A see-through PNG is put on white. If the browser cannot decode or encode the photo, the file itself is uploaded: its metadata then travels to the api (over HTTPS, behind the sign-on), which strips it before anything is stored. The photo's time is the file's own time, which the camera sets at the shot. The field of view comes from the
35 mm focal length in the photo's EXIF data when present (the only value read from it), otherwise from a
typical phone camera (26 mm).

## Code

| Part                                  | Where                                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| Walkable world, collision, start pose | `apps/web/src/walk/world.ts`                                          |
| Figure, input mapping, pose maths     | `apps/web/src/walk/figure.ts`                                         |
| Frame loop, keyboard, follow easing   | `apps/web/src/walk/useWalk.ts`                                        |
| Sensor maths, compass and tilt modes  | `apps/web/src/walk/orientation.ts`, `useCompass.ts`, `calibration.ts` |
| Controls, capture sheet               | `apps/web/src/walk/WalkHud.tsx`, `CaptureSheet.tsx`, `Joystick.tsx`   |
| Figure and camera in the 3D scene     | `apps/web/src/scene/WalkRig.tsx`                                      |

The frame loop runs outside the canvas and only the controls re-render while the figure moves; the 3D scene
reads the figure from a ref every frame.

## Testing on an environment

```sh
S=.claude/skills/my-home-environments/scripts
$S/walk-smoke.sh staging                                   # phone-sized smoke test of the movement pad
$S/compass-smoke.sh staging                                # Heading and Tilt with mocked sensor events
$S/screenshot.sh staging --viewport 390x844 --path '/?walk=first' --pad 0,-44,2000
```
