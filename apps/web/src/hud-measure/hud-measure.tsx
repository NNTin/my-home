import { LiveResponse } from '@my-home/shared';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import type { FrameGovernor } from '../quality/governor';
import { shortUserAgent } from '../quality/perfReport';
import { sakuga, type SakugaApi } from '../hud/sakuga';
import { hudReport, type HudContext, type Rest, type Run, type RunKind } from './report';
import './hud-measure.css';

/**
 * The HUD's measuring page, `/?hud=measure` (docs/design/hud.md §10.2), a lazy chunk. Opened on the owner's phone,
 * it runs by itself: the orbit runs on the viewer, then the page opens itself again walking (`&walk=first`) for
 * the walk runs, and ends with the numbers as a table to copy and the six words at compact size to save. Nothing
 * here is measured on the agents' machine: the numbers are the device's.
 */

const RUN_MS = 5000;
const REST_MS = 2000;
/** Effects over the view while a run fires them. */
const FIRE_MS = 250;
/** The compact size (§3.3): effects at 0.7. */
const COMPACT = 0.7;
const WORDS = ['don', 'kachi', 'shu', 'pon', 'zuza', 'gogo'] as const;
const KEPT = 'my-home:hud-measure';
/** The camera's turn while orbiting, radians a second. */
const ORBIT_SPEED = 1;

/** Between the rig in the canvas and the page: one measurement at a time. */
const bridge = {
  ready: false,
  orbiting: false,
  recording: false,
  frames: [] as number[],
  invalidate: () => {},
  governor: undefined as FrameGovernor | undefined,
};

const up = new Vector3(0, 1, 0);

/** In the canvas: turns the camera while orbiting, and notes when each frame of the view is drawn. */
export function MeasureRig({ governor }: { governor: FrameGovernor }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    bridge.ready = true;
    bridge.invalidate = () => invalidate();
    bridge.governor = governor;
    return () => {
      bridge.ready = false;
    };
  }, [invalidate, governor]);
  useFrame(({ camera, controls }, delta) => {
    if (bridge.recording) bridge.frames.push(performance.now());
    if (!bridge.orbiting) return;
    const target = (controls as { target?: Vector3; update?(): void } | null)?.target;
    if (target) {
      const offset = camera.position
        .clone()
        .sub(target)
        .applyAxisAngle(up, ORBIT_SPEED * delta);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      (controls as { update?(): void }).update?.();
    }
    invalidate();
  });
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const stats = () => sakuga()?.stats ?? { frames: 0, ms: 0, awake: 0, running: false };

/** Waits until `test` holds, or at most `most` ms; says whether it held. */
async function until(test: () => boolean, most = Infinity) {
  const end = performance.now() + most;
  while (!test() && performance.now() < end) await sleep(200);
  return test();
}

/** The effects have ended and the Sakuga clock has stopped (a slow device takes far longer than a phone). */
const settled = () => until(() => !stats().running, 30_000);

async function rest(when: string, unsettled = false): Promise<Rest> {
  const before = stats();
  await sleep(REST_MS);
  const after = stats();
  return {
    when,
    frames: after.frames - before.frames,
    seconds: REST_MS / 1000,
    running: after.running,
    ...(unsettled && { unsettled }),
  };
}

const key = (type: 'keydown' | 'keyup', name: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));

/** A burst, a puff and a word, at compact size, somewhere over the middle of the view. */
function fire(fx: SakugaApi, n: number) {
  const x = scrollX + innerWidth * (0.3 + 0.4 * ((n * 0.37) % 1));
  const y = scrollY + innerHeight * (0.35 + 0.3 * ((n * 0.61) % 1));
  fx.burst(x, y, { r: 98 * COMPACT, spikes: 15, life: 0.48 });
  fx.puff(x + 40 * COMPACT, y + 20 * COMPACT, { size: 14 * COMPACT, n: 5, vx: 30, vy: -20 });
  fx.sfx(WORDS[n % WORDS.length]!, x, y - 70 * COMPACT, { size: 176 * COMPACT, rot: -0.12 });
}

async function run(kind: RunKind, effects: boolean): Promise<Run> {
  const fx = sakuga();
  bridge.frames = [];
  bridge.recording = true;
  const before = stats();
  let fired = 0;
  const timer =
    effects && fx
      ? window.setInterval(() => {
          if (!fx.calm) fire(fx, fired++);
        }, FIRE_MS)
      : undefined;
  if (kind === 'orbit') {
    bridge.governor?.setMoving('measure', true);
    bridge.orbiting = true;
    bridge.invalidate();
  } else {
    key('keydown', 'w');
    key('keydown', 'q');
  }
  await sleep(RUN_MS);
  window.clearInterval(timer);
  bridge.orbiting = false;
  bridge.governor?.setMoving('measure', false);
  key('keyup', 'w');
  key('keyup', 'q');
  bridge.recording = false;
  const after = stats();
  return {
    kind,
    effects,
    frameTimes: bridge.frames,
    sakugaFrames: after.frames - before.frames,
    sakugaMs: after.ms - before.ms,
    fired,
  };
}

