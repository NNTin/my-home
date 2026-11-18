import { pino } from 'pino';
import sharp from 'sharp';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase } from '../src/db/client';
import { photoRequests, photos } from '../src/db/media-schema';
import { homes } from '../src/db/schema';
import {
  history,
  homeSettings,
  imports,
  issuedIds,
  notes,
  openingOverrides,
  placements,
} from '../src/db/userdata-schema';

/**
 * Builds the app against in-memory PGlite, or against the Postgres in DATABASE_URL (CI).
 * Migrations run once per app; the tables are emptied so each test starts clean (deleting the
 * homes cascades to their layouts). Photos live in their own schema: tests that create them
 * call `clearMedia`.
 */
export async function createTestApp(env: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({
    ...process.env,
    ...env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PGLITE_DIR: 'memory://',
  });
  const logger = pino({ level: 'silent' });
  const database = createDatabase(config, logger);
  await database.migrate();
  await database.db.delete(homes);
  const app = await buildApp(config, database, logger);
  app.addHook('onClose', () => database.close());
  await app.ready();
  return { app, database };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Empties the test database's photo tables (blobs and thumbnails cascade). */
export async function clearMedia({ database }: Pick<TestApp, 'database'>) {
  await database.db.delete(photos);
  await database.db.delete(photoRequests);
}

/** Empties the test database's userdata tables (placements, overrides, history, ids, notes, settings, imports). */
export async function clearUserdata({ database }: Pick<TestApp, 'database'>) {
  await database.db.delete(placements);
  await database.db.delete(openingOverrides);
  await database.db.delete(history);
  await database.db.delete(issuedIds);
  await database.db.delete(notes);
  await database.db.delete(homeSettings);
  await database.db.delete(imports);
}

/** `app.inject` with a JSON body; `actor` sends the declared `X-My-Home-Actor` header. */
export function injector({ app }: Pick<TestApp, 'app'>) {
  return (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers,
      ...(payload !== undefined && { payload: payload as object }),
    });
}

/** A synthetic test image: a flat colour, no metadata unless `exif` is given. */
export async function testImage(
  options: {
    width?: number;
    height?: number;
    format?: 'jpeg' | 'png' | 'webp' | 'gif';
    exif?: Parameters<ReturnType<typeof sharp>['withExif']>[0];
    orientation?: number;
  } = {},
): Promise<Buffer> {
  const { width = 64, height = 48, format = 'jpeg' } = options;
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  });
  if (options.exif) image = image.withExif(options.exif);
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return image.toFormat(format).toBuffer();
}

/** A multipart upload for `app.inject`: the `meta` JSON part and the `image` file part. */
export async function uploadPayload(meta: unknown, image: Buffer | undefined) {
  const form = new FormData();
  if (meta !== undefined) form.set('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  if (image) form.set('image', new Blob([new Uint8Array(image)]), 'photo.jpg');
  const response = new Response(form);
  return {
    payload: Buffer.from(await response.arrayBuffer()),
    headers: { 'content-type': response.headers.get('content-type')! },
  };
}
