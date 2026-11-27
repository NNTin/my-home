# HUD layers and behavior

Use the [corner clusters](mocks/README.md#corner-clusters) as the desktop baseline. Keep the visual treatment from the [visual design](visual-design.md) across all three layers. On a phone, keep mode and level near the top and put the primary action group within thumb reach. The [floating row](mocks/README.md#floating-action-row) also shows the contrast treatment on a dark scene.

## Primary

- Keep the current mode and level readable. The mode control enters Walk and offers an explicit return to Orbit. Edit has a visible state and exit. Keep the existing reset view action distinct from north-up.
- Put Views, Edit and Tools along the lower right of a wide viewport. Views opens existing named views, cut and backdrop controls, visibility, quality, Save image and desktop Render as applicable. Put Home, Photos and Catalogue in the related menus on compact widths so their counts and labels do not occupy the resting view.
- Open one HUD popover or sheet at a time. Keep it within safe areas and return keyboard focus to its trigger on dismissal. The viewer receives gestures through the gaps between real control hit areas. Keep mode, level and exit available where they are relevant during capture, placement, measurement and render workflows.

## Contextual

| Selection        | Compact label | Expanded surface                                                                                         |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| Room             | Name          | Name, level and Focus room where supported.                                                              |
| Door or opening  | Name or type  | Linked spaces and available opening controls when the current model supplies them.                       |
| Placed furniture | Item name     | Piece page and existing details. In Edit, show available transforms, duplication and deletion with undo. |
| Catalogue item   | Piece name    | Piece page and Place when Edit and item placement are available.                                         |

Keep one selected subject. The outline and the label clear together when the user deselects or the subject stops being visible. Keep viewer navigation available and avoid putting the resting label over the selected subject. Use the existing touch selection and sheet behavior on narrow screens. Placement previews and capture have their own actionable controls while active. Keep viewing selections read-only and route edits through the existing commands and persistence.

## Utility

- **Compass and map.** Use one orientation area. Orbit keeps the north-up action and a collapsed map entry that opens a floor overview. The Orbit overview does not move the walking figure. Walk shows the minimap with a position and heading marker. Preserve map expand, orientation preferences and walk-to-point in Walk. Use the existing sheet area for the expanded map on phones. Changing map orientation leaves the Walk pose alone.
- **Scene clock.** Reserve a compact time chip with a live or manual indication, opening the interactive clock when [#18](https://github.com/NNTin/my-home/issues/18) provides scene time. A phone can place the chip in Tools. The expanded control needs draggable hands and a keyboard-friendly time field. The HUD can ship orientation independently and show the chip when a scene-clock source exists.
- **Tools.** Give keyboard shortcuts, gesture help, Effects, status and diagnostics predictable entry points. Keep routine feedback brief and place actionable messages near their originating surface. Express the state in visible text even with effects off. The opened tools list is also the touch discovery path.
- **Measure and coordinates.** Start with straight-line distance between two model points, displayed in metres beside the span. Expose a model-local coordinate readout for an active measurement point, with axes and metres labelled. Offer cancel and clear. The tool leaves model data untouched. Dedicated height, snapping modes and saved measurements can follow after the distance workflow proves useful.

The first integration pass should exercise Orbit, Walk and Edit on desktop and phone, including a Walk with its expanded map, joystick and exit, and an expanded inspector over a busy room. Check portrait and landscape and verify that UI actions and canvas gestures both reach their intended targets.
