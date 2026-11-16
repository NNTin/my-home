import type { Layout, UpdateLayoutBody } from '@my-home/shared';
import { LayoutConflictError } from '../api';
import { resolveDraft, sameContent, type DraftStore, type LayoutContent } from './drafts';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict';

export interface SaverState {
  status: SaveStatus;
  /** Server version the next save is based on. */
  version: number;
  /** Set while `status` is `conflict`: the server's version. */
  conflictVersion?: number;
  /** The open layout was restored from a local draft. */
  restored: boolean;
  error?: string;
}

export interface SaverOptions {
  update(id: string, body: UpdateLayoutBody): Promise<Layout>;
  drafts: DraftStore;
  onChange(state: SaverState): void;
  /** Called after each successful save with the stored layout. */
  onSaved?(layout: Layout): void;
  debounceMs?: number;
  retryMs?: number;
  now?: () => Date;
}

/**
 * Debounced auto-save of one open layout at a time, backed by the localStorage draft:
 *
 * - every edit is written to the draft at once and saved to the API after `debounceMs`
 * - saves run one at a time with the last known `version`; edits made meanwhile are saved next
 * - a failed save (offline, 5xx) keeps the draft and retries after `retryMs` or on the next edit
 * - a 409 stops auto-saving and keeps the draft until the user reloads or overwrites
 */
export class LayoutSaver {
  private layoutId: string | undefined;
  private content: LayoutContent = { name: '', items: [] };
  private dirty = false;
  private edits = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private state: SaverState = { status: 'saved', version: 1, restored: false };
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: SaverOptions) {
    this.debounceMs = options.debounceMs ?? 800;
    this.retryMs = options.retryMs ?? 5000;
    this.now = options.now ?? (() => new Date());
  }

  get current(): SaverState {
    return this.state;
  }

  private set(patch: Partial<SaverState>, clear: (keyof SaverState)[] = []) {
    const next = { ...this.state, ...patch };
    for (const key of clear) delete next[key];
    this.state = next;
    this.options.onChange(next);
  }

  /** Opens a layout loaded from the server, restoring a newer local draft. */
  open(layout: Layout): LayoutContent & { restored: boolean } {
    this.cancelTimer();
    this.layoutId = layout.id;
    const resolved = resolveDraft(layout, this.options.drafts.read(layout.id));
    if (!resolved.restored) this.options.drafts.remove(layout.id);
    this.content = { name: resolved.name, items: resolved.items };
    this.dirty = resolved.restored;
    this.edits = 0;
    this.set(
      {
        status: resolved.restored ? 'pending' : 'saved',
        version: resolved.baseVersion,
        restored: resolved.restored,
      },
      ['conflictVersion', 'error'],
    );
    if (resolved.restored) this.schedule(this.debounceMs);
    return { name: resolved.name, items: resolved.items, restored: resolved.restored };
  }

  /** Records an edit of the open layout. */
  edit(content: LayoutContent) {
    if (!this.layoutId || sameContent(content, this.content)) return;
    this.content = content;
    this.dirty = true;
    this.edits++;
    this.writeDraft();
    if (this.state.status === 'conflict') return;
    if (this.state.status !== 'saving') this.set({ status: 'pending' });
    this.schedule(this.debounceMs);
  }

  /** Saves pending edits now (e.g. before switching layouts); never throws. */
  async flush() {
    this.cancelTimer();
    await this.inFlight;
    if (this.dirty && this.state.status !== 'conflict') await this.save();
  }

  /** After a conflict: replace the server copy with the local edits. */
  async overwrite() {
    if (this.state.status !== 'conflict' || this.state.conflictVersion === undefined) return;
    this.set({ status: 'pending', version: this.state.conflictVersion }, ['conflictVersion']);
    this.dirty = true;
    this.writeDraft();
    await this.flush();
  }

  /** Stops timers; the draft stays in storage. */
  close() {
    this.cancelTimer();
    this.layoutId = undefined;
  }

  /** Forgets the open layout's draft (it was deleted, or the user reloads the server copy). */
  discard(layoutId: string) {
    this.options.drafts.remove(layoutId);
    if (this.layoutId === layoutId) {
      this.dirty = false;
      this.close();
    }
  }

  private writeDraft() {
    if (!this.layoutId) return;
    this.options.drafts.write({
      layoutId: this.layoutId,
      baseVersion: this.state.version,
      name: this.content.name,
      items: this.content.items,
      savedAt: this.now().toISOString(),
    });
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(ms: number) {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save();
    }, ms);
  }

  private async save(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      if (this.dirty && this.state.status !== 'conflict') return this.save();
      return;
    }
    const layoutId = this.layoutId;
    if (!layoutId || !this.dirty) return;
    const edits = this.edits;
    const content = this.content;
    const run = async () => {
      this.set({ status: 'saving' }, ['error']);
      try {
        const saved = await this.options.update(layoutId, {
          name: content.name,
          items: content.items,
          version: this.state.version,
        });
        if (this.layoutId !== layoutId) return;
        this.options.onSaved?.(saved);
        if (this.edits === edits) {
          this.dirty = false;
          this.options.drafts.remove(layoutId);
          this.set({ status: 'saved', version: saved.version, restored: false });
        } else {
          // Edited while saving: rebase the draft on the new version and save again.
          this.set({ status: 'pending', version: saved.version });
          this.writeDraft();
          this.schedule(this.debounceMs);
        }
      } catch (err) {
        if (this.layoutId !== layoutId) return;
        if (err instanceof LayoutConflictError) {
          this.set({ status: 'conflict', conflictVersion: err.currentVersion });
        } else {
          this.set({ status: 'offline', error: err instanceof Error ? err.message : String(err) });
          this.schedule(this.retryMs);
        }
      }
    };
    this.inFlight = run().finally(() => {
      this.inFlight = undefined;
    });
    await this.inFlight;
  }
}
