import { z } from 'zod';

export const HealthStatus = z.enum(['ok', 'error']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const HealthResponse = z.object({
  status: HealthStatus,
  uptime: z.number().nonnegative(),
  db: z.object({
    status: HealthStatus,
    driver: z.enum(['pglite', 'postgres']),
    latencyMs: z.number().nonnegative().optional(),
    error: z.string().optional(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `GET /api/health/live`: process liveness only, never touches the database. */
export const LiveResponse = z.object({
  status: z.literal('ok'),
  uptime: z.number().nonnegative(),
  /** Git commit the running image was built from, or null outside a release. */
  commit: z.string().nullable(),
});
export type LiveResponse = z.infer<typeof LiveResponse>;
