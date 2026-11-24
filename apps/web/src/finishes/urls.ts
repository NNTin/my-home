/**
 * The texture files of the finish library as the build serves them: each imported by URL, so Vite
 * gives it a hashed name under `/assets/` (immutable for nginx). Nothing is fetched by importing
 * this: a file is requested when a finish that uses it is first drawn (`textures.ts`).
 */
const files = import.meta.glob<string>('./textures/*/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** The URL of a texture file by its path under `textures/`, e.g. `grass-lawn/color-512.webp`. */
export const textureUrl = (path: string): string | undefined => files[`./textures/${path}`];
