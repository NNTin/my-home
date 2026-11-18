import { formatCm, type CatalogType, type ParamSpec, type ParamValues } from '@my-home/shared';
import { useId, useState } from 'react';
import { cmText, lengthInput, normalizeHex, rangeText, withOverride } from './playground';

type Spec<T extends ParamSpec['type']> = Extract<ParamSpec, { type: T }>;

interface ControlProps<T extends ParamSpec['type'], V> {
  spec: Spec<T>;
  value: V;
  onChange(value: V): void;
}

/** A colour: the picker, a hex field (`#rgb` or `#rrggbb`) and a swatch; any colour, no presets. */
function ColorControl({ spec, value, onChange }: ControlProps<'color', string>) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && normalizeHex(draft) === undefined;
  return (
    <div className="playground-row">
      <label htmlFor={id}>{spec.label}</label>
      <div className="playground-control">
        <input
          id={id}
          type="color"
          className="playground-color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
        />
        <input
          type="text"
          className="playground-field"
          aria-label={`${spec.label}, hex`}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => setDraft(null)}
        />
        <span className="swatch" style={{ background: value }} aria-hidden="true" />
      </div>
      {invalid && (
        <p className="playground-error" id={`${id}-error`} role="alert">
          Use #rgb or #rrggbb
        </p>
      )}
    </div>
  );
}

/** A length: a slider in 1 cm steps and a field in cm with one decimal, within the limits. */
function LengthControl({ spec, value, onChange }: ControlProps<'length', number>) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const checked = draft === null ? undefined : lengthInput(spec, draft);
  const error = checked && 'error' in checked ? checked.error : undefined;
  return (
    <div className="playground-row">
      <label htmlFor={id}>{spec.label}</label>
      <div className="playground-control">
        <input
          type="range"
          className="playground-slider"
          aria-label={`${spec.label}, slider`}
          min={Math.ceil(spec.min * 100)}
          max={Math.floor(spec.max * 100)}
          step={1}
          value={Math.round(value * 100)}
          onChange={(e) => {
            setDraft(null);
            onChange(Number(e.target.value) / 100);
          }}
        />
        <span className="playground-cm">
          <input
            id={id}
            type="text"
            inputMode="decimal"
            className="playground-field"
            aria-invalid={error !== undefined}
            aria-describedby={`${id}-range${error ? ` ${id}-error` : ''}`}
            autoComplete="off"
            value={draft ?? cmText(value)}
            onChange={(e) => {
              setDraft(e.target.value);
              const next = lengthInput(spec, e.target.value);
              if ('value' in next) onChange(next.value);
            }}
            onBlur={() => setDraft(null)}
          />{' '}
          cm
        </span>
      </div>
      <p className="playground-hint" id={`${id}-range`}>
        {rangeText(spec)}
      </p>
      {error && (
        <p className="playground-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A count: − value + within the limits. */
function CountControl({ spec, value, onChange }: ControlProps<'count', number>) {
  const id = useId();
  const what = spec.label.toLowerCase();
  return (
    <div className="playground-row" role="group" aria-labelledby={id}>
      <span id={id} className="playground-label">
        {spec.label}
      </span>
      <div className="playground-control playground-stepper">
        <button
          type="button"
          aria-label={`Fewer ${what}`}
          disabled={value <= spec.min}
          onClick={() => onChange(Math.max(spec.min, value - 1))}
        >
          −
        </button>
        <output aria-live="polite" aria-label={spec.label}>
          {value}
        </output>
        <button
          type="button"
          aria-label={`More ${what}`}
          disabled={value >= spec.max}
          onClick={() => onChange(Math.min(spec.max, value + 1))}
        >
          +
        </button>
      </div>
      <p className="playground-hint">
        {spec.min}–{spec.max}
      </p>
    </div>
  );
}

/**
 * The control of one basic parameter: a colour, a length in cm or a count. The playground and the
 * per-use editor both use it.
 */
export function BasicControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: string | number;
  onChange(value: string | number): void;
}) {
  switch (spec.type) {
    case 'color':
      return <ColorControl spec={spec} value={String(value)} onChange={onChange} />;
    case 'length':
      return <LengthControl spec={spec} value={Number(value)} onChange={onChange} />;
    case 'count':
      return <CountControl spec={spec} value={Number(value)} onChange={onChange} />;
    default:
      return null;
  }
}

/** A design value as text: lengths in cm, colours as their hex. */
export function designText(spec: ParamSpec, value: string | number): string {
  if (spec.type === 'length' && typeof value === 'number') return formatCm(value);
  if (spec.type === 'number' && spec.unit) return `${value} ${spec.unit}`;
  return String(value);
}

/**
 * The parameter playground: a control per basic parameter of the type (generated from its
 * specs), the fit of the values, and "Reset to defaults". It only changes `overrides`; nothing is
 * saved.
 */
export function Playground({
  type,
  values,
  overrides,
  issues,
  onChange,
}: {
  type: CatalogType;
  /** The effective values (defaults plus `overrides`). */
  values: ParamValues;
  overrides: ParamValues;
  /** Why the values do not fit (openings: the preview hole). */
  issues: string[];
  onChange(overrides: ParamValues): void;
}) {
  const basic = Object.entries(type.params).filter(([, spec]) => spec.tier === 'basic');
  const set = (key: string, value: string | number) =>
    onChange(withOverride(type, overrides, key, value));
  return (
    <section className="piece-section playground" aria-labelledby="playground-title">
      <h2 id="playground-title">Playground</h2>
      <p className="piece-note">Try the basic parameters on the preview. Nothing here is saved.</p>
      {basic.length === 0 && <p>This type has no basic parameters.</p>}
      {basic.map(([key, spec]) => (
        <BasicControl key={key} spec={spec} value={values[key]!} onChange={(v) => set(key, v)} />
      ))}
      {issues.length > 0 && (
        <ul className="fit-issues" role="status" aria-label="Does not fit">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button playground-reset"
        disabled={Object.keys(overrides).length === 0}
        onClick={() => onChange({})}
      >
        Reset to defaults
      </button>
    </section>
  );
}

/** The design parameters, read-only: they change only with a pull request. */
export function DesignParams({ type, values }: { type: CatalogType; values: ParamValues }) {
  const design = Object.entries(type.params).filter(([, spec]) => spec.tier === 'design');
  return (
    <section className="piece-section design" aria-labelledby="design-title">
      <h2 id="design-title">Design (changed only by a pull request)</h2>
      {design.length === 0 ? (
        <p>Every parameter of this type is basic.</p>
      ) : (
        <dl className="design-params">
          {design.map(([key, spec]) => (
            <div key={key}>
              <dt>{spec.label}</dt>
              <dd>
                {spec.type === 'color' && (
                  <span
                    className="swatch"
                    style={{ background: String(values[key]) }}
                    aria-hidden="true"
                  />
                )}
                {designText(spec, values[key]!)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
