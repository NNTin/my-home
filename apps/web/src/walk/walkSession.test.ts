import { afterEach, describe, expect, it } from 'vitest';
import {
  loadWalkSession,
  saveWalkSession,
  WALK_SESSION_KEY,
  WALK_SESSION_MAX_AGE_MS,
} from './walkSession';

const figure = { x: 1, y: -1.2, z: 2, levelId: 'souterrain', yaw: 0.5, pitch: -0.1 };
const walk = { homeId: 'mock-home', view: 'first' as const, figure, heading: true, tilt: false };

describe('walkSession', () => {
  afterEach(() => sessionStorage.clear());

  it('saves and loads the walk of this tab, with a photo on its way and a draft', () => {
    const pending = { figure, sensors: { source: 'manual' as const }, at: 5 };
    saveWalkSession({ ...walk, pending, draft: { note: 'n', tags: ['wall'] } });
    expect(loadWalkSession('mock-home')).toMatchObject({
      ...walk,
      pending,
      draft: { note: 'n', tags: ['wall'] },
    });
  });

  it('forgets the walk', () => {
    saveWalkSession(walk);
    saveWalkSession(undefined);
    expect(sessionStorage.getItem(WALK_SESSION_KEY)).toBeNull();
    expect(loadWalkSession('mock-home')).toBeUndefined();
  });

  it('ignores the walk of another home, an old walk and anything unreadable', () => {
    saveWalkSession(walk);
    expect(loadWalkSession('home')).toBeUndefined();
    expect(loadWalkSession('mock-home', Date.now() + WALK_SESSION_MAX_AGE_MS + 1)).toBeUndefined();
    for (const value of [
      'not json',
      'null',
      JSON.stringify({ ...walk, savedAt: Date.now(), view: 'sideways' }),
      JSON.stringify({ ...walk, savedAt: Date.now(), figure: { ...figure, x: 'one' } }),
      JSON.stringify({ ...walk, figure }),
    ]) {
      sessionStorage.setItem(WALK_SESSION_KEY, value);
      expect(loadWalkSession('mock-home')).toBeUndefined();
    }
  });

  it('drops a malformed photo on its way or draft, and keeps the walk', () => {
    sessionStorage.setItem(
      WALK_SESSION_KEY,
      JSON.stringify({
        ...walk,
        savedAt: Date.now(),
        pending: { figure: null },
        draft: { note: 1, tags: [] },
      }),
    );
    const loaded = loadWalkSession('mock-home');
    expect(loaded).toMatchObject(walk);
    expect(loaded).not.toHaveProperty('pending');
    expect(loaded).not.toHaveProperty('draft');
  });
});
