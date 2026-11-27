/**
 * The HUD without Sakuga (docs/design/hud.md §7.5): each `sakuga-*` tag the app uses as a plain element without a
 * shadow root, its role and state as attributes on the host, Space and Enter handled, and the same events as the
 * real one. Its accessible name comes from its children or `label`, so Testing Library's
 * `getByRole('button', { name: 'Walk' })` finds it.
 *
 * Used twice: jsdom has no Sakuga (`test-setup.ts`), and a browser where `sakuga-hud` did not load or failed
 * (`main.tsx` runs after the deferred script either way): the HUD then works plain, without reactions. Only tags
 * still undefined are defined. `<sakuga-progress>` is not here: its wrapper has its own fallback.
 */

const on = (el: Element, name: string, value: boolean) => el.toggleAttribute(name, value);
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));
const isKey = (event: KeyboardEvent, ...keys: string[]) => keys.includes(event.key);

/** A host that is its own control: focusable, Space and Enter act on it. */
class Plain extends HTMLElement {
  static observedAttributes = ['disabled', 'label'];
  role_ = '';
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    on(this, 'disabled', v);
  }
  connectedCallback() {
    if (this.role_) this.setAttribute('role', this.role_);
    // The stand-in has no shadow root: the app's CSS draws it (styles.css, "Fallbacks").
    this.dataset.fallback = '';
    this.sync();
  }
  attributeChangedCallback() {
    this.sync();
  }
  sync() {
    if (!this.role_) return;
    this.tabIndex = this.disabled ? -1 : 0;
    this.setAttribute('aria-disabled', String(this.disabled));
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
  }
}

class FallbackButton extends Plain {
  static override observedAttributes = ['disabled', 'label', 'pressed', 'href'];
  override role_ = 'button';
  get pressed() {
    const p = this.getAttribute('pressed');
    return p !== null && p !== 'false';
  }
  set pressed(v: boolean | null | undefined) {
    if (v == null) this.removeAttribute('pressed');
    else this.setAttribute('pressed', v ? 'true' : 'false');
  }
  constructor() {
    super();
    this.addEventListener('keydown', (e) => {
      // A link acts on Enter only, as a real one does.
      if (!isKey(e, ...(this.hasAttribute('href') ? ['Enter'] : [' ', 'Enter']))) return;
      e.preventDefault();
      this.click();
    });
    this.addEventListener('click', (e) => {
      if (this.disabled) return e.stopImmediatePropagation();
      if (this.getAttribute('type') === 'submit') this.closest('form')?.requestSubmit();
      const href = this.getAttribute('href');
      // A link goes where it points, unless a listener took the click (the app's router: hud/SkLink).
      if (href !== null) queueMicrotask(() => e.defaultPrevented || location.assign(href));
    });
  }
  override sync() {
    this.role_ = this.hasAttribute('href') ? 'link' : 'button';
    this.setAttribute('role', this.role_);
    super.sync();
    // As the element: pressed="false" is a toggle that is off; no attribute, not a toggle.
    const pressed = this.getAttribute('pressed');
    if (pressed !== null) this.setAttribute('aria-pressed', String(pressed !== 'false'));
    else this.removeAttribute('aria-pressed');
  }
  done() {}
  impact() {}
}

/** An icon button: a button named by its `label` (the icon is decoration). */
class FallbackIconButton extends FallbackButton {
  static override observedAttributes = ['disabled', 'label', 'pressed', 'href', 'icon'];
}

/** A badge: a status (an alert when it warns), shown or not; a count is named by its `label` or hidden. */
class FallbackBadge extends HTMLElement {
  static observedAttributes = ['shown', 'kind', 'count', 'label'];
  private own = false;
  get shown() {
    return this.hasAttribute('shown');
  }
  set shown(v: boolean) {
    on(this, 'shown', v);
  }
  connectedCallback() {
    this.own = this.hasAttribute('role') && !this.hasAttribute('data-fallback-role');
    this.sync();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.sync();
  }
  private sync() {
    const count = this.getAttribute('count');
    const label = this.getAttribute('label');
    this.style.display = this.shown ? '' : 'none';
    if (count !== null) {
      if (!this.own) this.setAttribute('role', label ? 'img' : 'none');
      if (label) this.setAttribute('aria-label', label);
      if (label) this.removeAttribute('aria-hidden');
      else this.setAttribute('aria-hidden', 'true');
      this.dataset.count = count;
    } else if (!this.own)
      this.setAttribute('role', this.getAttribute('kind') === 'warn' ? 'alert' : 'status');
    if (!this.own) this.setAttribute('data-fallback-role', '');
  }
}

