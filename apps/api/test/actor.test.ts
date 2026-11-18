import { WhoAmIResponse } from '@my-home/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveActor } from '../src/actor';
import { loadConfig } from '../src/config';
import { createTestApp, injector } from './helpers';

const config = { agentUsernames: ['nntin-bot', 'other-bot'] };

describe('resolveActor', () => {
  it('maps the identity header by username', () => {
    expect(resolveActor({ 'x-authentik-username': 'nntin-bot' }, config)).toEqual({
      actor: 'agent',
      source: 'identity',
      username: 'nntin-bot',
    });
    expect(resolveActor({ 'x-authentik-username': 'other-bot' }, config).actor).toBe('agent');
    expect(resolveActor({ 'x-authentik-username': 'the-owner' }, config)).toEqual({
      actor: 'owner',
      source: 'identity',
      username: 'the-owner',
    });
  });

  it('uses the declared header only without an identity', () => {
    expect(resolveActor({ 'x-my-home-actor': 'agent' }, config)).toEqual({
      actor: 'agent',
      source: 'declared',
      username: null,
    });
    expect(resolveActor({ 'x-my-home-actor': 'Owner' }, config).actor).toBe('owner');
    // A client cannot claim to be an agent (or the owner) past the SSO identity.
    expect(
      resolveActor({ 'x-authentik-username': 'the-owner', 'x-my-home-actor': 'agent' }, config),
    ).toMatchObject({ actor: 'owner', source: 'identity' });
    expect(
      resolveActor({ 'x-authentik-username': 'nntin-bot', 'x-my-home-actor': 'owner' }, config),
    ).toMatchObject({ actor: 'agent', source: 'identity' });
  });

  it('defaults to the owner', () => {
    const owner = { actor: 'owner', source: 'default', username: null };
    expect(resolveActor({}, config)).toEqual(owner);
    expect(resolveActor({ 'x-my-home-actor': 'system' }, config)).toEqual(owner);
    expect(resolveActor({ 'x-authentik-username': '  ' }, config)).toEqual(owner);
  });

  it('reads AGENT_USERNAMES (default nntin-bot)', () => {
    expect(loadConfig({}).agentUsernames).toEqual(['nntin-bot']);
    expect(loadConfig({ AGENT_USERNAMES: ' a , b,' }).agentUsernames).toEqual(['a', 'b']);
  });
});

describe('GET /api/whoami', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());

  it('reports the actor the history would record', async () => {
    const inject = injector(ctx);
    const who = async (headers: Record<string, string>) => {
      const res = await inject('GET', '/api/whoami', undefined, headers);
      expect(res.statusCode).toBe(200);
      return WhoAmIResponse.parse(res.json());
    };
    expect(await who({ 'X-Authentik-Username': 'nntin-bot' })).toEqual({
      username: 'nntin-bot',
      actor: 'agent',
      actorSource: 'identity',
    });
    expect(await who({ 'X-My-Home-Actor': 'agent' })).toEqual({
      username: null,
      actor: 'agent',
      actorSource: 'declared',
    });
    expect(await who({})).toEqual({ username: null, actor: 'owner', actorSource: 'default' });
  });
});
