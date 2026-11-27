# Visual design

A minimal game HUD for a full-bleed 3D view. Keep the house visible through and between the controls. On the resting HUD, use unboxed glyphs and short readouts with a clear background. A single label or icon can get a small, flat translucent backing where the scene makes it hard to read. Keep Sakuga's identity in the ink, paper colours and reactions.

## What the viewer sees

| HUD layer | Resting state | During use |
| --- | --- | --- |
| **Primary** | Mode and level at the upper left. Views, Edit and Tools are compact actions near a lower edge. The compass sits in the upper right. Keep the current mode readable and show an explicit exit in Walk and task modes. | Open the nearest compact menu for choices. Use a visible focus outline and a shape or label to mark the active mode. |
| **Contextual** | Show one selection outline and a short edge label for the selected room, door or item. Clear both when selection clears. | Expand the label into a small inspector. Give fields and longer text a stable paper backing. Use the phone's existing sheet space for expanded details, with the selected area visible above it. |
| **Utility** | Compass, map entry and clock share the same corner. In Orbit the map starts collapsed. In Walk show a compact map with a distinct position and heading marker. Keep the timeline status beside the clock when it is set manually. | Open the map, time controls or Tools on demand. Show a measurement and its units beside the measured span. Coordinates and diagnostics stay in Tools. Put short feedback at the edge of the active surface. |

The canvas takes drags, taps and scrolls in the spaces between controls and through unused overlay space. Only a control's real hit target and open interactive content take input. Keep a 34 px compact control face where it fits and the existing 44 px touch target around it. Give Level and Views distinct icons. Label every icon action for assistive technology and show a short label on hover or keyboard focus. On phones, keep the same groups within safe areas and place the actions together within thumb reach. Expose the full action names in the opened controls so touch users can discover them.

## Colour and contrast

Start from the current Sakuga values in [styles.css](../../../apps/web/src/styles.css) and apply them through shared variables.

| Role | Starting value | Use |
| --- | --- | --- |
| Ink | `#1D1A4A` | Text and icons on light areas, the edge around paper-white icons on dark areas, and outlines on open surfaces. |
| Paper | `#FFFFFF` | Text and icons on dark areas, a fine edge where an ink glyph needs separation, and backing for open inspectors and forms. |
| Lavender | `#B8B3FF` | Sakuga's flat effect shadow. A small hard offset shadow can edge an opened surface. |
| Violet | `#5A4FD8` | The outline in the shared Sakuga effect palette. |
| Pink | `#FF5FA8` | North tip, a small active or focus accent, and Sakuga accents. Pair a selected colour with an outline, shape or label. |

Start each scene theme with its readable ink or paper foreground. Give glyphs a narrow contrasting outline where the house can cross behind them. A local backing can increase in opacity over a busy surface until the label reads, and an expanded form can use solid paper. Keep those surfaces the size of their contents. Use flat fills and crisp edges so detail stays visible around the HUD. Check light plaster, deep shadow and a textured room with the camera moving. Target 4.5:1 for small text and 3:1 for meaningful icons and focus indicators. Set contrast at the UI theme or component level without per-frame canvas sampling.

## Keep the Sakuga reactions

Use the existing icon buttons and compact buttons for commands and links. Reuse the rollout's tabs or segmented controls for mode choices, sliders and fields for values, and badges, toasts and progress for feedback. If the current button style needs a change for the resting view, propose a shared transparent appearance for the Sakuga button and icon button driven by theme variables. The element keeps its accessible name, pressed state, focus, hit area and effect hooks. Reuse the compass and minimap drawing and interaction logic inside Sakuga-styled controls.

- **Routine actions.** A compact press gives the familiar squash and a small wedge or puff on release. Use the existing turn crescent for north-up or rotate.
- **Continuous inputs.** Compass tracking, clock ticks, map position and measurement previews update quietly. A deliberate release or confirmation can fire one small reaction at the control that received the input.
- **Feedback.** Use the existing badge, toast or progress reaction for its matching outcome. Keep the paper, lavender and outline treatment and the existing Japanese words where the element uses them. Keep effects away from the selection and any open reading area.
- **At rest.** The shared effects clock sleeps. Turning Effects off or using reduced motion preserves the same controls, focus, selected state and feedback. The effect canvas stays pass-through and independent of 3D rendering.

## Layouts to compare

Start with [corner clusters](mocks/README.md#corner-clusters) on desktop. The [floating action row](mocks/README.md#floating-action-row) puts Views, Edit and Tools together at the lower center. Both leave the center clear in normal use and use the same selection and utility behavior. The choice is where the three actions should sit while orbiting and walking.

The next layout pass should include a phone in Walk with its compass, open minimap, joystick and exit, plus one expanded inspector over a busy room. That will settle the group's placement and how much backing the labels actually need.
