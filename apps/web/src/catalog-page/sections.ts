import type { CatalogKind, CatalogType } from '@my-home/shared';

/** The headings of the catalogue, one per kind, in this order. */
export const KIND_TITLES: Record<CatalogKind, string> = {
  openings: 'Windows & doors',
  furniture: 'Furniture',
};

export interface CatalogGroup {
  /** Furniture: the category ("Bed room", "Dining", …); openings have one unnamed group. */
  name?: string;
  types: CatalogType[];
}

export interface CatalogSection {
  kind: CatalogKind;
  title: string;
  groups: CatalogGroup[];
}

/** Whether a type matches the search: name, description, type id or category, any case. */
export function matches(type: CatalogType, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [type.name, type.description, type.id, type.category ?? ''].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/**
 * The catalogue as the page lists it: a section per kind; openings in catalogue order (windows,
 * doors, gates), furniture by category and then by name, as the furniture panel does. Sections
 * and groups without a match are left out.
 */
export function catalogSections(types: readonly CatalogType[], query = ''): CatalogSection[] {
  const found = types.filter((t) => matches(t, query));
  return (Object.keys(KIND_TITLES) as CatalogKind[]).flatMap((kind): CatalogSection[] => {
    const ofKind = found.filter((t) => t.kind === kind);
    if (ofKind.length === 0) return [];
    if (kind !== 'furniture')
      return [{ kind, title: KIND_TITLES[kind], groups: [{ types: ofKind }] }];
    const sorted = [...ofKind].sort(
      (a, b) =>
        (a.category ?? 'Other').localeCompare(b.category ?? 'Other') ||
        a.name.localeCompare(b.name),
    );
    const groups: CatalogGroup[] = [];
    for (const type of sorted) {
      const name = type.category ?? 'Other';
      const last = groups.at(-1);
      if (last?.name === name) last.types.push(type);
      else groups.push({ name, types: [type] });
    }
    return [{ kind, title: KIND_TITLES[kind], groups }];
  });
}

/** "1 use", "14 uses". */
export const usesText = (n: number) => `${n} ${n === 1 ? 'use' : 'uses'}`;
