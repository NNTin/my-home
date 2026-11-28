// The parts of a browser check (mobile-smoke.mjs, catalog-smoke.mjs): what each one costs on a runner.
// A `time` line is no check: staging-checks.sh counts `ok` and `FAIL` lines, and lists the `time` lines apart.

/** A lap timer: each call prints `time  <name> <seconds> s`, the time since the previous lap (or the start). */
export function stopwatch() {
  let last = performance.now();
  return (name) => {
    const now = performance.now();
    console.log(`time  ${name} ${((now - last) / 1000).toFixed(1)} s`);
    last = now;
  };
}
