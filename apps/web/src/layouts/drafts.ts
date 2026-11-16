import { LayoutItems, type Layout, type LayoutItem } from '@my-home/shared';

/**
 * localStorage cache of unsynced layout edits, one entry per layout. The saver writes a draft on
 * every edit and removes it once the server has the same content, so a reload or a short
 * offline period loses nothing.
 */
export interface LayoutDraft {
  layoutId: string;
  /** Server version the edits are based on; saving sends it as `version`. */
  baseVersion: number;
  name: string;
  items: LayoutItem[];
  /** ISO timestamp of the edit. */
  savedAt: string;
}

/** A stored draft, or undefined when it is missing, corrupt or from an incompatible version. */
function parseDraft(raw: string, layoutId: string): LayoutDraft | undefined {
  const value = JSON.parse(raw) as Partial<LayoutDraft> | null;
  if (!value || value.layoutId !== layoutId) return undefined;
  const { baseVersion, name, savedAt } = value;
  if (!Number.isInteger(baseVersion) || (baseVersion as number) < 1) return undefined;
  if (typeof name !== 'string' || name.trim() === '') return undefined;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return undefined;
  const items = LayoutItems.safeParse(value.items);
  if (!items.success) return undefined;
  return { layoutId, baseVersion: baseVersion as number, name, items: items.data, savedAt };
}

export interface DraftStore {
  read(layoutId: string): LayoutDraft | undefined;
  write(draft: LayoutDraft): void;
  remove(layoutId: string): void;
}

const PREFIX = 'my-home:layout-draft:';
const LAST_LAYOUT = 'my-home:last-layout:';

const storageOf = (storage?: Storage): Storage | undefined => {
  try {
    return storage ?? globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** Storage errors (disabled storage, quota) are swallowed: the draft is a best-effort cache. */
export function draftStore(storage?: Storage): DraftStore {
  const s = storageOf(storage);
  return {
    read(layoutId) {
      try {
        const raw = s?.getItem(PREFIX + layoutId);
        if (!raw) return undefined;
        return parseDraft(raw, layoutId);
      } catch {
        return undefined;
      }
    },
    write(draft) {
      try {
        s?.setItem(PREFIX + draft.layoutId, JSON.stringify(draft));
      } catch {
        // Best effort.
      }
    },
    remove(layoutId) {
      try {
        s?.removeItem(PREFIX + layoutId);
      } catch {
        // Best effort.
      }
    },
  };
}

/** The last layout opened for a home, so a reload reopens it. */
export const lastLayout = {
  get(homeId: string, storage?: Storage): string | undefined {
    try {
      return storageOf(storage)?.getItem(LAST_LAYOUT + homeId) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(homeId: string, layoutId: string, storage?: Storage) {
    try {
      storageOf(storage)?.setItem(LAST_LAYOUT + homeId, layoutId);
    } catch {
      // Best effort.
    }
  },
};

export interface LayoutContent {
  name: string;
  items: LayoutItem[];
}

export const sameContent = (a: LayoutContent, b: LayoutContent) =>
  a.name === b.name && JSON.stringify(a.items) === JSON.stringify(b.items);

/**
 * What to open: the server copy, or the local draft when it holds unsynced edits that are newer
 * than the server copy. A draft is newer when it is based on the current server version, or was
 * written after the server copy was last updated (the server then answers the save with a 409
 * if someone else changed the layout in between).
 */
export function resolveDraft(
  server: Layout,
  draft: LayoutDraft | undefined,
): LayoutContent & { restored: boolean; baseVersion: number } {
  const serverContent = { name: server.name, items: server.items, baseVersion: server.version };
  if (!draft || draft.layoutId !== server.id || sameContent(draft, server))
    return { ...serverContent, restored: false };
  const newer =
    draft.baseVersion >= server.version || Date.parse(draft.savedAt) > Date.parse(server.updatedAt);
  if (!newer) return { ...serverContent, restored: false };
  return {
    name: draft.name,
    items: draft.items,
    baseVersion: Math.min(draft.baseVersion, server.version),
    restored: true,
  };
}
