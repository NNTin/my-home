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
