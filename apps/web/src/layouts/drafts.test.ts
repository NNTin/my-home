import type { Layout } from '@my-home/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutItem } from '../test/fixtures';
import { draftStore, lastLayout, resolveDraft, type LayoutDraft } from './drafts';

const server: Layout = {
  id: 'l1',
  homeId: 'mock-home',
  name: 'Default',
  schemaVersion: 1,
  version: 3,
  items: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
const draft = (overrides: Partial<LayoutDraft> = {}): LayoutDraft => ({
  layoutId: 'l1',
  baseVersion: 3,
  name: 'Default',
  items: [layoutItem()],
  savedAt: '2026-01-01T12:00:00.000Z',
  ...overrides,
});

describe('draftStore', () => {
  afterEach(() => localStorage.clear());

  it('writes, reads and removes drafts per layout', () => {
    const store = draftStore();
    store.write(draft());
    expect(store.read('l1')).toEqual(draft());
    expect(store.read('l2')).toBeUndefined();
    store.remove('l1');
    expect(store.read('l1')).toBeUndefined();
  });

  it('ignores corrupt or invalid drafts', () => {
    localStorage.setItem('my-home:layout-draft:l1', '{nope');
    expect(draftStore().read('l1')).toBeUndefined();
    localStorage.setItem(
      'my-home:layout-draft:l1',
      JSON.stringify({ ...draft(), items: [{ id: 'bad id' }] }),
    );
    expect(draftStore().read('l1')).toBeUndefined();
  });

  it('remembers the last layout per home', () => {
    lastLayout.set('mock-home', 'l1');
    expect(lastLayout.get('mock-home')).toBe('l1');
    expect(lastLayout.get('other')).toBeUndefined();
  });
});

describe('resolveDraft', () => {
  it('uses the server copy without a draft, or when the draft matches it', () => {
    expect(resolveDraft(server, undefined)).toMatchObject({ restored: false, baseVersion: 3 });
    expect(resolveDraft(server, draft({ items: [] })).restored).toBe(false);
  });

  it('restores a draft based on the current server version', () => {
    expect(resolveDraft(server, draft())).toEqual({
      name: 'Default',
      items: [layoutItem()],
      baseVersion: 3,
      restored: true,
    });
  });

  it('restores an older-based draft written after the last server update', () => {
    const result = resolveDraft(server, draft({ baseVersion: 2, savedAt: '2026-01-03T00:00:00Z' }));
    // It keeps its old base version, so saving it reports the conflict.
    expect(result).toMatchObject({ restored: true, baseVersion: 2 });
  });

  it('drops a draft that is older than the server copy', () => {
    expect(resolveDraft(server, draft({ baseVersion: 2 })).restored).toBe(false);
  });
});
