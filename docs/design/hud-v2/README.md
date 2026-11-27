# HUD v2

First discussion draft for the 3D viewer. The [Sakuga HUD rollout](../hud.md) supplies the paper controls and motion. This design asks what belongs on screen, when it appears and how people reach it by mouse, touch or keyboard.

## Today's HUD

The desktop viewer has a View controls panel and a Furniture panel. The phone uses a compact top bar and a bottom sheet, with a side sheet in landscape. The desktop and phone both offer level cutaway, named views, visibility and quality settings, and routes to Photos and Catalogue. Edit mode exposes furniture placement, transforms, undo and redo. Selection can already show a piece link or a nearby edit toolbar. The orbit view has a north-up compass button. Walk has mode-specific controls, a minimap with an enlarged view, and separate camera and photo-capture controls.

On the baseline for this draft, the loading bar, shared Sakuga core, paper theme, compact buttons, warning toasts and badges are merged. The choice controls are next in [#197](https://github.com/NNTin/my-home/pull/197), part of the seven-family [#168 rollout](https://github.com/NNTin/my-home/issues/168). The [HUD epic](https://github.com/NNTin/my-home/issues/165), its [loading-first decision](https://github.com/NNTin/my-home/issues/166) and the [merged design](https://github.com/NNTin/my-home/issues/167) set the visual and performance baseline.

## Three layers

| Layer | Starting layout | Where today's controls go |
| --- | --- | --- |
| **Primary** | A stable edge bar during normal viewing. Keep the active mode and level readable, and keep an exit visible during Walk, Edit and immersive submodes. | Home and Reset view, Orbit/Walk, level, Views, Edit and a Tools entry. Views opens the existing named views, view-specific settings, Save image and desktop Render. Photos and Catalogue sit under More on compact widths. |
| **Contextual** | One inspector per selection or focused workflow. Use a short card beside the view on desktop and one sheet slot on touch. Leave the selection visible when details open. | Existing selected-piece link, furniture edit actions and details, and task controls for placement or capture. Add room and door inspectors. Offer Room name, level and a way to focus the room, and show a door's linked spaces or available actions when the model supplies them. A catalogue selection exposes its piece page and, in Edit, Place. |
| **Utility** | A Tools drawer and a small orientation area. Surface actionable status next to the active task and keep routine feedback brief. | Keyboard and gesture help, existing hints, status badges, warnings, quality and Effects settings, and entries for coordinates and measurement. Room names, plan colours and visibility stay in the View options reached from Primary. |

### Compass, minimap and clock

- **Compass** sits in the Primary orientation area. Keep the current north-up action in Orbit. In Walk, the compass shows heading and the enlarged map offers orientation controls. A change to the map orientation should leave the walking pose alone.
- **Minimap** joins the compass in Walk. Keep the small map, tap to enlarge and walk-to-point behavior. In Orbit, start with the compass alone and make the floor overview a one-tap option. On a phone the expanded map uses the same sheet space as the inspector.
- **Clock** is a Utility control in the orientation area. Show the scene time and its live or manual state in a compact chip. Open the interactive clock for draggable hands and a keyboard-friendly time field. On narrow phones, put the chip in Tools when map and mode controls need the space. [Interactive HUD clock #18](https://github.com/NNTin/my-home/issues/18)
- **Temporary states** give capture, rendering and measurement their own task controls and keep the way out visible. Image export continues to use the scene output.

## Decisions to make together

- **Hotkeys and configuration.** Start from the current Walk movement and Edit shortcuts. Decide which actions earn defaults, where the cheat sheet lives, how to record, clear and reset a binding, how overlapping modes handle conflicts, and which hints appear on touch.
- **Visual design and palette.** Keep Sakuga's white paper, ink outlines, lavender shadow and pink accents. Compare how strongly the controls frame the scene and how much action the effects should signal. Check every direction against the bright and dark backgrounds in the [realistic render design](../realistic-render.md).
- **What's missing.** Decide whether to make the minimap available by default in Orbit, where Photos and Catalogue belong on desktop, whether the clock chip should be digital or analog, and whether the first measuring tool needs distance, height or both. Make coordinates local to the model and give units to every reading.
- **Model follow-ups.** [#189](https://github.com/NNTin/my-home/issues/189) and [#190](https://github.com/NNTin/my-home/issues/190) expand what a user may inspect. The room and placement follow-ups ([#191](https://github.com/NNTin/my-home/issues/191), [#192](https://github.com/NNTin/my-home/issues/192), [#193](https://github.com/NNTin/my-home/issues/193), [#194](https://github.com/NNTin/my-home/issues/194), [#195](https://github.com/NNTin/my-home/issues/195)) inform dense selection examples and the need for clear context around openings, fittings and adjacent rooms. The HUD can use the model data already available.

The next drafts will cover layer behavior, hotkey defaults and configuration, and the visual design. Compare the [three first mockups](mocks/README.md). The navigation placement and the kind of selection inspector can be chosen independently.
