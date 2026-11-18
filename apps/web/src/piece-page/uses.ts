import {
  effectiveParams,
  formatCm,
  modelUses,
  type CatalogType,
  type HomeModel,
  type HomeSummary,
  type ParamValues,
  type Photo,
  type Placement,
  type PhotoRequest,
  type Use,
} from '@my-home/shared';
import { previewContext } from '../catalog-page/preview';
import type { PieceContext } from '../catalog/types';
import { openRequests } from '../photos/requests';

/**
 * The piece page's uses, as pure functions: where-used grouped by home and level, the
 * needs-attention entries, a short summary of a use's overrides, the context its preview is drawn
 * in, and the `#use=<useId>` anchor of the address.
 */

/** Everything the piece page loaded about one home of this environment. */
export interface HomeData {
  home: HomeSummary;
  model: HomeModel | undefined;
  /** The uses of this page's type (where-used). */
  uses: Use[];
  /** Every placement of the home, the trashed ones included (furniture types only, else []). */
  placements: Placement[];
  photos: Photo[];
  requests: PhotoRequest[];
  /** Why the home could not be loaded (it is shown, the other homes still work). */
  error?: string;
  /**
   * Why the last reload failed (after a write that worked): the data shown is the one before, and
   * the notice says it may be out of date. Cleared by the next reload that works.
   */
  notice?: string;
}

/** A use in a list: the use and the home it is in. */
export interface UseRow {
  homeId: string;
  use: Use;
  /** The override is for an opening that is no longer in the home model. */
  orphan: boolean;
}

export interface LevelGroup {
  id: string;
  name: string;
  rows: UseRow[];
}

export interface HomeGroup {
  data: HomeData;
  levels: LevelGroup[];
  /** Placements of this type in the home's trash (furniture). */
  trash: Placement[];
}

export interface WhereUsed {
  /** The uses in this environment, as the catalogue counts them (orphan overrides left out). */
  count: number;
  attention: UseRow[];
  homes: HomeGroup[];
}

const OUTSIDE = { id: '', name: 'Outside the levels' };

/**
 * The uses of every home, grouped by home, then by level (in the model's order) and sorted by
 * room within a level. Uses that need attention are listed apart, first, and not again below.
 */
export function whereUsed(type: CatalogType, homes: HomeData[]): WhereUsed {
  let count = 0;
  const attention: UseRow[] = [];
  const groups = homes.map((data): HomeGroup => {
    const inModel = new Set(data.model ? modelUses(data.model).map((u) => u.id) : []);
    const levels = new Map<string, LevelGroup>();
    for (const level of data.model?.levels ?? [])
      levels.set(level.id, { id: level.id, name: level.name, rows: [] });
    for (const use of data.uses) {
      const orphan = use.source === 'git' && data.model !== undefined && !inModel.has(use.id);
      if (!orphan) count++;
      const row = { homeId: data.home.id, use, orphan };
      if (use.status === 'needs-attention') {
        attention.push(row);
        continue;
      }
      const key = use.levelId !== null && levels.has(use.levelId) ? use.levelId : OUTSIDE.id;
      if (!levels.has(key)) levels.set(key, { ...OUTSIDE, rows: [] });
      levels.get(key)!.rows.push(row);
    }
    const roomName = (row: UseRow) => {
      const id = row.use.roomIds[0];
      return data.model?.rooms.find((r) => r.id === id)?.name ?? '';
    };
    for (const level of levels.values()) {
      level.rows.sort(
        (a, b) => roomName(a).localeCompare(roomName(b)) || a.use.name.localeCompare(b.use.name),
      );
    }
    return {
      data,
      levels: [...levels.values()].filter((l) => l.rows.length > 0),
      trash: data.placements.filter((p) => p.typeId === type.id && p.removedAt !== null),
    };
  });
  return { count, attention, homes: groups };
}

/** One overridden value for people: "width 180.0 cm", "2 sashes", or a colour with its swatch. */
export interface OverrideText {
  key: string;
  text: string;
  color?: string;
}

/** The overrides of a use as short texts, in the type's parameter order. */
export function overrideSummary(type: CatalogType, overrides: ParamValues): OverrideText[] {
  const { ignored } = effectiveParams(type, overrides);
  return Object.entries(type.params)
    .filter(([key]) => key in overrides && !ignored.includes(key))
    .map(([key, spec]) => {
      const value = overrides[key]!;
      const label = spec.label.toLowerCase();
      switch (spec.type) {
        case 'color':
          return { key, text: `${label} ${String(value)}`, color: String(value) };
        case 'length':
          return { key, text: `${label} ${formatCm(Number(value))}` };
        case 'count':
          return {
            key,
            text: `${value} ${spec.each ? (value === 1 ? spec.each.one : spec.each.other) : label}`,
          };
        default:
          return { key, text: `${label} ${value}` };
      }
    });
}

/**
 * Where a use is drawn on the piece page: a wall opening in its real hole (width, height, the
 * wall's depth and its sill), an outbuilding opening or a roof window in its real size, furniture
 * at its effective size. A gate stands on its own (its fence line is no hole), as in the preview.
 */
export function contextOfUse(
  type: CatalogType,
  values: ParamValues,
  model: HomeModel | undefined,
  useId: string,
): PieceContext {
  const preview = previewContext(type, values);
  if (type.kind === 'furniture' || !model) return preview;
  const opening = model.openings.find((o) => o.id === useId);
  if (opening) {
    const wall = model.walls.find((w) => w.id === opening.wallId);
    return {
      width: opening.width.value,
      height: opening.height.value,
      wallDepth: wall?.thickness.value ?? preview.wallDepth,
      sill: opening.sill.value,
    };
  }
  for (const b of model.outbuildings ?? []) {
    const o = b.openings?.find((x) => x.id === useId);
    if (o) {
      return {
        width: o.width.value,
        height: o.height.value,
        wallDepth: b.wallThickness.value,
        sill: o.sill.value,
      };
    }
  }
  const roof = model.building.roof;
  const window = roof?.type === 'gable' ? roof.windows?.find((w) => w.id === useId) : undefined;
  if (window) {
    return { width: window.width.value, height: window.length.value, wallDepth: preview.wallDepth };
  }
  return preview;
}

/** The photos linked to a use. */
export const photosOfUse = (photos: Photo[], useId: string) =>
  photos.filter((p) => p.subjects.some((s) => s.kind === 'use' && s.id === useId));

/** The photos of a type: linked to the type itself or to one of its uses in that home. */
export function photosOfType(typeId: string, homes: HomeData[]): Photo[] {
  return homes.flatMap((data) => {
    const uses = new Set(data.uses.map((u) => u.id));
    return data.photos.filter((p) =>
      p.subjects.some(
        (s) => (s.kind === 'type' && s.id === typeId) || (s.kind === 'use' && uses.has(s.id)),
      ),
    );
  });
}

/** The open photo requests about a use. */
export const requestsOfUse = (requests: PhotoRequest[], useId: string) =>
  openRequests(requests).filter((r) => r.subject?.kind === 'use' && r.subject.id === useId);

/** `#use=<useId>`: the use to open; undefined without one. */
export function hashedUseId(hash: string): string | undefined {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('use');
  return value === null || value === '' ? undefined : value;
}

/** The anchor of a use: `#use=<useId>`. */
export const hashOfUse = (useId: string) => `#use=${encodeURIComponent(useId)}`;

/** The DOM id of a use's row (ids of different homes may be equal). */
export const rowId = (homeId: string, useId: string) => `use-${homeId}-${useId}`;
