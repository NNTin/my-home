import { ListNotesResponse, MAX_NOTE_LENGTH, Note } from '@my-home/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedHomes } from '../src/db/seed';
import { clearUserdata, createTestApp, injector } from './helpers';

const agent = { 'x-my-home-actor': 'agent' };
const typeSubject = { kind: 'type', id: 'window.casement' } as const;
const useSubject = { kind: 'use', id: 'souterrain-kitchen-window' } as const;

describe('notes', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let inject: ReturnType<typeof injector>;
  beforeAll(async () => {
    ctx = await createTestApp();
    inject = injector(ctx);
  });
  beforeEach(async () => {
    await clearUserdata(ctx);
    await seedHomes(ctx.database.db);
  });
  afterAll(() => ctx.app.close());

  const add = async (body: object, headers: Record<string, string> = {}) => {
    const res = await inject('POST', '/api/notes', body, headers);
    expect(res.statusCode, res.body).toBe(201);
    return Note.parse(res.json());
  };
  const list = async (query: string) => {
    const res = await inject('GET', `/api/notes?${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return ListNotesResponse.parse(res.json()).items;
  };

  it('adds, lists (oldest first), edits and deletes a use note, recording the actor', async () => {
    const first = await add(
      { subject: useSubject, homeId: 'mock-home', body: '  Sticks  ' },
      agent,
    );
    expect(first).toMatchObject({
      homeId: 'mock-home',
      subject: useSubject,
      body: 'Sticks',
      createdBy: 'agent',
      updatedBy: 'agent',
    });
    const second = await add({ subject: useSubject, homeId: 'mock-home', body: 'Painted' });
    expect(second.createdBy).toBe('owner');
    const query = 'subject=use:souterrain-kitchen-window&homeId=mock-home';
    expect((await list(query)).map((n) => n.id)).toEqual([first.id, second.id]);

    const edited = await inject('PATCH', `/api/notes/${first.id}`, { body: 'Sticks in winter' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(Note.parse(edited.json())).toMatchObject({
      body: 'Sticks in winter',
      createdBy: 'agent',
      updatedBy: 'owner',
      createdAt: first.createdAt,
    });

    const deleted = await inject('DELETE', `/api/notes/${first.id}`, undefined, agent);
    expect(deleted.statusCode).toBe(204);
    expect((await list(query)).map((n) => n.id)).toEqual([second.id]);
    // A deleted note can be neither edited nor deleted again.
    expect((await inject('PATCH', `/api/notes/${first.id}`, { body: 'x' })).statusCode).toBe(404);
    expect((await inject('DELETE', `/api/notes/${first.id}`)).statusCode).toBe(404);
  });

  it('keeps type notes environment-wide and use notes per home', async () => {
    const type = await add({ subject: typeSubject, body: 'All replaced in 2019' });
    expect(type.homeId).toBeNull();
    await add({ subject: useSubject, homeId: 'mock-home', body: 'Use note' });
    expect((await list('subject=type:window.casement')).map((n) => n.body)).toEqual([
      'All replaced in 2019',
    ]);
    // A homeId on a type listing changes nothing: type notes belong to no home.
    expect(await list('subject=type:window.casement&homeId=home')).toHaveLength(1);
    expect(await list('subject=use:souterrain-kitchen-window&homeId=home')).toEqual([]);
  });

  it('accepts notes on placements, trashed ones included', async () => {
    const placed = await inject('POST', '/api/homes/mock-home/placements', {
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      position: { x: -3, z: 2.5 },
    });
    const bed = placed.json() as { id: string };
    await inject('DELETE', `/api/homes/mock-home/placements/${bed.id}?version=1`);
    const note = await add({
      subject: { kind: 'use', id: bed.id },
      homeId: 'mock-home',
      body: 'Old',
    });
    expect(note.subject.id).toBe(bed.id);
  });

  it('validates the body, the subject and the scope', async () => {
    const post = (body: object) => inject('POST', '/api/notes', body);
    expect((await post({ subject: typeSubject, body: '   ' })).statusCode).toBe(400);
    expect(
      (await post({ subject: typeSubject, body: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).statusCode,
    ).toBe(400);
    expect(
      (await post({ subject: typeSubject, body: 'x'.repeat(MAX_NOTE_LENGTH) })).statusCode,
    ).toBe(201);
    expect(
      (await post({ subject: { kind: 'type', id: 'window.nope' }, body: 'x' })).statusCode,
    ).toBe(400);
    expect((await post({ subject: typeSubject, homeId: 'mock-home', body: 'x' })).statusCode).toBe(
      400,
    );
    expect((await post({ subject: useSubject, body: 'x' })).statusCode).toBe(400);
    expect((await post({ subject: useSubject, homeId: 'nope', body: 'x' })).statusCode).toBe(404);
    expect(
      (await post({ subject: { kind: 'use', id: 'nope' }, homeId: 'mock-home', body: 'x' }))
        .statusCode,
    ).toBe(404);
    expect((await post({ subject: { kind: 'room', id: 'x' }, body: 'x' })).statusCode).toBe(400);
    expect((await inject('GET', '/api/notes?subject=window.casement')).statusCode).toBe(400);
    expect(
      (await inject('GET', '/api/notes?subject=use:souterrain-kitchen-window')).statusCode,
    ).toBe(400);
    expect(
      (await inject('PATCH', `/api/notes/${crypto.randomUUID()}`, { body: 'x' })).statusCode,
    ).toBe(404);
  });
});
