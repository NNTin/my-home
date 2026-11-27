// The web build's Sakuga step (sakuga-plugin.ts, docs/design/hud.md §9.4): `sakuga-hud` holds every HUD element
// without its copy of the core, each ending in `component(window.SakugaFX)`, and index.html loads the progress bar
// (with the core) before `sakuga-hud`, and `sakuga-hud` before the module entry.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_END,
  HUD_ELEMENTS,
  hudSource,
  packageRoot,
  stripCore,
  withSakugaScripts,
} from './sakuga-plugin';

const root = packageRoot();
const element = (name: string) => readFileSync(path.join(root, name, `${name}.js`), 'utf8');
/** jsdom has no types in this workspace: what this test uses of it. */
interface Page extends Window {
  eval(code: string): unknown;
  close(): void;
}
const jsdom = 'jsdom';
const { JSDOM } = (await import(/* @vite-ignore */ jsdom)) as {
  JSDOM: new (html: string, options: object) => { window: Page };
};

/** A line only the core has. */
const CORE_LINE = 'if (window.SakugaFX) return;';

describe('sakuga-hud', () => {
  it('holds every HUD element, each without the core and ending in component(window.SakugaFX)', () => {
    const hud = hudSource();
    for (const name of HUD_ELEMENTS) {
      expect(element(name)).toContain(CORE_LINE);
      const stripped = stripCore(element(name), name);
      expect(stripped).not.toContain(CORE_LINE);
      expect(stripped).not.toContain('sakuga core');
      expect(stripped.trimEnd().endsWith(COMPONENT_END)).toBe(true);
      expect(hud).toContain(stripped);
      expect(hud).toContain(`fx.define('sakuga-${name}'`);
    }
    expect(hud).not.toContain(CORE_LINE);
    expect(hud).not.toContain('class Spring');
    expect(hud).toContain('fx.icon = ');
    // It is a fraction of the files it comes from: the core is about 40 kB of each.
    const whole = HUD_ELEMENTS.reduce((sum, name) => sum + element(name).length, 0);
    expect(hud.length).toBeLessThan(whole / 3);
  });

  it('refuses a file without the core markers', () => {
    expect(() => stripCore('(() => { component(window.SakugaFX); })();', 'x.js')).toThrow(
      /no sakuga core markers/,
    );
  });

  it('runs on the progress bar’s core: every element is defined, the icons are there, no canvas takes a pointer', () => {
    // A window of its own, without the app's fallback elements (test-setup.ts). Classic scripts, as the
    // browser runs them: the progress bar first, then sakuga-hud.
    const { window: page } = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    page.matchMedia = (query: string) =>
      ({ matches: false, media: query, addEventListener() {} }) as unknown as MediaQueryList;
    page.eval(readFileSync(path.join(root, 'progress/progress.js'), 'utf8'));
    page.eval(hudSource());
    const fx = (page as unknown as { SakugaFX: { Base: unknown; icon(name: string): string } })
      .SakugaFX;
    for (const name of HUD_ELEMENTS) {
      const defined = page.customElements.get(`sakuga-${name}`);
      expect(defined, name).toBeDefined();
      expect(Object.getPrototypeOf(defined), name).toBe(fx.Base);
    }
    expect(fx.icon('walk')).toMatch(/^<svg class="sk-icon"/);
    expect(fx.icon('nothing')).toBe('');

    // The effects never take a pointer or touch from the view (§8.2): the canvas over the page, and the back
    // layer inside every element.
    const pageStyle = page.document.head.textContent ?? '';
    expect(pageStyle).toMatch(/canvas\.sakuga-fx\{[^}]*pointer-events:none/);
    const button = page.document.createElement('sakuga-button');
    button.setAttribute('variant', 'secondary');
    page.document.body.append(button);
    expect(button.shadowRoot?.querySelector('style')?.textContent).toMatch(
      /canvas\.back\{[^}]*pointer-events:none/,
    );
    page.close();
  });
});

describe('index.html', () => {
  it('loads the progress bar, then sakuga-hud (deferred), then the module entry', () => {
    const html = withSakugaScripts(
      readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8'),
      '/assets/sakuga-progress-1.js',
      '/assets/sakuga-hud-2.js',
    );
    const progress = html.indexOf('<script src="/assets/sakuga-progress-1.js"></script>');
    const hud = html.indexOf('<script defer src="/assets/sakuga-hud-2.js"></script>');
    const title = html.indexOf('<title>');
    const entry = html.indexOf('<script type="module"');
    expect(progress).toBeGreaterThan(html.indexOf('name="viewport"'));
    expect(hud).toBeGreaterThan(progress);
    expect(title).toBeGreaterThan(hud);
    expect(entry).toBeGreaterThan(title);
  });
});