/** The painted toggle: a switch, flipped by a click, Space or Enter. */
class FallbackToggle extends Plain {
  static override observedAttributes = ['disabled', 'label', 'checked'];
  override role_ = 'switch';
  get checked() {
    return this.hasAttribute('checked');
  }
  set checked(v: boolean) {
    on(this, 'checked', v);
  }
  constructor() {
    super();
    const flip = () => {
      if (this.disabled) return;
      this.checked = !this.checked;
      fire(this, 'change');
    };
    this.addEventListener('click', flip);
    this.addEventListener('keydown', (e) => {
      if (!isKey(e, ' ', 'Enter')) return;
      e.preventDefault();
      flip();
    });
  }
  override sync() {
    super.sync();
    this.setAttribute('aria-checked', String(this.checked));
  }
}

class FallbackCheckbox extends Plain {
  static override observedAttributes = ['disabled', 'label', 'checked'];
  override role_ = 'checkbox';
  get checked() {
    return this.hasAttribute('checked');
  }
  set checked(v: boolean) {
    on(this, 'checked', v);
  }
  constructor() {
    super();
    const flip = () => {
      if (this.disabled) return;
      this.checked = !this.checked;
      fire(this, 'change');
    };
    this.addEventListener('click', flip);
    this.addEventListener('keydown', (e) => {
      if (!isKey(e, ' ')) return;
      e.preventDefault();
      flip();
    });
  }
  override sync() {
    super.sync();
    this.setAttribute('aria-checked', String(this.checked));
  }
}

class FallbackSlider extends Plain {
  static override observedAttributes = ['disabled', 'label', 'value', 'min', 'max', 'step', 'unit'];
  override role_ = 'slider';
  private num(name: string, fallback: number) {
    const v = parseFloat(this.getAttribute(name) ?? '');
    return Number.isFinite(v) ? v : fallback;
  }
  get value() {
    return String(this.num('value', 50));
  }
  set value(v: string | number) {
    this.setAttribute('value', String(v));
  }
  get valueAsNumber() {
    return +this.value;
  }
  constructor() {
    super();
    this.addEventListener('keydown', (e) => {
      const step = this.num('step', 1);
      const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
      const edge = { Home: this.num('min', 0), End: this.num('max', 100) }[e.key];
      if ((delta === undefined && edge === undefined) || this.disabled) return;
      e.preventDefault();
      const next = edge ?? this.valueAsNumber + delta!;
      this.value = Math.min(this.num('max', 100), Math.max(this.num('min', 0), next));
      fire(this, 'input');
      fire(this, 'change');
    });
  }
  override sync() {
    super.sync();
    this.setAttribute('aria-valuenow', String(this.value));
    // The unit is read out too, as the element's (" m", "%").
    this.setAttribute('aria-valuetext', `${this.value}${this.getAttribute('unit') ?? '%'}`);
    this.setAttribute('aria-valuemin', String(this.num('min', 0)));
    this.setAttribute('aria-valuemax', String(this.num('max', 100)));
  }
}

/** A native input in the light DOM: React's wrapper hears its `input` and `change` bubble up. */
class FallbackInput extends Plain {
  static override observedAttributes = ['disabled', 'label', 'placeholder', 'type'];
  input = document.createElement('input');
  get value() {
    return this.input.value;
  }
  set value(v: string) {
    this.input.value = v;
  }
  override connectedCallback() {
    if (!this.input.isConnected) this.append(this.input);
    this.sync();
  }
  override sync() {
    const label = this.getAttribute('label');
    if (label) this.input.setAttribute('aria-label', label);
    this.input.type = this.getAttribute('type') ?? 'text';
    this.input.placeholder = this.getAttribute('placeholder') ?? '';
    this.input.disabled = this.disabled;
  }
}

