import { catalog, type CatalogType } from '@my-home/shared';
import { useId, useMemo, useState } from 'react';
import { useLayoutMode } from '../overlay/useLayoutMode';
import { href, keptQuery, Link, useDocumentTitle, useRestoredScroll } from '../routing';
import './catalog.css';
import { FinishesSection, listedFinishes } from './Finishes';
import { catalogSections, usesText, type CatalogGroup } from './sections';
import { useThumbnail } from './thumbnails';
import { useUsage, type Usage } from './useUsage';

/** What a card says about the uses: "…" while loading, nothing when the count is unknown. */
function countOf(usage: Usage, type: CatalogType): number | undefined {
  return usage.status === 'ready' ? (usage.counts[type.id] ?? 0) : undefined;
}

function Card({
  type,
  usage,
  home,
}: {
  type: CatalogType;
  usage: Usage;
  home: Record<string, string>;
}) {
  const [element, setElement] = useState<HTMLLIElement | null>(null);
  const thumbnail = useThumbnail(type, element);
  const descriptionId = useId();
  const count = countOf(usage, type);
  return (
    <li ref={setElement} className="catalog-card">
      <Link
        to={href({ page: 'piece', kind: type.kind, typeId: type.id }, home)}
        aria-label={count === undefined ? type.name : `${type.name}, ${usesText(count)}`}
        aria-describedby={descriptionId}
        data-type-id={type.id}
      >
        <span className="catalog-thumb" aria-hidden="true">
          {thumbnail ? <img src={thumbnail} alt="" width={256} height={256} /> : type.icon}
        </span>
        <span className="catalog-text">
          <span className="catalog-name">{type.name}</span>
          <span className="catalog-description" id={descriptionId}>
            {type.description}
          </span>
          {usage.status !== 'error' && (
            <span className="catalog-uses">{count === undefined ? '…' : usesText(count)}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Cards({
  group,
  ...props
}: {
  group: CatalogGroup;
  usage: Usage;
  home: Record<string, string>;
}) {
  return (
    <ul className="catalog-cards">
      {group.types.map((type) => (
        <Card key={type.id} type={type} {...props} />
      ))}
    </ul>
  );
}

/**
 * `/catalog`: every type by kind, with search, thumbnails and the number of uses here; then the
 * finishes of the library.
 */
export default function CatalogPage() {
  useDocumentTitle('Catalogue');
  useRestoredScroll();
  const layout = useLayoutMode();
  const [query, setQuery] = useState('');
  const usage = useUsage();
  const sections = useMemo(() => catalogSections(catalog.types, query), [query]);
  const home = keptQuery();

  return (
    <div className={`page catalog-page ${layout === 'desktop' ? 'desktop' : `mobile ${layout}`}`}>
      <header className="page-header">
        <Link className="page-back" to={href({ page: 'viewer' }, home)}>
          ← Home
        </Link>
        <h1>Catalogue</h1>
        <input
          type="search"
          className="catalog-search"
          aria-label="Search the catalogue"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      <main className="page-main">
        {usage.status === 'error' && (
          <p className="catalog-notice" role="status">
            The number of uses is not available right now.
          </p>
        )}
        {sections.map((section) => (
          <section key={section.kind} aria-labelledby={`kind-${section.kind}`}>
            <h2 id={`kind-${section.kind}`}>{section.title}</h2>
            {section.groups.map((group) =>
              group.name ? (
                <div key={group.name} className="catalog-group">
                  <h3>{group.name}</h3>
                  <Cards group={group} usage={usage} home={home} />
                </div>
              ) : (
                <Cards key="all" group={group} usage={usage} home={home} />
              ),
            )}
          </section>
        ))}
        <FinishesSection query={query} device={layout === 'desktop' ? 'desktop' : 'phone'} />
        {sections.length === 0 && listedFinishes(query).length === 0 && (
          <p role="status">Nothing matches “{query.trim()}”.</p>
        )}
      </main>
    </div>
  );
}
