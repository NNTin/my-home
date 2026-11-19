import {
  catalog,
  type CreatePlacementBody,
  type ListPlacementsResponse,
  type Placement,
  type UpdatePlacementBody,
} from '@my-home/shared';
import { ApiRequestError } from '../api';
import { elevationOfItem, mountingOfItem, type EditorItem } from '../editor/item';

export type SyncStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'rejected' | 'conflict';

export interface SyncState {
  status: SyncStatus;
  /** The last error (offline or rejected). */
  error?: string;
  /** Set with `conflict`: what was changed elsewhere and reloaded, e.g. "Bedroom · Bed". */
  changedElsewhere?: string[];
  /** Pending changes from an earlier visit were restored from this browser. */
  restored: boolean;
}

/** The placements API as the sync uses it (`placementsApi` in `api.ts`). */
export interface PlacementsClient {
  list(homeId: string): Promise<ListPlacementsResponse>;
  create(homeId: string, body: CreatePlacementBody): Promise<Placement>;
  update(homeId: string, id: string, body: UpdatePlacementBody): Promise<Placement>;
  remove(homeId: string, id: string, version: number): Promise<Placement>;
  restore(homeId: string, id: string): Promise<Placement>;
}

/** A change the server does not have yet; what `my-home:placement-ops:<homeId>` stores. */
export type PendingOp =
  | { op: 'create'; id: string; item: EditorItem }
  | { op: 'update'; id: string; item: EditorItem; baseVersion: number; restore?: boolean }
  | { op: 'delete'; id: string; baseVersion: number };

export interface OpStore {
  read(homeId: string): PendingOp[];
  write(homeId: string, ops: PendingOp[]): void;
}

const PREFIX = 'my-home:placement-ops:';

/** localStorage, best effort: disabled storage or a full quota only loses the offline cache. */
export function opStore(storage?: Storage): OpStore {
  const s = (() => {
    try {
      return storage ?? globalThis.localStorage;
    } catch {
      return undefined;
    }
  })();
  return {
    read(homeId) {
      try {
        const raw = s?.getItem(PREFIX + homeId);
        const value: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(value) ? value.filter(isOp) : [];
      } catch {
        return [];
      }
    },
    write(homeId, ops) {
      try {
        if (ops.length === 0) s?.removeItem(PREFIX + homeId);
        else s?.setItem(PREFIX + homeId, JSON.stringify(ops));
      } catch {
        // Best effort.
      }
    },
  };
}

function isOp(value: unknown): value is PendingOp {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  const item = v.item as Record<string, unknown> | undefined;
  const validItem =
    !!item && typeof item.id === 'string' && typeof item.typeId === 'string' && !!item.position;
  if (v.op === 'create') return validItem;
  if (v.op === 'update') return validItem && typeof v.baseVersion === 'number';
  return v.op === 'delete' && typeof v.baseVersion === 'number';
}

/** The editor's view of a placement. */
export function toEditorItem(p: Placement): EditorItem {
  return {
    id: p.id,
    typeId: p.typeId,
    name: p.name,
    levelId: p.levelId,
    ...(p.roomId !== null && { roomId: p.roomId }),
    position: { x: p.position.x, z: p.position.z },
    rotationY: p.rotationY,
    ...(p.mounting !== 'floor' && { mounting: p.mounting }),
    ...(p.mounting !== 'ceiling' && p.elevation !== 0 && { elevation: p.elevation }),
    params: { ...p.params },
  };
}

