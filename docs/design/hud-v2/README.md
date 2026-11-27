# HUD v2

A minimal game HUD for the full-bleed 3D viewer. Use clear space between compact controls and minimal translucent backing. Keep the paper colours and motion from the [Sakuga HUD rollout](../hud.md). See the [layer behavior](layers.md), [hotkeys](hotkeys.md), [visual design](visual-design.md) and [current mockups](mocks/README.md).

## Today's HUD

The desktop viewer has a View controls panel and a Furniture panel. The phone uses a compact top bar and a bottom sheet, with a side sheet in landscape. The desktop and phone both offer level cutaway, named views, visibility and quality settings, and routes to Photos and Catalogue. Edit mode exposes furniture placement, transforms, undo and redo. Selection can already show a piece link or a nearby edit toolbar. The orbit view has a north-up compass button. Walk has mode-specific controls, a minimap with an enlarged view, and separate camera and photo-capture controls.

On the baseline for this draft, the loading bar, shared Sakuga core, paper theme, compact buttons, warning toasts and badges are merged. The choice controls are next in [#197](https://github.com/NNTin/my-home/pull/197), part of the seven-family [#168 rollout](https://github.com/NNTin/my-home/issues/168). The [HUD epic](https://github.com/NNTin/my-home/issues/165), its [loading-first decision](https://github.com/NNTin/my-home/issues/166) and the [merged design](https://github.com/NNTin/my-home/issues/167) set the visual and performance baseline.

## Three layers

| Layer | Starting layout | Where today's controls go |
| --- | --- | --- |
| **Primary** | Small groups anchored to the edges. Keep the active mode, level and essential actions visible, with the way out of Walk, Edit and temporary modes. | Home and Reset view, Orbit/Walk, level, Views, Edit and a Tools entry. Views opens the existing named views, view-specific settings, Save image and desktop Render. Photos and Catalogue sit under More on compact widths. |
| **Contextual** | Show the selection outline and a short edge label. Open one compact inspector or task surface at a time. On touch it uses the sheet slot. | Existing selected-piece link, furniture edit actions and details, and task controls for placement or capture. Add room and door inspectors. Offer Room name, level and a way to focus the room, and show a door's linked spaces or available actions when the model supplies them. A catalogue selection exposes its piece page and, in Edit, Place. |
| **Utility** | A compact orientation area and a Tools drawer on demand. Surface actionable status near the active task and keep routine feedback brief. | Keyboard and gesture help, existing hints, status badges, warnings, quality and Effects settings, and entries for coordinates and measurement. Room names, plan colours and visibility stay in the View options reached from Primary. |

### Compass, minimap and clock

- **Compass** sits in the Primary orientation area. Keep the current north-up action in Orbit. In Walk, the compass shows heading and the enlarged map offers orientation controls. A change to the map orientation should leave the walking pose alone.
- **Minimap** joins the compass in Walk. Keep the small map, tap to enlarge and walk-to-point behavior. In Orbit, start with the compass alone and make the floor overview a one-tap option. On a phone the expanded map uses the same sheet space as the inspector.
- **Clock** is a Utility control in the orientation area. Show the scene time and its live or manual state in a compact chip. Open the interactive clock for draggable hands and a keyboard-friendly time field. On narrow phones, put the chip in Tools when map and mode controls need the space. [Interactive HUD clock #18](https://github.com/NNTin/my-home/issues/18)
- **Temporary states** give capture, rendering and measurement their own task controls and keep the way out visible. Image export continues to use the scene output.

## Implementation order

1. Add a transparent resting appearance to the existing Sakuga controls.
2. Move primary navigation into the responsive edge layout.
3. Add selection labels and contextual inspectors.
4. Consolidate the compass and minimap and provide the scene-clock entry when #18 supplies scene time.
5. Move help, Effects and status into Tools.
6. Route existing and new keyboard actions through shared defaults and scope rules.
7. Add shortcut discovery, rebinding, conflict handling and reset.
8. Add the two-point measurement tool and local coordinates.

Use [corner clusters](mocks/README.md#corner-clusters) as the first desktop layout and the [floating row](mocks/README.md#floating-action-row) as the dark-scene contrast reference. The compact Walk layout and expanded inspector are in-scope verification cases. Start implementation after [#168](https://github.com/NNTin/my-home/issues/168) so the two HUD rollouts can proceed in order.

**Model follow-ups.** [#189](https://github.com/NNTin/my-home/issues/189) and [#190](https://github.com/NNTin/my-home/issues/190) expand what a user may inspect. The room and placement follow-ups ([#191](https://github.com/NNTin/my-home/issues/191), [#192](https://github.com/NNTin/my-home/issues/192), [#193](https://github.com/NNTin/my-home/issues/193), [#194](https://github.com/NNTin/my-home/issues/194), [#195](https://github.com/NNTin/my-home/issues/195)) inform dense selection examples and the need for clear context around openings, fittings and adjacent rooms. The HUD can use the model data already available.