/** Tabs from the `<option>` children, re-read when they change. */
class FallbackTabs extends Plain {
  static override observedAttributes = ['label', 'selected'];
  private bar = document.createElement('span');
  private index = 0;
  // The options changed (a home with other levels): read them again. Its own tab bar's changes are not theirs.
  private watch = new MutationObserver((list) => {
    if (list.some((m) => !this.bar.contains(m.target))) this.build();
  });
  get selected() {
    return this.index;
  }
  set selected(i: number) {
    this.index = i;
    this.build();
  }
  get value() {
    return this.options()[this.index]?.value ?? '';
  }
  private options() {
    return [...this.querySelectorAll('option')];
  }
  override connectedCallback() {
    this.setAttribute('role', 'tablist');
    if (!this.bar.isConnected) this.append(this.bar);
    this.index = +(this.getAttribute('selected') ?? this.index);
    this.watch.observe(this, { childList: true, subtree: true, characterData: true });
    this.build();
  }
  disconnectedCallback() {
    this.watch.disconnect();
  }
  override sync() {
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
  }
  private go(i: number) {
    const options = this.options();
    const option = options[i];
    if (!option) return;
    this.index = i;
    this.build();
    (this.bar.children[i] as HTMLElement).focus();
    this.dispatchEvent(
      new CustomEvent('change', {
        bubbles: true,
        detail: { index: i, value: option.value, label: option.textContent },
      }),
    );
  }
  private build() {
    this.sync();
    const options = this.options();
    for (const option of options) option.hidden = true;
    this.bar.replaceChildren(
      ...options.map((option, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(i === this.index));
        tab.tabIndex = i === this.index ? 0 : -1;
        tab.textContent = option.textContent;
        tab.addEventListener('click', () => i !== this.index && this.go(i));
        tab.addEventListener('keydown', (e) => {
          const n = options.length;
          const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[
            e.key
          ];
          if (to === undefined) return;
          e.preventDefault();
          this.go(to);
        });
        return tab;
      }),
    );
  }
}

/** One choice of a few: a radiogroup of radio buttons from the `<option>` children, re-read when they change. */
class FallbackSegmented extends HTMLElement {
  static observedAttributes = ['value', 'label'];
  private row = document.createElement('span');
  private current = '';
  private watch = new MutationObserver((list) => {
    if (list.some((m) => !this.row.contains(m.target) && m.target !== this)) this.build();
  });
  get value() {
    return this.current;
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }
  connectedCallback() {
    this.setAttribute('role', 'radiogroup');
    if (!this.row.isConnected) this.append(this.row);
    this.watch.observe(this, { childList: true, subtree: true, characterData: true });
    this.build();
  }
  disconnectedCallback() {
    this.watch.disconnect();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.build();
  }
  private options() {
    return [...this.querySelectorAll('option')];
  }
  private pick(i: number, focus: boolean) {
    const option = this.options()[i];
    if (!option || option.disabled) return;
    this.setAttribute('value', option.value);
    if (focus) (this.row.children[i] as HTMLElement | undefined)?.focus();
    this.dispatchEvent(
      new CustomEvent('change', { bubbles: true, detail: { index: i, value: option.value } }),
    );
  }
  private build() {
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
    const options = this.options();
    for (const option of options) option.hidden = true;
    const wanted = this.getAttribute('value');
    const at = Math.max(
      0,
      options.findIndex((o) => o.value === wanted),
    );
    this.current = options[at]?.value ?? '';
    const name = (o: HTMLOptionElement) => o.getAttribute('label') || (o.textContent ?? '');
    const buttons = [...this.row.children] as HTMLButtonElement[];
    // The same options: only the choice moves (a rebuild would drop the focus a key has moved).
    const same =
      buttons.length === options.length &&
      buttons.every(
        (b, i) =>
          b.dataset.value === options[i]!.value &&
          b.getAttribute('aria-label') === name(options[i]!),
      );
    if (!same)
      this.row.replaceChildren(
        ...options.map((option, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.value = option.value;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-label', name(option));
          b.disabled = option.disabled;
          b.textContent = option.textContent;
          b.addEventListener('click', () => this.current !== option.value && this.pick(i, false));
          b.addEventListener('keydown', (e) => {
            const n = options.length;
            const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            const to =
              d !== undefined
                ? (i + d + n) % n
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? n - 1
                    : -1;
            if (to < 0) return;
            e.preventDefault();
            this.pick(to, true);
          });
          return b;
        }),
      );
    [...this.row.children].forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === at));
      (b as HTMLElement).tabIndex = i === at ? 0 : -1;
    });
  }
}

class FallbackToast extends Plain {
  private status = Object.assign(document.createElement('span'), { hidden: true });
  private timer: ReturnType<typeof setTimeout> | undefined;
  get open() {
    return this.status.textContent !== '';
  }
  static override observedAttributes = ['kind'];
  override connectedCallback() {
    this.sync();
    if (!this.status.isConnected) this.append(this.status);
  }
  /** A warning's message is an alert, as the element's. */
  override sync() {
    this.status.setAttribute('role', this.getAttribute('kind') === 'warn' ? 'alert' : 'status');
  }
  show(text?: string) {
    this.status.textContent = text ?? this.getAttribute('message') ?? '';
    // Hidden while it says nothing, as the element's toast is.
    this.status.hidden = !this.status.textContent;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.hide(),
      (+(this.getAttribute('duration') ?? '') || 2.6) * 1000,
    );
  }
  hide() {
    clearTimeout(this.timer);
    this.status.textContent = '';
    this.status.hidden = true;
  }
  /** Off the page: no timer left to fire. */
  disconnectedCallback() {
    clearTimeout(this.timer);
  }
}