/** JSON with sorted keys: the server's jsonb does not keep the key order of `params`. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** The fields of `item` that differ from the server's copy (a PATCH body without `version`). */
export function changedFields(
  server: EditorItem,
  item: EditorItem,
): Omit<UpdatePlacementBody, 'version'> {
  const body: Omit<UpdatePlacementBody, 'version'> = {};
  if (item.name !== '' && item.name !== server.name) body.name = item.name;
  if (item.levelId !== server.levelId) body.levelId = item.levelId;
  if (item.position.x !== server.position.x || item.position.z !== server.position.z) {
    body.position = { x: item.position.x, z: item.position.z };
  }
  if (item.rotationY !== server.rotationY) body.rotationY = item.rotationY;
  if (mountingOfItem(item) !== mountingOfItem(server)) body.mounting = mountingOfItem(item);
  if (elevationOfItem(item) !== elevationOfItem(server)) body.elevation = elevationOfItem(item);
  if (canonical(item.params) !== canonical(server.params)) body.params = { ...item.params };
  return body;
}

interface Known {
  item: EditorItem;
  version: number;
  removed: boolean;
}

/** The pending changes: what the editor has (`desired`) that the server (`known`) has not. */
export function pendingOps(
  known: ReadonlyMap<string, Known>,
  desired: ReadonlyMap<string, EditorItem>,
): PendingOp[] {
  const ops: PendingOp[] = [];
  for (const [id, item] of desired) {
    const k = known.get(id);
    if (!k) ops.push({ op: 'create', id, item });
    else if (k.removed) ops.push({ op: 'update', id, item, baseVersion: k.version, restore: true });
    else if (Object.keys(changedFields(k.item, item)).length > 0) {
      ops.push({ op: 'update', id, item, baseVersion: k.version });
    }
  }
  for (const [id, k] of known) {
    if (!k.removed && !desired.has(id)) ops.push({ op: 'delete', id, baseVersion: k.version });
  }
  return ops;
}

export interface SyncOptions {
  homeId: string;
  api: PlacementsClient;
  ops?: OpStore;
  onChange(state: SyncState): void;
  /**
   * The server's copy of one item replaces the editor's: a created item's stable id and name
   * (`from` = its temporary id), or an item reloaded after a conflict (undefined: it is gone).
   */
  onSynced(from: string, item: EditorItem | undefined): void;
  retryMs?: number;
}

/** An op without its base version: the same change asked for again after it was saved. */
const sameChange = (op: PendingOp) =>
  canonical({ op: op.op, id: op.id, item: 'item' in op ? op.item : null });

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Saves the editor's furniture to the home's placement set, item by item. After each committed
 * edit (`edit`), the items are compared by id with the server's last known copy:
 * - a new item is `POST`ed; the server's id and name come back through `onSynced`;
 * - a changed one is `PATCH`ed with its version (only the changed fields);
 * - a gone one is `DELETE`d (to the trash), and restored when it comes back (undo).
 * One call runs at a time, so calls for the same item never overlap. The pending changes are kept
 * in localStorage and replayed after a reload (`open`) or retried after a failure; a 409 (an agent
 * or another tab changed the item) reloads that item from the server: "changed elsewhere". Any
 * other 4xx puts the item back to the server's copy and says "Not saved" with the reason.
 */
export class PlacementSync {
  private known = new Map<string, Known>();
  private desired = new Map<string, EditorItem>();
  /** Temporary id → stable id, for edits made while their create was on its way. */
  private aliases = new Map<string, string>();
  /** The server refused a change (a 4xx): "Not saved" with its reason, until the next edit. */
  private refused = false;
  private running: Promise<void> | undefined;
  private busy = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private offline = false;
  private closed = false;
  private state: SyncState = { status: 'saved', restored: false };
  private readonly ops: OpStore;
  private readonly retryMs: number;

  constructor(private readonly options: SyncOptions) {
    this.ops = options.ops ?? opStore();
    this.retryMs = options.retryMs ?? 5000;
  }

  get current(): SyncState {
    return this.state;
  }

  /** Nothing is waiting to be saved. */
  get idle(): boolean {
    return !this.running && this.pending().length === 0;
  }