/** The six words at compact size, each drawn on the paused Sakuga clock and copied off its canvas. */
async function words(): Promise<{ name: string; url: string }[]> {
  const fx = sakuga();
  const front = document.querySelector<HTMLCanvasElement>('canvas.sakuga-fx');
  if (!fx || fx.calm || !front) return [];
  const images: { name: string; url: string }[] = [];
  const size = 176 * COMPACT;
  const box = Math.round(size * 1.5);
  const [x, y] = [box, box];
  fx.paused = true;
  try {
    for (const name of WORDS) {
      fx.sfx(name, scrollX + x, scrollY + y, { size, rot: -0.12 });
      fx.advance(0.3);
      const dpr = front.width / innerWidth;
      const out = document.createElement('canvas');
      out.width = out.height = Math.round(box * dpr);
      const g = out.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, out.width, out.height);
      const from = (x - box / 2) * dpr;
      g.drawImage(
        front,
        from,
        (y - box / 2) * dpr,
        out.width,
        out.height,
        0,
        0,
        out.width,
        out.height,
      );
      images.push({ name, url: out.toDataURL('image/png') });
      fx.advance(2);
    }
  } finally {
    fx.paused = false;
  }
  return images;
}

async function commit(): Promise<string | undefined> {
  try {
    const live = LiveResponse.safeParse(await (await fetch('/api/health/live')).json());
    return live.success ? (live.data.commit ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

interface Kept {
  runs: Run[];
  rests: Rest[];
}

/** Over the viewer: what is being measured, then the table and the words. */
export function MeasurePage({ walking }: { walking: boolean }) {
  const [status, setStatus] = useState('Waiting for the view…');
  const [report, setReport] = useState<string>();
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const say = (text: string) => live && setStatus(text);
    void (async () => {
      await until(() => bridge.ready && !document.getElementById('boot'));
      await sleep(2000);
      if (!live) return;
      const kept: Kept = walking
        ? ((JSON.parse(sessionStorage.getItem(KEPT) ?? 'null') as Kept | null) ?? {
            runs: [],
            rests: [],
          })
        : { runs: [], rests: [] };
      const phase = walking ? 'walk' : 'orbit';
      say('At rest: is the Sakuga clock asleep?');
      kept.rests.push(await rest(walking ? 'Walking, before the runs' : 'Before the runs'));
      for (const effects of [false, true]) {
        say(
          `${phase === 'orbit' ? 'Orbiting' : 'Walking'} for 5 s, ${effects ? 'with effects over the view' : 'without effects'}…`,
        );
        kept.runs.push(await run(phase, effects));
      }
      say('Letting the effects end…');
      await sleep(500);
      const ended = await settled();
      kept.rests.push(
        await rest(
          walking ? 'After the walk with effects' : 'After the orbit with effects',
          !ended,
        ),
      );
      if (!live) return;
      if (!walking) {
        sessionStorage.setItem(KEPT, JSON.stringify(kept));
        say('Now walking: the page opens again…');
        const next = new URL(window.location.href);
        next.searchParams.set('walk', 'first');
        window.location.replace(next);
        return;
      }
      sessionStorage.removeItem(KEPT);
      say('Drawing the words…');
      await settled();
      const drawn = await words();
      const fx = sakuga();
      const context: HudContext = {
        commit: await commit(),
        time: new Date(),
        device: shortUserAgent(navigator.userAgent),
        viewport: { width: innerWidth, height: innerHeight },
        devicePixelRatio: devicePixelRatio,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
        calm: fx?.calm ?? true,
        core: fx !== undefined,
        hud: !!fx && customElements.get('sakuga-button')?.prototype instanceof fx.Base,
      };
      if (!live) return;
      setImages(drawn);
      setReport(hudReport(context, kept.runs, kept.rests));
      setStatus('Done.');
    })();
    return () => {
      live = false;
    };
  }, [walking]);

  const copy = () => {
    if (!report) return;
    void navigator.clipboard?.writeText(report).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section
      className="hud-measure"
      aria-label="HUD measurement"
      data-measure={report ? 'done' : 'running'}
    >
      <h1>HUD: measurement</h1>
      {!report && (
        <p>
          Leave the page in front and do not touch it: it orbits, then opens again and walks (about
          40 s).
        </p>
      )}
      <p role="status">{status}</p>
      {report && (
        <>
          <p>
            <button type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy the table'}
            </button>{' '}
            and paste it into the issue, with the six images.
          </p>
          <textarea
            readOnly
            rows={14}
            value={report}
            aria-label="The measurement as a table"
            onFocus={(event) => event.currentTarget.select()}
          />
          {images.length > 0 && (
            <ul aria-label="The words at compact size">
              {images.map((image) => (
                <li key={image.name}>
                  <a href={image.url} download={`my-home-word-${image.name}.png`}>
                    <img src={image.url} alt={`The word ${image.name} at compact size`} />
                    Save {image.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p>
            <a href="/">Back to the viewer</a>
          </p>
        </>
      )}
    </section>
  );
}
