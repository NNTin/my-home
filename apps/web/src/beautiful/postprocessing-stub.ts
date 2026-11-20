/**
 * What `n8ao` imports from the `postprocessing` package: the base class of a second pass, for
 * that package's composer, which the viewer does not use. The package itself is not installed
 * (it pins three below 0.188; docs/design/realistic-render.md D10); `vite.config.ts` resolves
 * its name to this file.
 */
export class Pass {}
