import { navigate } from '../routing/navigation';
import { useListeners } from './useElement';

/**
 * An element with `href` renders a real `<a>` (open in a new tab, copy the link). A plain left click on it goes
 * through the app's router instead of loading the page, as the app's `Link` does (docs/design/hud.md §7.4).
 */
export function useLink(
  host: HTMLElement | null,
  href: string | undefined,
  { replace = false }: { replace?: boolean } = {},
) {
  useListeners(host, {
    click:
      href === undefined
        ? undefined
        : (event) => {
            const e = event as MouseEvent;
            if (
              e.defaultPrevented ||
              e.button !== 0 ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey ||
              e.altKey
            )
              return;
            if (host?.hasAttribute('disabled')) return;
            const target = new URL(href, window.location.href);
            if (target.origin !== window.location.origin) return;
            e.preventDefault();
            navigate(target.pathname + target.search + target.hash, { replace });
          },
  });
}
