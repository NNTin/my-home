import { useEffect } from 'react';

const APP = 'my-home';

/** Sets the document title: `my-home`, or `<page> · my-home`. */
export function useDocumentTitle(page?: string): void {
  useEffect(() => {
    document.title = page ? `${page} · ${APP}` : APP;
  }, [page]);
}