/** A HUD part on a paper card: a region (a note's complementary, a dialog), named by `label`, gone while not shown. */
class FallbackPanel extends HTMLElement {
  static observedAttributes = ['shown', 'label', 'kind'];
  private own: boolean | undefined;
  get shown() {
    return this.hasAttribute('shown');
  }
  set shown(v: boolean) {
    on(this, 'shown', v);
  }
  connectedCallback() {
    this.own ??= this.hasAttribute('role');
    this.dataset.fallback = '';
    this.sync();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.sync();
  }
  private sync() {
    const kind = this.getAttribute('kind');
    if (!this.own)
      this.setAttribute('role', kind === 'note' ? 'complementary' : (kind ?? 'region'));
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
    this.hidden = !this.shown;
  }
}

/**
 * A group that opens and closes: its `slot="summary"` child is the button. Closed, the page's CSS hides the rest
 * (styles.css, "Fallbacks"); in jsdom it stays in the DOM, as a closed `<details>`'s content does.
 */
class FallbackFold extends HTMLElement {
  static observedAttributes = ['open'];
  get open() {
    return this.hasAttribute('open');
  }
  set open(v: boolean) {
    on(this, 'open', v);
  }
  constructor() {
    super();
    const flip = (e: Event) => {
      if (!(e.target as Element).closest?.('[slot=summary]')) return;
      e.preventDefault();
      this.open = !this.open;
      fire(this, 'toggle');
    };
    this.addEventListener('click', flip);
    this.addEventListener('keydown', (e) => isKey(e, ' ', 'Enter') && flip(e));
  }
  connectedCallback() {
    this.dataset.fallback = '';
    this.sync();
  }
  attributeChangedCallback() {
    if (this.isConnected) this.sync();
  }
  private sync() {
    const summary = this.querySelector(':scope > [slot=summary]');
    if (!summary) return;
    summary.setAttribute('role', 'button');
    (summary as HTMLElement).tabIndex = 0;
    summary.setAttribute('aria-expanded', String(this.open));
  }
}

/** A paper card: a link with `href`, else a button; `selected` is its pressed (a link's current) state. */
class FallbackCard extends FallbackButton {
  static override observedAttributes = ['disabled', 'label', 'selected', 'href', 'description'];
  get selected() {
    const v = this.getAttribute('selected');
    return v !== null && v !== 'false';
  }
  set selected(v: boolean | null | undefined) {
    if (v == null) this.removeAttribute('selected');
    else this.setAttribute('selected', v ? 'true' : 'false');
  }
  override sync() {
    super.sync();
    const selected = this.getAttribute('selected');
    const link = this.hasAttribute('href');
    if (!link && selected !== null) this.setAttribute('aria-pressed', String(selected !== 'false'));
    if (link && selected !== null && selected !== 'false')
      this.setAttribute('aria-current', 'true');
    else this.removeAttribute('aria-current');
    const description = this.getAttribute('description');
    if (description) this.setAttribute('aria-description', description);
    else this.removeAttribute('aria-description');
  }
}

/** The phone's sheet: its size is the page's CSS, without the spring (styles.css, "Fallbacks"). */
class FallbackSheet extends HTMLElement {
  connectedCallback() {
    this.dataset.fallback = '';
  }
}

/** The tags of `sakuga-hud` (apps/web/sakuga-plugin.ts `HUD_ELEMENTS`) and their plain stand-ins. */
export const FALLBACKS: Record<string, CustomElementConstructor> = {
  'sakuga-button': FallbackButton,
  'sakuga-toggle': FallbackToggle,
  'sakuga-slider': FallbackSlider,
  'sakuga-checkbox': FallbackCheckbox,
  'sakuga-input': FallbackInput,
  'sakuga-tabs': FallbackTabs,
  'sakuga-toast': FallbackToast,
  'sakuga-icon-button': FallbackIconButton,
  'sakuga-badge': FallbackBadge,
  'sakuga-segmented': FallbackSegmented,
  'sakuga-panel': FallbackPanel,
  'sakuga-fold': FallbackFold,
  'sakuga-card': FallbackCard,
  'sakuga-sheet': FallbackSheet,
};

/** Defines a plain stand-in for every HUD tag still undefined; returns the tags it defined. */
export function installFallback(registry: CustomElementRegistry = customElements): string[] {
  const defined: string[] = [];
  for (const [tag, element] of Object.entries(FALLBACKS)) {
    if (registry.get(tag)) continue;
    // A class can be defined once per registry: each tag gets its own subclass.
    registry.define(tag, class extends element {});
    defined.push(tag);
  }
  return defined;
}