  /**
   * Starts from the server's placements (trashed ones included) and replays the changes this
   * browser had not saved yet; returns the items to show. A pending change to an item that was
   * changed elsewhere meanwhile is dropped ("changed elsewhere").
   */
  open(placements: Placement[]): EditorItem[] {
    this.setServer(placements);
    const stale: string[] = [];
    let restored = false;
    for (const op of this.ops.read(this.options.homeId)) {
      const k = this.known.get(op.id);
      if (op.op === 'create') {
        if (!k && !this.desired.has(op.id)) {
          this.desired.set(op.id, op.item);
          restored = true;
        }
      } else if (k && k.version === op.baseVersion) {
        if (op.op === 'update') this.desired.set(op.id, op.item);
        else this.desired.delete(op.id);
        restored = true;
      } else if (k) {
        stale.push(k.item.name);
      }
    }
    this.persist();
    this.state = { status: 'saved', restored };
    if (stale.length > 0) this.state.changedElsewhere = stale;
    this.update();
    this.kick();
    return [...this.desired.values()];
  }

  /**
   * The server's placements, reloaded (the tab became visible again): taken as they are when
   * nothing is pending; returns the items to show, or undefined when edits are still pending.
   */
  refresh(placements: Placement[]): EditorItem[] | undefined {
    if (!this.idle) return undefined;
    this.setServer(placements);
    this.persist();
    return [...this.desired.values()];
  }

  /** Records a committed edit: the editor's items as they are now. */
  edit(items: readonly EditorItem[]) {
    const next = new Map<string, EditorItem>();
    for (const item of items) {
      const id = this.aliases.get(item.id) ?? item.id;
      next.set(id, id === item.id ? item : { ...item, id });
    }
    const before = canonical(this.pending());
    this.desired = next;
    const after = this.pending();
    if (canonical(after) === before) return;
    const rest = { ...this.state };
    delete rest.changedElsewhere;
    this.state = rest;
    this.refused = false;
    this.persist();
    this.update();
    this.kick();
  }

  /** Waits until every pending change was tried once (tests, leaving the page). */
  async flush() {
    while (this.running) await this.running;
  }

