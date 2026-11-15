import { describe, expect, it } from 'vitest';
import { Home, ListHomesQuery } from './homes';

describe('shared schemas', () => {
  it('accepts a valid home', () => {
    const home = {
      id: '0b5c7a44-0a43-4c35-8a4c-1f1a2f0f4f11',
      name: 'Mock home',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(Home.parse(home)).toEqual(home);
  });

  it('rejects an empty name', () => {
    expect(Home.safeParse({ id: 'nope', name: '' }).success).toBe(false);
  });

  it('coerces and defaults the list query', () => {
    expect(ListHomesQuery.parse({})).toEqual({ limit: 50 });
    expect(ListHomesQuery.parse({ limit: '5' })).toEqual({ limit: 5 });
  });
});
