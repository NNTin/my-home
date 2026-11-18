import { catalog, CatalogKind, TypeId } from '@my-home/shared';

/**
 * The pages of the app and their paths. There is no router library: three routes, the history
 * API and `popstate` are all it takes (docs/catalog.md).
 */
export type Route =
  | { page: 'viewer' } // "/"
  | { page: 'catalog' } // "/catalog"
  | { page: 'piece'; kind: CatalogKind; typeId: TypeId } // "/catalog/<kind>/<typeId>"
  | { page: 'not-found' };

const notFound: Route = { page: 'not-found' };

/** Decodes one path segment; undefined when it is not valid percent-encoding. */
function segment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * The page a path shows. One trailing slash is allowed (`/catalog/`); a piece needs a known
 * type of that kind (`/catalog/furniture/furniture.bed`). Anything else is not found.
 */
export function parseRoute(pathname: string): Route {
  if (pathname === '' || pathname === '/') return { page: 'viewer' };
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const parts = path.split('/').slice(1);
  if (parts[0] !== 'catalog') return notFound;
  if (parts.length === 1) return { page: 'catalog' };
  if (parts.length !== 3) return notFound;
  const [kind, typeId] = parts.slice(1).map(segment);
  const k = CatalogKind.safeParse(kind);
  const t = TypeId.safeParse(typeId);
  if (!k.success || !t.success) return notFound;
  const type = catalog.get(t.data);
  if (!type || type.kind !== k.data) return notFound;
  return { page: 'piece', kind: k.data, typeId: t.data };
}

/** The path of a route (not-found has none and goes home). */
export function pathOf(route: Route): string {
  switch (route.page) {
    case 'viewer':
    case 'not-found':
      return '/';
    case 'catalog':
      return '/catalog';
    case 'piece':
      return `/catalog/${route.kind}/${encodeURIComponent(route.typeId)}`;
  }
}

/** A link to a route; empty query values are left out. */
export function href(route: Route, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== ''),
  ).toString();
  return search ? `${pathOf(route)}?${search}` : pathOf(route);
}

/**
 * The query every page keeps: `?home=` (from `search`, the current one by default). The viewer's
 * own parameters (`?walk=`, `?panel=`, `?sheet=`, `?hints=`) are dropped when leaving a page.
 */
export function keptQuery(search = window.location.search): Record<string, string> {
  const home = new URLSearchParams(search).get('home');
  return home ? { home } : {};
}
