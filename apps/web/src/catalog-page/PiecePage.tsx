import { catalog, type TypeId } from '@my-home/shared';
import { useLayoutMode } from '../overlay/useLayoutMode';
import { href, keptQuery, Link, useDocumentTitle } from '../routing';
import './catalog.css';

/** `/catalog/<kind>/<typeId>`: one piece (the route only exists for a known type). */
export default function PiecePage({ typeId }: { typeId: TypeId }) {
  const type = catalog.get(typeId);
  useDocumentTitle(type?.name);
  const layout = useLayoutMode();
  if (!type) return null;

  return (
    <div className={`page piece-page ${layout === 'desktop' ? 'desktop' : `mobile ${layout}`}`}>
      <header className="page-header">
        <Link className="page-back" to={href({ page: 'catalog' }, keptQuery())}>
          ← Catalogue
        </Link>
        <h1>
          <span aria-hidden="true">{type.icon}</span> {type.name}
        </h1>
      </header>
      <main className="page-main">
        <p className="piece-description">{type.description}</p>
      </main>
    </div>
  );
}
