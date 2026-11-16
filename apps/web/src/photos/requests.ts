import type { PhotoRequest } from '@my-home/shared';

/** Requests still waiting for a photo: open and not in the trash. */
export const openRequests = (requests: PhotoRequest[]) =>
  requests.filter((r) => r.status === 'open' && r.deletedAt === null);

/** A figure within this distance of a request's spot is "there". */
export const REQUEST_REACH = 1.5;

interface Standing {
  x: number;
  z: number;
  levelId?: string | undefined;
  roomId?: string | undefined;
}

/**
 * The open request the next photo answers: the one the owner picked, else the nearest one whose
 * spot the figure stands at, else one that only names the room the figure is in.
 */
export function activeRequest(
  requests: PhotoRequest[],
  figure: Standing,
  chosenId?: string,
): PhotoRequest | undefined {
  const open = openRequests(requests);
  const chosen = open.find((r) => r.id === chosenId);
  if (chosen) return chosen;
  const near = open
    .filter((r) => r.position && (r.levelId ?? undefined) === figure.levelId)
    .map((r) => ({
      request: r,
      distance: Math.hypot(r.position!.x - figure.x, r.position!.z - figure.z),
    }))
    .filter((r) => r.distance <= REQUEST_REACH)
    .sort((a, b) => a.distance - b.distance)[0];
  if (near) return near.request;
  return open.find((r) => !r.position && r.roomId !== null && r.roomId === figure.roomId);
}
