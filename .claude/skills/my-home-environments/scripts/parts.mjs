// The parts of a browser check (mobile-smoke.mjs, catalog-smoke.mjs, visual-diff.sh): what each one costs on
// a runner, and which of them a shard runs. A `time` or `shard` line is no check: staging-checks.sh counts `ok`
// and `FAIL` lines, and lists the others apart.
//   node parts.mjs shard <check> <i/n> <part>...   prints the parts of shard i of n, one per line, in order
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A lap timer: each call prints `time  <name> <seconds> s`, the time since the previous lap (or the start). */
export function stopwatch() {
  let last = performance.now();
  return (name) => {
    const now = performance.now();
    console.log(`time  ${name} ${((now - last) / 1000).toFixed(1)} s`);
    last = now;
  };
}

/** `i/n` (1 ≤ i ≤ n) as `{ index, count }`; nothing for an empty text (the whole check). */
export function parseShard(text) {
  if (!text) return null;
  const match = /^(\d+)\/(\d+)$/.exec(text);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || count < 1 || index < 1 || index > count)
    throw new Error(`a shard is i/n with 1 ≤ i ≤ n, not '${text}'`);
  return { index, count };
}

/**
 * The parts of shard `index` of `count`, in their given order. Every part is in exactly one shard: the parts,
 * longest first (then by name), each go to the shard with the least time so far (the lowest number on a tie),
 * so every shard computes the same split from the same list.
 */
export function shardOf(parts, { index, count }, weight = () => 1) {
  const longestFirst = [...new Set(parts)].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const load = new Array(count).fill(0);
  const owner = new Map();
  for (const part of longestFirst) {
    let lightest = 0;
    for (let shard = 1; shard < count; shard++) if (load[shard] < load[lightest]) lightest = shard;
    load[lightest] += weight(part);
    owner.set(part, lightest + 1);
  }
  return parts.filter((part) => owner.get(part) === index);
}

/**
 * The measured seconds of a check's parts (shard-weights.json, from a run on a runner: #237). A part not
 * measured yet (a new piece type) weighs the median of the others.
 */
export function weights(
  check,
  file = fileURLToPath(new URL('shard-weights.json', import.meta.url)),
) {
  const table = JSON.parse(readFileSync(file, 'utf8'))[check] ?? {};
  const known = Object.values(table).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  return (part) => table[part] ?? median;
}

/**
 * The parts this run takes: all of them without a shard, else its own (SMOKE_SHARD=i/n), and prints
 * `shard  <check> i/n: k of N parts: …` so a summary shows what each shard ran.
 */
export function selectParts(check, parts, shard = process.env.SMOKE_SHARD) {
  const which = parseShard(shard);
  if (!which) return new Set(parts);
  const mine = shardOf(parts, which, weights(check));
  console.log(
    `shard  ${check} ${which.index}/${which.count}: ${mine.length} of ${parts.length} parts: ${mine.join(', ')}`,
  );
  return new Set(mine);
}

/** With CHECK_NAMES set, a check's result and name go to that file too (one per line): the shards' proof. */
export function recordCheck(name, ok) {
  if (process.env.CHECK_NAMES)
    appendFileSync(process.env.CHECK_NAMES, `${ok ? 'ok' : 'FAIL'}\t${name}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'shard') {
  const [, , , check, shard, ...parts] = process.argv;
  try {
    for (const part of shardOf(parts, parseShard(shard), weights(check))) console.log(part);
  } catch (error) {
    console.error(`parts.mjs: ${error.message}`);
    process.exit(1);
  }
}