  /** Stops retrying; pending changes stay in storage for the next visit. */
  close() {
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setServer(placements: Placement[]) {
    this.known = new Map(
      placements.map((p) => [
        p.id,
        { item: toEditorItem(p), version: p.version, removed: p.removedAt !== null },
      ]),
    );
    this.desired = new Map(
      placements.filter((p) => p.removedAt === null).map((p) => [p.id, toEditorItem(p)]),
    );
  }

  private pending() {
    return pendingOps(this.known, this.desired);
  }

  private persist() {
    this.ops.write(this.options.homeId, this.pending());
  }

  private set(state: SyncState) {
    this.state = state;
    this.options.onChange(state);
  }

  /**
   * Derives the status; `rejected` (the server refused a change) and `conflict` ("changed
   * elsewhere") stay until the next edit. Neither leaves anything pending: the item is back at
   * the server's copy.
   */
  private update() {
    const { restored, error, changedElsewhere } = this.state;
    const base: SyncState = { status: 'saved', restored };
    if (changedElsewhere) base.changedElsewhere = changedElsewhere;
    const open = this.pending();
    let next: SyncState;
    if (this.busy && open.length > 0) next = { ...base, status: 'saving' };
    else if (this.offline && open.length > 0) next = { ...base, status: 'offline' };
    else if (open.length > 0) next = { ...base, status: 'pending' };
    else if (this.refused) next = { ...base, status: 'rejected' };
    else if (changedElsewhere) next = { ...base, status: 'conflict' };
    else next = base;
    if (error !== undefined && (next.status === 'offline' || next.status === 'rejected')) {
      next.error = error;
    }
    this.set(next);
  }

  /**
   * A change the server refused: the item goes back to the server's copy (a refused create is
   * dropped), so nothing stays pending, blocks the reload of the tab or comes back next visit.
   */
  private revert(id: string) {
    const k = this.known.get(id);
    const item = k && !k.removed ? k.item : undefined;
    if (item) this.desired.set(id, item);
    else this.desired.delete(id);
    this.options.onSynced(id, item);
  }

  private kick() {
    if (this.closed) return;
    if (this.running) {
      // The loop may have just ended (its `finally` has not run yet): run again after it.
      this.again = true;
      return;
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.again = false;
    this.running = this.run().finally(() => {
      this.running = undefined;
      this.update();
      if (this.again && !this.offline) this.kick();
    });
  }

  private async run() {
    this.busy = true;
    try {
      await this.loop();
    } finally {
      this.busy = false;
    }
  }

  private async loop() {
    let done: string | undefined;
    for (;;) {
      if (this.closed) return;
      const op = this.pending()[0];
      if (!op) return;
      if (sameChange(op) === done) {
        // The server stored it differently (e.g. a colour in lower case): take its copy.
        this.revert(op.id);
        continue;
      }
      this.update();
      try {
        await this.perform(op);
        this.offline = false;
        done = sameChange(op);
      } catch (err) {
        if (err instanceof ApiRequestError && (err.status === 409 || err.status === 404)) {
          try {
            await this.reload(op.id);
          } catch (e) {
            this.fail(e);
            return;
          }
        } else if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
          this.revert(op.id);
          this.refused = true;
          this.state = { ...this.state, error: message(err) };
        } else {
          this.fail(err);
          return;
        }
      } finally {
        this.persist();
      }
    }
  }

  private fail(err: unknown) {
    this.offline = true;
    this.state = { ...this.state, error: message(err) };
    if (!this.closed) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.kick();
      }, this.retryMs);
    }
  }

  private remember(p: Placement) {
    this.known.set(p.id, {
      item: toEditorItem(p),
      version: p.version,
      removed: p.removedAt !== null,
    });
  }

  private async perform(op: PendingOp) {
    const { api, homeId } = this.options;
    if (op.op === 'create') {
      const { item } = op;
      const created = await api.create(homeId, {
        typeId: item.typeId,
        levelId: item.levelId,
        position: item.position,
        rotationY: item.rotationY,
        mounting: mountingOfItem(item),
        elevation: elevationOfItem(item),
        params: item.params,
        ...(item.name !== '' && { name: item.name }),
      });
      this.remember(created);
      this.aliases.set(op.id, created.id);
      // The editor may have changed or removed the item while the request was on its way.
      const now = this.desired.get(op.id);
      this.desired = new Map(
        [...this.desired].map(([id, i]) =>
          id === op.id
            ? [created.id, { ...i, id: created.id, name: i.name || created.name }]
            : [id, i],
        ),
      );
      const synced = now && { ...now, id: created.id, name: now.name || created.name };
      if (synced) this.options.onSynced(op.id, synced);
      return;
    }
    if (op.op === 'delete') {
      this.remember(await api.remove(homeId, op.id, op.baseVersion));
      return;
    }
    let version = op.baseVersion;
    if (op.restore) {
      const restored = await api.restore(homeId, op.id);
      this.remember(restored);
      version = restored.version;
    }
    const k = this.known.get(op.id)!;
    const body = changedFields(k.item, op.item);
    if (Object.keys(body).length === 0) return;
    this.remember(await api.update(homeId, op.id, { version, ...body }));
  }

  /** After a 409 or 404: the server's copy of the item replaces the editor's. */
  private async reload(id: string) {
    const { items } = await this.options.api.list(this.options.homeId);
    const fresh = items.find((p) => p.id === id);
    // A new item (a temporary id) has no name yet: its type's name.
    const local = this.desired.get(id);
    const name =
      this.known.get(id)?.item.name ||
      fresh?.name ||
      local?.name ||
      (local && (catalog.get(local.typeId)?.name ?? local.typeId)) ||
      id;
    if (fresh) this.remember(fresh);
    else this.known.delete(id);
    const item = fresh && fresh.removedAt === null ? toEditorItem(fresh) : undefined;
    if (item) this.desired.set(id, item);
    else this.desired.delete(id);
    this.options.onSynced(id, item);
    const names = [...new Set([...(this.state.changedElsewhere ?? []), name])];
    this.state = { ...this.state, changedElsewhere: names };
  }
}
