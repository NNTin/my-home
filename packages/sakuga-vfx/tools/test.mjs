// node tools/test.mjs [URL]   drives every control in the gallery with real touch and key events at phone width. Exits 1 on a failure.
// Needs Node 22 or later and Chrome or Chromium (set CHROME if it is somewhere unusual), and the folder served over http.
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const URL_ = process.argv[2] || 'http://localhost:8000/gallery/';
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const PORT = 9800 + Math.floor(Math.random() * 150), PROFILE = mkdtempSync(join(tmpdir(), 'skv-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (Array.isArray(targets) && targets.some((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(), logs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
await send('Page.enable'); await send('Page.navigate', { url: URL_ }); await sleep(1800);

// "tag >>> selector" reaches into the element's shadow root
const find = (s) => { const [host, inner] = s.split(' >>> '); return inner ? `document.querySelector(${JSON.stringify(host)}).shadowRoot.querySelector(${JSON.stringify(inner)})` : `document.querySelector(${JSON.stringify(host)})`; };
const at = async (s, fx = 0.5, fy = 0.5) => JSON.parse(await ev(`(() => { const e = ${find(s)}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return JSON.stringify([b.left + b.width * ${fx}, b.top + b.height * ${fy}]); })()`));
const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const tap = async (s, fx, fy) => { const [x, y] = await at(s, fx, fy); await sleep(150); await touch('touchStart', x, y); await touch('touchEnd', x, y); };
const key = async (k, code) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); };
const type = async (text) => { for (const ch of text) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(40); } };
let fails = 0;
const check = (name, ok, got) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? `  ->  ${got}` : ''}`); };

check('all eleven elements are defined', (await ev(`['button','toggle','slider','checkbox','radio','input','tabs','progress','rating','toast','tooltip'].every((n) => customElements.get('sakuga-' + n))`)));
check('one shared core', (await ev('window.SakugaFX.version')) === 1);
check('the nine made here are defined', await ev(`['icon-button','badge','segmented','field','panel','fold','card','sheet','compass'].every((n) => customElements.get('sakuga-' + n))`));
{ await tap('sakuga-button[data-demo=primary] >>> .btn'); await sleep(1200); check('button: tap fires click and done() lands the check', +(await ev(`${find('sakuga-button[data-demo=primary] >>> .btn')}.style.getPropertyValue('--ok')`)) > 0.5); }
{ await tap('sakuga-toggle >>> .tog'); await sleep(500); check('toggle: tap turns it on', await ev(`document.querySelector('sakuga-toggle').checked`));
  check('toggle: aria-checked follows', (await ev(`${find('sakuga-toggle >>> .tog')}.getAttribute('aria-checked')`)) === 'true'); }
{ const [x, y] = await at('sakuga-slider >>> .sld', 0.2); const [x1] = await at('sakuga-slider >>> .sld', 0.9); await sleep(200); await touch('touchStart', x, y);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', x + (x1 - x) * i / 10, y); await sleep(25); } await touch('touchEnd', x1, y); await sleep(400);
  const v = +(await ev(`document.querySelector('sakuga-slider').value`)); check('slider: a drag moves it', v > 70, v);
  await ev(`${find('sakuga-slider >>> input')}.focus()`); await key('ArrowLeft', 37); await sleep(200); check('slider: arrow key steps it', +(await ev(`document.querySelector('sakuga-slider').value`)) === v - 1); }
{ await tap('sakuga-checkbox >>> .box'); await sleep(400); check('checkbox: tap ticks it', await ev(`document.querySelector('sakuga-checkbox').checked`)); }
{ await tap('sakuga-radio >>> label:nth-child(2) .dot'); await sleep(400); check('radio: tap selects B', (await ev(`document.querySelector('sakuga-radio').value`)) === 'b'); }
{ await tap('sakuga-input >>> input'); await sleep(200); await type('hey'); await sleep(300); check('input: typing sets the value', (await ev(`document.querySelector('sakuga-input').value`)) === 'hey'); }
{ await tap('sakuga-tabs >>> button:nth-of-type(3)'); await sleep(500); check('tabs: tap selects the third', (await ev(`document.querySelector('sakuga-tabs').selected`)) === 2);
  await ev(`${find('sakuga-tabs >>> button:nth-of-type(3)')}.focus()`); await key('ArrowLeft', 37); await sleep(300); check('tabs: arrow key moves back', (await ev(`document.querySelector('sakuga-tabs').selected`)) === 1); }
{ await tap('sakuga-rating >>> button:nth-child(4)'); await sleep(700); check('rating: tap sets four', (await ev(`document.querySelector('sakuga-rating').value`)) === 4);
  check('rating: four stars lit', (await ev(`${find('sakuga-rating >>> .stars')}.querySelectorAll('.lit').length`)) === 4); }
{ await at('sakuga-progress'); let done = false; for (let i = 0; i < 24 && !done; i++) { await sleep(500); done = await ev(`document.querySelector('sakuga-progress').done`); }
  check('progress: the demo load completes', done, await ev(`${find('sakuga-progress >>> .pct')}.textContent`)); }
{ await ev(`(() => { const p = document.querySelector('sakuga-progress'); p.removeAttribute('demo'); p.reset(); p.set(0.5); })()`); await sleep(1500);
  check('progress: set(0.5) eases to half', Math.abs((await ev(`+getComputedStyle(${find('sakuga-progress >>> .prog')}).getPropertyValue('--v')`)) - 0.5) < 0.02); }
{ await tap('[data-demo=save] >>> .btn'); await sleep(900); check('toast: it arrives', await ev(`document.querySelector('sakuga-toast').open`)); await sleep(3400); check('toast: it leaves', !(await ev(`document.querySelector('sakuga-toast').open`))); }
{ await tap('sakuga-tooltip >>> .help'); await sleep(600); check('tooltip: tap opens it', await ev(`document.querySelector('sakuga-tooltip').open`)); await key('Escape', 27); await sleep(300); check('tooltip: Escape closes it', !(await ev(`document.querySelector('sakuga-tooltip').open`))); }
{ await ev(`(() => { const f = document.createElement('form'); f.id = 'tf'; f.innerHTML = '<sakuga-checkbox name="c" checked></sakuga-checkbox><sakuga-slider name="s" value="42"></sakuga-slider><sakuga-rating name="r" value="3"></sakuga-rating><sakuga-toggle name="t" checked></sakuga-toggle>'; document.body.append(f); })()`); await sleep(300);
  check('forms: values are sent with a form', (await ev(`new URLSearchParams(new FormData(document.getElementById('tf'))).toString()`)) === 'c=on&s=42&r=3&t=on', await ev(`new URLSearchParams(new FormData(document.getElementById('tf'))).toString()`)); }
// Made here (my-home, #168): the compact button's toggle and hit area, the icon button, the badge.
{ await tap('sakuga-button[data-demo=toggle] >>> .btn'); await sleep(400); check('compact button: tap presses the toggle', (await ev(`${find('sakuga-button[data-demo=toggle] >>> .btn')}.getAttribute('aria-pressed')`)) === 'true'); }
{ const said = `document.querySelector('sakuga-icon-button').closest('section').querySelector('.said').textContent`;
  await tap('sakuga-icon-button >>> .b'); await sleep(400); check('icon button: tap fires click', (await ev(said)) === 'Clicked: Rotate left');
  // A finger rests about 60 ms: the press squash has begun, and the hit area must not shrink with it (C6).
  const [x, y] = await at('sakuga-icon-button[label=Raise] >>> .b', 0.5, 0); await sleep(150); await touch('touchStart', x, y - 4); await sleep(60); await touch('touchEnd', x, y - 4); await sleep(400);
  check('icon button: compact, a touch 4 px above its face still hits it (44 px)', (await ev(said)) === 'Clicked: Raise', await ev(said));
  await ev(`${find('sakuga-icon-button[label=Delete] >>> .b')}.focus()`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300); check('icon button: Enter fires click', (await ev(said)) === 'Clicked: Delete'); }
{ const b = `document.querySelector('sakuga-badge')`;
  check('badge: not there before it is shown', (await ev(`${b}.getAttribute('aria-hidden')`)) === 'true');
  await tap('[data-demo=badge-save] >>> .btn'); await sleep(600);
  check('badge: it arrives as a status with its text', (await ev(`${b}.getAttribute('role')`)) === 'status' && (await ev(`${b}.textContent`)) === 'Saved' && !(await ev(`${b}.hasAttribute('aria-hidden')`)));
  await sleep(2700); check('badge: it leaves by itself after its duration', (await ev(`${b}.getAttribute('aria-hidden')`)) === 'true');
  await tap('[data-demo=badge-warn] >>> .btn'); await sleep(600); check('badge: a warning is an alert', (await ev(`${b}.getAttribute('role')`)) === 'alert'); }
{ const s = `document.querySelector('sakuga-segmented')`;
  await tap('sakuga-segmented >>> button:nth-of-type(3)'); await sleep(600); check('segmented: tap picks the third', (await ev(`${s}.value`)) === 'beautiful');
  check('segmented: aria-checked follows', (await ev(`${find('sakuga-segmented >>> button:nth-of-type(3)')}.getAttribute('aria-checked')`)) === 'true');
  await ev(`${find('sakuga-segmented >>> button:nth-of-type(3)')}.focus()`); await key('ArrowRight', 39); await sleep(400); check('segmented: the arrow key wraps to the first', (await ev(`${s}.value`)) === 'fast');
  await key('End', 35); await sleep(400); check('segmented: End goes to the last', (await ev(`${s}.value`)) === 'beautiful');
  await ev(`${s}.value = 'auto'`); await sleep(200); check('segmented: a value from code moves it', (await ev(`${find('sakuga-segmented >>> button:nth-of-type(2)')}.getAttribute('aria-checked')`)) === 'true'); }
// Made here (my-home, HUD v2 #200): the containers.
{ const p = `document.querySelector('sakuga-panel')`;
  check('panel: a region named by its label', (await ev(`${p}.getAttribute('role')`)) === 'region' && (await ev(`${p}.getAttribute('aria-label')`)) === 'View controls');
  await tap('[data-demo=panel-hide] >>> .btn'); await sleep(800); check('panel: hidden, it shrinks away and takes no room', await ev(`${p}.classList.contains('gone') && ${p}.getBoundingClientRect().height === 0`));
  await tap('[data-demo=panel-show] >>> .btn'); await sleep(800); check('panel: shown, it lands and rests untransformed', await ev(`!${p}.classList.contains('gone') && ${p}.style.transform === ''`)); }
{ const f = `document.querySelector('sakuga-fold')`, body = find('sakuga-fold >>> .body');
  check('fold: closed, its body is hidden', await ev(`${body}.hidden && ${find('sakuga-fold >>> .sum')}.getAttribute('aria-expanded') === 'false'`));
  await tap('sakuga-fold >>> .sum'); await sleep(900); check('fold: tap opens it, the body at its full height', await ev(`${f}.open && !${body}.hidden && ${body}.style.height === '' && ${body}.getBoundingClientRect().height > 30`));
  await tap('sakuga-fold >>> .sum'); await sleep(900); check('fold: tap again closes it', await ev(`!${f}.open && ${body}.hidden`));
  await ev(`${f}.open = true`); await sleep(100); check('fold: open from code jumps', await ev(`!${body}.hidden && ${body}.style.height === ''`)); await ev(`${f}.open = false`); }
{ const a = find('sakuga-card[data-demo=card-a] >>> .c');
  check('card: a button named by its label, described', (await ev(`${a}.tagName`)) === 'BUTTON' && (await ev(`${a}.getAttribute('aria-label')`)) === 'Armchair' && (await ev(`${a}.getAttribute('aria-describedby')`)) === 'd');
  await tap('sakuga-card[data-demo=card-a] >>> .c'); await sleep(500); check('card: tap selects it', (await ev(`${a}.getAttribute('aria-pressed')`)) === 'true');
  check('card: with href, a link', (await ev(`${find('sakuga-card[data-demo=card-b] >>> .c')}.getAttribute('href')`)) === '#bed'); }
// Made here (my-home, HUD v2 #202): the compass.
{ const cp = `document.querySelector('sakuga-compass')`, disc = find('sakuga-compass >>> .c');
  check('compass: a button named by its label', (await ev(`${disc}.getAttribute('aria-label')`)) === 'Compass: turn the view north-up');
  await tap('sakuga-compass >>> .c'); await sleep(120); const mid = await ev(`${cp}.style.getPropertyValue('--wob')`);
  await sleep(1600); check('compass: pressed, the needle swings in to north and rests', mid !== '' && (await ev(`${cp}.style.getPropertyValue('--wob')`)) === '' && (await ev(`${cp}.style.getPropertyValue('--rose')`)) === '0deg', mid); }
{ const sh = `document.querySelector('sakuga-sheet')`;
  await tap('[data-demo=sheet-full] >>> .btn'); await sleep(250); const mid = await ev(`${sh}.style.height`);
  await sleep(1200); check('sheet: a new snap springs, then rests at the page\'s size', mid !== '' && (await ev(`${sh}.style.height`)) === '' && (await ev(`Math.round(${sh}.getBoundingClientRect().height)`)) === 240, mid);
  await tap('[data-demo=sheet-collapsed] >>> .btn'); await sleep(1400); check('sheet: back to collapsed', (await ev(`Math.round(${sh}.getBoundingClientRect().height)`)) === 44); }
{ const sel = `document.querySelector('sakuga-field select')`;
  check('field: the native select is in the page, slotted', await ev(`!!${sel} && ${sel}.assignedSlot !== null`));
  await ev(`(() => { const s = ${sel}; s.selectedIndex = 2; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
  check('field: a change reaches the page', (await ev(`document.querySelector('sakuga-field').closest('section').querySelector('.said').textContent`)) === 'change: Studio, dark'); }
// The clear appearance (my-home HUD v2, #199): the same control, hit area, keys and focus as the boxed one.
{ const said = `document.querySelector('[data-demo=clear]').closest('section').querySelector('.said').textContent`;
  await tap('[data-demo=clear] >>> .b'); await sleep(400); check('clear icon button: tap fires click', (await ev(said)) === 'Clicked: Views');
  const [x, y] = await at('[data-demo=clear-btn] >>> .btn', 0.5, 0); await sleep(150); await touch('touchStart', x, y - 4); await sleep(60); await touch('touchEnd', x, y - 4); await sleep(500);
  check('clear compact button: a touch 4 px above its face still hits it (44 px)', (await ev(said)) === 'Clicked: Walk', await ev(said));
  await tap('[data-demo=clear-toggle] >>> .b'); await sleep(400); check('clear icon button: pressed toggles aria-pressed', (await ev(`${find('[data-demo=clear-toggle] >>> .b')}.getAttribute('aria-pressed')`)) === 'true');
  await ev(`${find('[data-demo=clear] >>> .b')}.focus()`); await key('Tab', 9); await sleep(200); await key('Tab', 9); await key('Tab', 9); await sleep(100);
  await ev(`${find('[data-demo=clear] >>> .b')}.focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
  check('clear icon button: Enter fires click', (await ev(said)) === 'Clicked: Views');
  check('clear icon button: keyboard focus shows the pink ring', (await ev(`(() => { const b = ${find('[data-demo=clear] >>> .b')}; return b.matches(':focus-visible') && getComputedStyle(b).outlineStyle === 'solid'; })()`)) === true);
  await ev(`window.__saidBefore = ${said}`); await tap('[data-demo=clear-off] >>> .btn'); await sleep(300); check('clear button: disabled takes no click', (await ev(said)) === (await ev('window.__saidBefore'))); }
check('no horizontal scroll at 390', (await ev('document.documentElement.scrollWidth')) <= 390, await ev('document.documentElement.scrollWidth'));
if (logs.length) { console.log(logs.join('\n')); fails++; }
ws.close(); chrome.kill(); await sleep(300); try { rmSync(PROFILE, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0);
