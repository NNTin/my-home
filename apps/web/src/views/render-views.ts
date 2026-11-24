/**
 * The lazy chunk of the named views (docs/design/realistic-render.md §7): their URLs, cameras
 * and visibility, the "Views" control of the View panel, what they add to the scene (the ground,
 * a section's cut and caps), and the image export. The
 * main chunk never imports this file statically: `Viewer.tsx` asks for it when the viewer opens,
 * and the viewer is complete without it (the free view, the cutaway by level, walking).
 */
export * from './named';
export { ImageExport, type SaveImage } from './ImageExport';
export { Stage } from './Stage';
export { ViewsControl } from './ViewsControl';
