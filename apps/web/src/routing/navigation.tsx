import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { parseRoute, type Route } from './routes';

/** Sent on `window` after `navigate()`: `pushState` and `replaceState` fire no event themselves. */
const NAVIGATE_EVENT = 'my-home:navigate';

/**
 * Goes to `to` (a path with an optional query) without reloading: a new history entry, or with
 * `replace` the current one. A new page starts at the top; back and forward restore the scroll.
 */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.href);
  const current = window.location;
  if (target.href === current.href) return;
  const pageChanged = target.pathname !== current.pathname;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  if (pageChanged && !replace && window.scrollY > 0) window.scrollTo({ top: 0 });
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/** The current path, following `navigate()` and the back and forward buttons. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** The page the address shows. */
export function useRoute(): Route {
  const pathname = usePathname();
  return useMemo(() => parseRoute(pathname), [pathname]);
}

/** A plain left click that the browser would follow in this tab. */
function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    (!e.currentTarget.target || e.currentTarget.target === '_self')
  );
}

/**
 * A link inside the app: a real `<a href>`, so long press, open in a new tab and copy link work.
 * A plain left click navigates without a reload; modified clicks are left to the browser.
 */
export function Link({
  to,
  replace,
  onClick,
  ...props
}: { to: string; replace?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (!isPlainClick(e)) return;
        const target = new URL(to, window.location.href);
        if (target.origin !== window.location.origin) return;
        e.preventDefault();
        navigate(target.pathname + target.search + target.hash, { replace });
      }}
    />
  );
}
