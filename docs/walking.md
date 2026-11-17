# Walking and taking photos

A virtual figure walks through the home. The owner steers it on the phone to where they really stand, turns it
the same way, and takes a photo: the photo is stored with the figure's pose ([photos.md](photos.md)).

Start with **Walk and take photos** in the view controls (**🚶 Walk** in the top bar [on a phone](mobile.md)),
or open the viewer with `?walk=first` or `?walk=third`.

## Controls

|              | Phone, Manual mode                             | Phone, Sensor mode       | Desktop                                    |
| ------------ | ---------------------------------------------- | ------------------------ | ------------------------------------------ |
| Walk         | movement pad: push up or down                  | the same                 | `W` `S` or `↑` `↓`                         |
| Turn         | movement pad: push left or right               | turn the phone           | `Q` `E` or `←` `→`                         |
| Sidestep     |                                                | movement pad: left/right | `A` `D`                                    |
| Look around  | drag on the view (first person), or **▲ ▼**    | tilt and turn the phone  | drag on the view with the mouse            |
| Switch view  | **Overview** / **First person**                | the same                 | the same                                   |
| Take a photo | the camera button (the camera inside the page) | the same                 | the camera button (webcam or file chooser) |

The pad both walks and turns in Manual mode, so one thumb is enough in portrait. In first person the camera is
the figure's eyes; the whole building is drawn and room names are hidden. In the overview the camera orbits the
figure (drag and pinch as usual) and the **cutaway follows the figure's level**, so you look into the floor it is
on; outdoors the whole building shows.

