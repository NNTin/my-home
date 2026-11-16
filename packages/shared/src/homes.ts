import { z } from 'zod';
import { Id } from './home-model';

/** A stored home without its model, as listed by `GET /api/homes`. */
export const HomeSummary = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type HomeSummary = z.infer<typeof HomeSummary>;

export const ListHomesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListHomesQuery = z.infer<typeof ListHomesQuery>;

export const ListHomesResponse = z.object({
  items: z.array(HomeSummary),
});
export type ListHomesResponse = z.infer<typeof ListHomesResponse>;

export const HomeParams = z.object({ id: Id });
export type HomeParams = z.infer<typeof HomeParams>;

/** Body of every 4xx/5xx response; validation failures list path-based `issues`. */
export const ApiError = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
