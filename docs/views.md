# Named views

Three views of the home are one link away (design: `docs/design/realistic-render.md` §7). Each is a camera, what
is shown, a light rig and a backdrop. They are in the **Views** control of the View panel (the desktop's left
panel, the phone's View tab) and in the address.

| View              | URL                                      | Camera                                                    | Shows                                              |
| ----------------- | ---------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Isometric cutaway | `?view=cutaway&level=<levelId>`          | Perspective, 20°, from high in the south-east of the plan | The levels up to that one; cut walls capped dark   |
| Eye level         | `?view=eye&room=<roomId>&look=<degrees>` | Perspective, 70°, 1.6 m above the floor                   | The room from inside, the whole house, ceilings on |

- A parameter that is missing or names nothing of the home takes its default: the lowest level; the first room
  of the level that is modelled inside, looking to its farthest corner. `look` is in degrees clockwise from plan
  north (`-z`).
- The eye stands back from the middle of its room, towards the wall behind it, so the view takes in the room.
  Dragging looks around.
- A named view hides the compass letters and the room names, stands in a white studio (`studio-light`) and puts
  the plot on a neutral ground that fades into the backdrop. Nothing beyond the plot is modelled.
- **Leaving a view:** turning or zooming the camera, or changing what is shown, leaves the view: the address
  drops its parameters, and the letters and names return. Its light, backdrop and ground stay until **Free**
  in the Views control or **Reset view** on a phone, which also show again what was shown before.
- `?view=` combines with `?quality=`. With `?focus=<useId>` the view gives its look and its field of view and
  the camera frames the use. With `?walk=` the walk comes first and the view opens when the walk is left.

## Backdrop

`sky` (the flat blue of the free view), `studio-light` (white, the named views' default) and `studio-dark`
(charcoal: daylight on a dark ground, not an evening). Chosen in the Views control, or by
`?backdrop=sky|studio-light|studio-dark` for a visit. It is not remembered.

## Cut caps

The top of a wall is a cut face: it is drawn with the `cut.dark` finish. It shows when the level above is hidden
(a cutaway) and is covered by the level above or the roof otherwise, so nothing is rebuilt when the cutaway
changes. A window sill is not a cut. The builder marks the tops (`WallSegment.cutTop`); the draw list gives each
its own item (`<wall segment id>/top`).

## Where the code is

| Part                                               | File                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- |
| The views: URLs, cameras, what is shown            | `apps/web/src/views/named.ts`                              |
| The Views control                                  | `apps/web/src/views/ViewsControl.tsx`                      |
| The ground, the depth range of a far camera        | `apps/web/src/views/Stage.tsx`                             |
| The lazy chunk `render-views` (all of the above)   | `apps/web/src/views/render-views.ts`                       |
| Opening, leaving and resetting a view, the address | `apps/web/src/Viewer.tsx`                                  |
| Wall tops as cut faces                             | `apps/web/src/builder/buildHome.ts`, `builder/drawList.ts` |

The chunk is asked for when the viewer opens and is not part of the main chunk
(`apps/web/bundle-budget.json`). Until it is here the viewer is complete without named views; a capture of a
`?view=` link waits for it (`canvas[data-frame="settled"]`).