On a phone, one switch in the bar, **📱 Sensors** ⟷ **✋ Manual**, says who sets the view's angle; see
[Camera modes](#camera-modes-sensors-and-manual). In Manual mode **▲ ▼** next to the camera button look up and
down in steps of 10°, and the bar shows the current tilt. A [minimap](#minimap) in the bottom right corner shows
where the figure is and which way it looks.

## Camera modes: Sensors and Manual

Two exclusive modes, chosen with one switch in the bar. The switch is there on phones and tablets with
orientation sensors; a desktop is always in Manual mode (keys and mouse) and shows no switch.

- **✋ Manual** (the default): the phone's motion sensors are **not listened to at all** (no listeners, no
  battery cost). The view is turned and tilted by hand: drag on the view, **▲ ▼**, and the pad's left and right
  turn; up and down walk.
- **📱 Sensors**: the phone's orientation sets **heading and tilt**, so facing a wall in the real room faces it
  in the model, and tipping the phone up looks up. Touch can **only walk**: dragging the view changes nothing
  (sideways or up and down), **▲ ▼** are hidden, the pad's up and down walk where the phone points and its left
  and right **sidestep**; nothing turns the figure by hand (not the turn keys either). Calibration is in the
  **Calibrate** sheet only.

The choice is remembered per device (localStorage). On an iPhone the tap on **Sensors** asks for permission to
read the motion sensors. Switching to Sensors eases the view to where the phone points over about 0.3 s instead
of snapping. The view follows a turn within that time, and ignores changes under 1.5° while at rest, so a phone
held still gives a still view. When the permission is refused, or no compass and tilt data arrive within 2 s,
the switch falls back to **Manual** and the bar says why. Sensor mode needs a **compass**: a device that
reports only its tilt (no absolute orientation and no `webkitCompassHeading`) falls back to Manual too, since
the heading would otherwise be left without any control. The sensors pause while the page is in the background
and resume by themselves.

When the walk starts in Sensor mode (remembered, or restored after a reload), it switches on by itself where the
browser grants the sensors without a tap (Chrome on Android); an iPhone starts in Manual mode until the switch
is tapped.

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
room. **Calibrate** (in Sensor mode) corrects for it: point the phone at one of the listed doors or windows of
the room and tap its name, and the offset becomes the difference between where the compass says you look and
where that opening is in the model. Dragging the view never changes it.

The offset is shown in the bar, kept **per device** (in the browser's local storage, not in the home), and
**Reset** clears it. On a phone the sheet opens at the bottom, over the movement pad; its head with the offset,
**Reset** and **Done** stays in reach while the rest scrolls.

### What is stored with a photo

In Sensor mode, the photo's view is the one at the **tap on the shutter** (or, with the camera
app, on the button that opens it). The camera app hides the page, and afterwards the phone is usually tipped towards you while you read the
sheet and type a note; so the view goes back to where it was at the tap and the phone stops driving it until
the sheet is closed; the bar says "held for the photo" meanwhile (not "paused", which is the page in the
background). The arrow buttons in the sheet adjust the pose from there.

Every photo taken while walking stores a **sensor snapshot** next to its pose
([photos.md](photos.md#sensor-snapshot)): whether the heading was measured by the compass or set by hand,
whether the tilt came from the phone, the raw angles, the accuracy, and the declination and offset that were
applied. Only orientation: nothing about where the phone is. A photo taken in Manual mode stores
`source: manual` and no tilt.

### Checking it on real phones

`compass-smoke.sh` (see the end of this page) covers all of this with mocked sensor events. What only a real
phone shows is this list, to be run on **Android Chrome** and **iPhone Safari** at `?walk=first`, standing in
the home:

1. **Switch and permission.** Is there one **📱 Sensors / ✋ Manual** switch, on Manual? Tap **Sensors**.
   iPhone: a permission prompt must appear; allow it. Android: note whether one appears. Is Sensors lit?
2. **Tilt.** Hold the phone upright: the bar should show about 0°. Tip it down towards the floor and up
   towards the ceiling. Does the view follow, the right way round, and stop near straight up and down?
3. **At rest.** Hold it still for ten seconds. Does the view tremble?
4. **Heading.** Turn slowly through a full circle. Does the view turn with you, the same way, without jumps,
   also when passing north?
5. **Does it face the right way?** Stand in the corridor and point the phone at a door you can identify in
   the model. Is that door in the middle of the view? Note how many degrees it is off and to which side.
6. **Calibrate.** Open **Calibrate**, point at that door, tap its name. Is it centred now? Walk to a second
   room and check another door: how far off is it there?
7. **Touch only walks.** In Sensor mode, drag on the view sideways and up and down: does the view stay put?
   Are **▲ ▼** gone? Push the pad up: do you walk where the phone points? Left and right: do you sidestep,
   without turning?
8. **Landscape.** Turn the phone to landscape, both ways. Does the view still face where the camera points,
   and does tilting still work? Does nothing overlap (bar, switch, minimap, pad, camera button)?
9. **Compass rose and minimap.** Do the compass rose and the minimap turn as you turn?
10. **Manual mode.** Tap **Manual**. Move and turn the phone: does the view stay still? Do dragging,
    **▲ ▼** and the pad's left and right turn and tilt the view?
11. **Accuracy.** iPhone, Sensor mode: is "±N°" shown, and does it change when you wave the phone in a figure
    of eight?
12. **Away and back.** Switch to another app and back, and lock and unlock the phone. Does Sensor mode
    resume?
13. **Capture.** In Sensor mode, take a photo and save it. In the gallery, does its detail say "Heading
    measured by the phone", and does its view cone (with a ring) point the way you faced?
14. **Refused.** iPhone, in a fresh tab: tap **Sensors** and refuse the permission. Is there a clear message,
    is the switch back on Manual, and do dragging and **▲ ▼** work?
15. **Remembered.** Leave walk mode and enter it again, and close and reopen the tab: Android should come back
    in Sensor mode by itself; an iPhone in Manual mode until **Sensors** is tapped.
16. **Minimap.** Walk through two rooms and up or down the stair: does the map show the right level, room
    (highlighted), position and facing? Tap it: does it enlarge, switch between **⬆ Heading** and **N North**
    (and remember it), and shrink on a tap? With **📍 Move**, tap a free spot: does the figure go there, and is
    a wall refused?
17. **Camera in the page.** Tap the camera button: is the browser's camera prompt shown once, then the back
    camera's picture, the right way up, also in landscape? Take a photo and save it: is it sharp, and does
    the gallery show it with its pose? Then try **📱 Camera app** and **🖼 Gallery** from the viewfinder.
18. **Back from the camera app.** In Sensor mode, walk somewhere, open **📱 Camera app**, take a photo and
    press OK. Does the sheet show the photo? If the browser reloads the page instead, does it come back
    walking at the same spot, in Sensor mode (Android), with a message to take the photo again?

## Minimap

A small top-down map of the figure's level in the bottom right corner, above the camera button, in first
person and in the overview. It is drawn as SVG from the plan (the same rooms, walls, doors, windows and stairs
the 3D view is built from), so it costs no second 3D render and draws nothing while the figure stands still.

- **What it shows:** the room outlines with their names, the room the figure is in highlighted, walls, doors
  (brown), windows (blue), the stairs that start or end on this level, fences and gates on the ground level,
  the figure as a dot with a cone for where it looks, and the open photo requests as dashed yellow targets (the
  one being answered filled).
- **Which level:** the figure's level; it changes half-way up the stair, together with the cutaway. Outdoors it
  shows the level nearest to the ground.
- **Tap it** to enlarge it to the whole level. There: **⬆ Heading** (the map turns so the figure always looks
  up) or **N North** (true north up, from `building.northBearing`; the arrow in the corner always points
  north), remembered per device; **📷** shows the cameras of the level's photos; **📍 Move** then a tap on the
  map puts the figure there, only on a free spot of a floor (the same rules as walking; a wall or a void is
  refused). A tap on the map or **✕** makes it small again.
- **Placement:** above the camera button and the **▲ ▼** column, so it never covers the pad, the camera button,
  the bar with the mode switch, or the compass rose, in portrait and landscape and within the safe areas. It
  steps aside while the capture, calibration and request sheets are open; the request hint moves above it.

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

1. Walk to where you stand and look the way you look. Press the camera button: the camera opens **inside the
   page** (the browser asks once for the camera). Press the round shutter. **📱 Camera app** and **🖼 Gallery**
   are there too, and are what is left when the camera is not allowed or the browser has no camera access.
2. The sheet shows the photo, where the figure is, a note field and tags. The arrow buttons move the figure by
   10 cm or turn and tilt it by 5°, for fine corrections.
3. **Save photo** uploads it with the figure's pose **at that moment**: position (eye height), yaw, pitch, level
   and the camera's horizontal field of view. A progress bar shows the upload; if it fails, the photo and the
   note stay and **Try again** repeats it.
4. Afterwards **Update pose** corrects the pose of the saved photo from the figure's current pose.

### Why the camera is inside the page

A phone browser may throw a tab away while it is in the background, and a camera app in front of a heavy 3D
page is exactly that. When the camera app returns, the browser loads the page afresh: the photo it handed back
is gone, and so was the walk (seen with Samsung Internet on a Galaxy S23). So:

- the camera button opens the camera **inside the page** (`getUserMedia`, `CameraView.tsx`): the page never
  goes to the background. The shutter takes the camera's full-resolution still where the browser offers
  `ImageCapture` (Chrome, Samsung Internet), otherwise the video frame at the stream's full size;
- while any camera is open the 3D view stops drawing, which leaves the phone more memory;
- walk mode is kept for the tab in `sessionStorage` (`walkSession.ts`): the view, the figure, the camera
  mode, the note and tags being typed, and, while the camera app is open, the pose and sensors of the tap.
  After a reload the page comes back walking there (also over `?walk=` in the address, which a reload keeps)
  and, if a photo was on its way, says that it was lost and asks to take it again. Leaving walk mode forgets
  it. Sensor mode comes back by itself where the browser grants the sensors without a tap (Android); an
  iPhone needs a tap on **Sensors** again. A walk kept before the camera modes existed reads its Heading or
  Tilt as Sensor mode.

If an upload fails, the sheet keeps the photo, says why (no connection or an expired sign-in included) and
offers **Save a copy on the phone** before trying again.

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
| Sensor maths, camera modes            | `apps/web/src/walk/orientation.ts`, `useCompass.ts`, `calibration.ts` |
| Minimap                               | `apps/web/src/walk/minimap.ts`, `Minimap.tsx`                         |
| Controls, capture sheet               | `apps/web/src/walk/WalkHud.tsx`, `CaptureSheet.tsx`, `Joystick.tsx`   |
| Camera inside the page                | `apps/web/src/walk/CameraView.tsx`                                    |
| Walk kept across a reload             | `apps/web/src/walk/walkSession.ts`                                    |
| Figure and camera in the 3D scene     | `apps/web/src/scene/WalkRig.tsx`                                      |

The frame loop runs outside the canvas and only the controls re-render while the figure moves; the 3D scene
reads the figure from a ref every frame.

## Testing on an environment

```sh
S=.claude/skills/my-home-environments/scripts
$S/walk-smoke.sh staging                                   # the movement pad, the minimap and the stair
$S/compass-smoke.sh staging                                # Sensors and Manual with mocked sensor events
$S/camera-smoke.sh staging                                 # taking a photo with a fake camera, and a reload
$S/mobile-smoke.sh staging                                 # the phone layout around it (docs/mobile.md)
$S/screenshot.sh staging --viewport 390x844 --path '/?walk=first' --pad 0,-44,2000
```
