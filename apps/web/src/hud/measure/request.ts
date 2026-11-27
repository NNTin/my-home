/** `/?hud=measure`: the HUD's measuring page (docs/design/hud.md §10.2), a lazy chunk of its own. */
export const hudMeasureRequested = (search: string) =>
  new URLSearchParams(search).get('hud') === 'measure';
