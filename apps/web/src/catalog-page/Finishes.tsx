import {
  deviceTextureFiles,
  finishes,
  type DeviceClass,
  type Finish,
  type FinishSurface,
} from '@my-home/shared';
import { textureUrl } from '../finishes/urls';

/**
 * The finishes of the library on the catalogue page (docs/catalog.md): what each is for, and for
 * a textured one where its texture comes from and under which licence. Finishes are chosen in
 * the home file; nothing here is a link to a page of its own.
 */

const SURFACE_NAMES: Record<FinishSurface, string> = {
  floor: 'floors',
  wall: 'walls',
  ceiling: 'ceilings',
  facade: 'facades',
  roof: 'roofs',
  ground: 'the ground',
  part: 'catalogue parts',
};

/** Whether a finish matches the search: name, description or id, any case. */
export function finishMatches(finish: Finish, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [finish.name, finish.description, finish.id].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/** The finishes the page lists for a search, in library order. */
export const listedFinishes = (query = ''): Finish[] =>
  finishes.finishes.filter((f) => finishMatches(f, query));

/** "For floors and walls"; a finish no home can name says who draws it. */
export function surfacesText(finish: Finish): string {
  const names = finish.surfaces.map((s) => SURFACE_NAMES[s]);
  if (names.length === 0) return 'Drawn by the viewer only';
  const last = names.pop()!;
  return `For ${names.length ? `${names.join(', ')} and ${last}` : last}`;
}

function FinishCard({ finish, device }: { finish: Finish; device: DeviceClass }) {
  // The colour map this device would fetch anyway; a plain or relief-only finish shows its tint.
  const color = deviceTextureFiles(finish, device).find((f) => f.map === 'color');
  const image = color && textureUrl(color.path);
  const { source } = finish;
  return (
    <li className="catalog-card finish-card" data-finish-id={finish.id}>
      <div className="finish">
        <span className="catalog-thumb finish-swatch" style={{ background: finish.tint }}>
          {image && <img src={image} alt="" width={256} height={256} loading="lazy" />}
        </span>
        <span className="catalog-text">
          <span className="catalog-name">{finish.name}</span>
          <code className="finish-id">{finish.id}</code>
          <span className="catalog-description">{finish.description}</span>
          <span className="catalog-uses">
            {surfacesText(finish)}
            {finish.tintable ? ' · can be tinted' : ''}
            {finish.tileSize !== undefined ? ` · one repeat covers ${finish.tileSize} m` : ''}
          </span>
          <span className="finish-source">
            {source ? (
              <>
                Texture:{' '}
                <a href={source.url} rel="noreferrer">
                  {source.provider} · {source.assetId}
                </a>
                , licence {source.licence}
              </>
            ) : (
              'A plain colour: no texture'
            )}
          </span>
        </span>
      </div>
    </li>
  );
}

export function FinishesSection({ query, device }: { query: string; device: DeviceClass }) {
  const found = listedFinishes(query);
  if (found.length === 0) return null;
  return (
    <section aria-labelledby="kind-finishes">
      <h2 id="kind-finishes">Finishes</h2>
      <p className="catalog-note">
        Surface materials of rooms, the facade, the roof and the ground. A home names them in its
        file; a surface without one draws the default for its kind. Every texture is from a CC0
        library.
      </p>
      <ul className="catalog-cards">
        {found.map((finish) => (
          <FinishCard key={finish.id} finish={finish} device={device} />
        ))}
      </ul>
    </section>
  );
}
