/** The painted toggle's two lazy files (apps/web/sakuga-plugin.ts): their URLs only. */
declare module 'virtual:sakuga-toggle-frames' {
  /** The two rest frames (off, on), about 8 kB. */
  export const rest: string;
  /** All 43 frames, about 346 kB: fetched only when a flip may play. */
  export const all: string;
}
