# Hotkeys

Use one action list for shortcut dispatch, help, current bindings in the HUD, and configuration. Invoke the same actions and availability checks as the visible controls. The defaults below are implementation starting points. Every action remains reachable with mouse, touch, or standard keyboard navigation through the HUD.

## Default bindings

| Context                   | Action                                                                                      | Default                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Viewer                    | Keyboard shortcuts                                                                          | `?`                                                            |
| Viewer                    | Close or cancel the focused surface, cancel the active tool, clear selection, or leave Walk | `Escape`                                                       |
| Orbit and Edit            | Open Views                                                                                  | `V`                                                            |
| Orbit and Walk            | Open or close the map                                                                       | `M`                                                            |
| Orbit                     | Turn view north-up                                                                          | `N`                                                            |
| Orbit                     | Enter Walk                                                                                  | `Shift+W`                                                      |
| Walk                      | Forward / back                                                                              | `W` / `S`, or `↑` / `↓`                                        |
| Walk                      | Strafe left / right                                                                         | `A` / `D`                                                      |
| Walk with manual turning  | Turn left / right                                                                           | `Q` / `E`, or `←` / `→`                                        |
| Edit with a selected item | Rotate by one step / rotate back                                                            | `R` / `Shift+R`                                                |
| Edit with a selected item | Duplicate                                                                                   | `Shift+D`                                                      |
| Edit with a selected item | Delete                                                                                      | `Delete`                                                       |
| Edit                      | Undo                                                                                        | `Ctrl/Cmd+Z`                                                   |
| Edit                      | Redo                                                                                        | `Ctrl/Cmd+Shift+Z`, with `Ctrl+Y` as a Windows/Linux alternate |

The default movement positions and rotation keys carry forward the existing behavior. Use the printed character for letter keys and show the detected chord during capture. Arrows offer a layout-independent movement preset, and users can set letter positions that suit their own keyboards. The proposed duplicate key gives the browser its bookmark shortcut. Delete needs an active Edit selection. A keyboard with no forward Delete can use the visible action or a custom binding. Edit entry, Photos, Catalogue, Render, scene clock, Reset view and Measure start unassigned.

## Scope and precedence

- Use viewer shortcuts when keyboard input is in the viewer context. Character shortcuts can be disabled or rebound. Normal Tab, Shift+Tab, Enter, Space and control-specific arrows retain their platform behavior. Preserve text editing, composition and native form shortcuts, including inside Sakuga shadow roots.
- The shortcut recorder and the focused dialog or HUD widget get first use of keys. An active tool gets the next opportunity, then the viewer mode. Each Escape press handles one layer. An open surface closes first, then an active task may cancel, then a selection may clear, then Walk may exit. Return focus to the invoking control when closing a HUD surface.
- A disabled action leaves the key available to its normal destination. Only consume events an action actually handles. Treat movement as held input and other commands as a single press. Release held input on keyup, window blur, visibility loss, mode change and opening a surface that takes over keyboard input. Sensor steering continues to own the relevant turning axes.

## Discovery and configuration

Open **Tools → Keyboard shortcuts** or press `?` for a searchable list grouped by Viewer, Orbit, Walk and Edit. Show current binding, action context and an accessible action name. The same display strings appear on related HUD controls at hover or focus. On touch, keep the settings entry available for external keyboards and surface touch instructions first in gesture help. Never require a shortcut to exit a mode.

1. Activate a binding to record one key or chord. Allow two slots per action so users can keep an arrow or platform alternate. Pure modifiers, browser or system shortcuts, Tab and Escape are reserved. Escape cancels capture. Ignore repeats and composition.
2. For an overlapping conflict, show the other action and its context. Offer retry or explicit reassignment. Confirming reassignment clears the old slot and writes the new one together. The same chord can be reused in contexts that cannot be active together. A reset that would introduce a conflict uses the same resolution flow.
3. Offer **Clear binding**, **Reset action** and **Restore all defaults**. Clearing and per-action reset apply immediately once conflicts are resolved. Confirm a full reset when there are custom bindings.
4. Save preferences per browser in versioned storage. Keep explicit cleared slots distinct from untouched defaults. A bad or unsupported saved entry falls back to its default without losing valid entries for other actions. Surface an unavailable storage session as temporary if changes cannot persist. The home model and its seeds carry no shortcut settings.
