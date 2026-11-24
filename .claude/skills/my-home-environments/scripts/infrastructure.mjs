// Requests that belong to what stands in front of the environment, not to my-home. Shared by the browser
// scripts (screenshot.mjs and the smokes).
//
// Cloudflare serves its own endpoints under /cdn-cgi/ on the environment's host and, for some visitors (the
// GitHub runners among them), adds its analytics beacon to every page: POST /cdn-cgi/rum. That is no write to
// my-home. A script that refuses writes must not count it as one, and must not abort it either: an aborted
// request logs "Failed to load resource" in the console, which the scripts report as an error of the page.

/** Whether a request to the environment's host is the infrastructure's own, not the app's. */
export function isInfrastructure(url, host) {
  const { host: requested, pathname } = url instanceof URL ? url : new URL(url);
  return requested === host && pathname.startsWith('/cdn-cgi/');
}

/**
 * Answers an infrastructure request inside the browser, with nothing: it never leaves the browser (so the
 * site token is not sent with it), it is no error in the console, and it is not counted as a write.
 * Returns true when it did; the caller then handles the route no further.
 */
export function answeredInfrastructure(route, host) {
  if (!isInfrastructure(route.request().url(), host)) return false;
  void route.fulfill({ status: 204, body: '' });
  return true;
}
