import { z } from 'zod';

/** Sample entity for the boilerplate; Epic 2 replaces it with the full home model. */
export const Home = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Home = z.infer<typeof Home>;

export const ListHomesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListHomesQuery = z.infer<typeof ListHomesQuery>;

export const ListHomesResponse = z.object({
  items: z.array(Home),
});
export type ListHomesResponse = z.infer<typeof ListHomesResponse>;
