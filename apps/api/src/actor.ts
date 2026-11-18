import type { ActorSource } from '@my-home/shared';
import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from './config';

export interface ResolvedActor {
  actor: 'owner' | 'agent';
  source: ActorSource;
  username: string | null;
}

const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const value = headers[name];
  const first = (Array.isArray(value) ? value[0] : value)?.trim();
  return first ? first : undefined;
};

/**
 * Who is making a request (docs/userdata.md § Actor):
 *
 * 1. The SSO identity: on deployed hosts Traefik's forwardAuth sets `X-Authentik-Username` and
 *    replaces any copy the client sent. A username in `agentUsernames` is an agent, any other
 *    the owner.
 * 2. Otherwise the declared `X-My-Home-Actor: owner|agent` (local dev, tests, CI smoke).
 * 3. Otherwise the owner.
 */
export function resolveActor(
  headers: IncomingHttpHeaders,
  config: Pick<Config, 'agentUsernames'>,
): ResolvedActor {
  const username = header(headers, 'x-authentik-username');
  if (username !== undefined) {
    const actor = config.agentUsernames.includes(username) ? 'agent' : 'owner';
    return { actor, source: 'identity', username };
  }
  const declared = header(headers, 'x-my-home-actor')?.toLowerCase();
  if (declared === 'owner' || declared === 'agent') {
    return { actor: declared, source: 'declared', username: null };
  }
  return { actor: 'owner', source: 'default', username: null };
}
