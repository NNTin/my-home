import { catalog, effectiveParams, type CatalogType, type ParamValues } from '@my-home/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { decodeOverrides, encodeOverrides, lengthInput, normalizeHex } from './playground';
import { DesignParams, Playground } from './Playground';

/** The playground with its state, showing the overrides it would apply. */
function Harness({ type, initial = {} }: { type: CatalogType; initial?: ParamValues }) {
  const [overrides, setOverrides] = useState(initial);
  const values = effectiveParams(type, overrides).values;
  return (
    <>
      <Playground
        type={type}
        values={values}
        overrides={overrides}
        issues={[]}
        onChange={setOverrides}
      />
      <DesignParams type={type} values={values} />
      <output data-testid="overrides">{JSON.stringify(overrides)}</output>
    </>
  );
}

/** A sakuga-slider (its fallback here): set its value and say so, as a drag does. */
const slide = (slider: HTMLElement, value: string) =>
  act(() => {
    (slider as HTMLElement & { value: string }).value = value;
    fireEvent.input(slider);
  });

const overrides = () => JSON.parse(screen.getByTestId('overrides').textContent!) as ParamValues;
const playground = () => within(screen.getByRole('region', { name: 'Playground' }));
const design = () =>
  within(screen.getByRole('region', { name: 'Design (changed only by a pull request)' }));

describe('Playground controls, generated from the specs', () => {
  it.each(catalog.types.map((t) => [t.id, t] as const))(
    '%s: basic parameters are editable, design ones read-only',
    (_id, type) => {
      render(<Harness type={type} />);
      const specs = Object.values(type.params);
      let controls = 0;
      for (const spec of specs.filter((s) => s.tier === 'basic')) {
        if (spec.type === 'color') {
          expect(playground().getByLabelText(spec.label)).toHaveAttribute('type', 'color');
          expect(playground().getByRole('textbox', { name: `${spec.label}, hex` })).toHaveValue(
            spec.default,
          );
          controls += 2;
        } else if (spec.type === 'length') {
          expect(
            playground().getByRole('slider', { name: `${spec.label}, slider` }),
          ).toHaveAttribute('aria-valuenow', String(Math.round(spec.default * 100)));
          expect(playground().getByRole('textbox', { name: spec.label })).toHaveValue(
            (spec.default * 100).toFixed(1),
          );
          expect(
            playground().getAllByText(
              `${(spec.min * 100).toFixed(1)}–${(spec.max * 100).toFixed(1)} cm`,
            ).length,
          ).toBeGreaterThan(0);
          controls += 2;
        } else if (spec.type === 'count') {
          const group = within(playground().getByRole('group', { name: spec.label }));
          const fewer = group.getByRole('button', { name: `Fewer ${spec.label.toLowerCase()}` });
          const more = group.getByRole('button', { name: `More ${spec.label.toLowerCase()}` });
          expect(fewer.hasAttribute('disabled')).toBe(spec.default === spec.min);
          expect(more.hasAttribute('disabled')).toBe(spec.default === spec.max);
          controls += 2;
        } else if (spec.type === 'fraction') {
          expect(playground().getByRole('slider', { name: spec.label })).toHaveAttribute(
            'aria-valuenow',
            String(Math.round(spec.default * 100)),
          );
          controls += 1;
        } else if (spec.type === 'choice') {
          const select = playground().getByRole('combobox', { name: spec.label });
          expect(select).toHaveValue(spec.default);
          expect(within(select).getAllByRole('option')).toHaveLength(spec.options.length);
          controls += 1;
        }
      }
      // Every input of the playground is one of those (plus "Reset to defaults").
      expect(
        document.querySelectorAll(
          '.playground input, .playground select, .playground sakuga-button, .playground sakuga-slider',
        ),
      ).toHaveLength(controls + 1);
      const designSpecs = specs.filter((s) => s.tier === 'design');
      for (const spec of designSpecs) expect(design().getByText(spec.label)).toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: /^Design/ }).querySelectorAll('input, button, select'),
      ).toHaveLength(0);
    },
  );

  it('shows design lengths in cm and colours as hex', () => {
    render(<Harness type={catalog.get('window.casement')!} />);
    expect(design().getByText('Frame width').nextElementSibling).toHaveTextContent('6.5 cm');
    expect(design().getByText('Glass colour').nextElementSibling).toHaveTextContent('#a8d4ff');
    expect(design().getByText('Glass opacity').nextElementSibling).toHaveTextContent('0.35');
  });
});

describe('choices and fractions', () => {
  it('picks a roller shutter box and closes it in 5 % steps', () => {
    render(<Harness type={catalog.get('window.tilt-turn')!} />);
    fireEvent.change(playground().getByRole('combobox', { name: 'Roller shutter' }), {
      target: { value: 'outside' },
    });
    const closed = playground().getByRole('slider', { name: 'Shutter closed' });
    expect(closed).toHaveAttribute('step', '5');
    slide(closed, '40');
    expect(overrides()).toEqual({ shutter: 'outside', shutterClosed: 0.4 });
    expect(closed).toHaveAttribute('aria-valuetext', '40%');
    // Back to the default drops the override.
    fireEvent.change(playground().getByRole('combobox', { name: 'Roller shutter' }), {
      target: { value: 'none' },
    });
    expect(overrides()).toEqual({ shutterClosed: 0.4 });
  });
});

describe('lengths in cm', () => {
  const bed = catalog.get('furniture.bed')!;
  const width = () => playground().getByRole('textbox', { name: 'Width' });

  it.each([
    ['92.5', 0.925],
    ['92,5', 0.925],
    ['180', 1.8],
    [' 120.0 cm', 1.2],
  ])('applies %j as %s m', (text, metres) => {
    render(<Harness type={bed} />);
    fireEvent.change(width(), { target: { value: text } });
    expect(overrides()).toEqual({ width: metres });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(width());
    expect(width()).toHaveValue((metres * 100).toFixed(1));
  });

  it.each([
    ['abc', 'Type a length in cm, e.g. 92.5'],
    ['250', 'At most 220.0 cm'],
    ['79.9', 'At least 80.0 cm'],
  ])('does not apply %j and says why', (text, message) => {
    render(<Harness type={bed} initial={{ width: 1.8 }} />);
    fireEvent.change(width(), { target: { value: text } });
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(width()).toHaveAttribute('aria-invalid', 'true');
    expect(overrides()).toEqual({ width: 1.8 });
    // Leaving the field shows the value that applies.
    fireEvent.blur(width());
    expect(width()).toHaveValue('180.0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves in 1 cm steps on the slider, and the default is not an override', () => {
    render(<Harness type={bed} />);
    const slider = playground().getByRole('slider', { name: 'Width, slider' });
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveAttribute('min', '80');
    expect(slider).toHaveAttribute('max', '220');
    slide(slider, '181');
    expect(overrides()).toEqual({ width: 1.81 });
    expect(width()).toHaveValue('181.0');
    slide(slider, '160');
    expect(overrides()).toEqual({});
  });

  it('parses and checks lengths as pure functions', () => {
    const spec = {
      type: 'length',
      tier: 'basic',
      label: 'W',
      default: 1,
      min: 0.8,
      max: 2.2,
      step: 0.001,
    } as const;
    expect(lengthInput(spec, '92,5')).toEqual({ value: 0.925 });
    expect(lengthInput(spec, '220')).toEqual({ value: 2.2 });
    expect(lengthInput(spec, '220.1')).toEqual({ error: 'At most 220.0 cm' });
    expect(lengthInput(spec, '')).toEqual({ error: 'Type a length in cm, e.g. 92.5' });
  });
});

describe('colours', () => {
  it('normalises #rgb and #rrggbb to lower case, and rejects anything else', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' #A8D4FF ')).toBe('#a8d4ff');
    for (const bad of ['abc', '#abcd', '#12345', '#ggg', ''])
      expect(normalizeHex(bad)).toBeUndefined();
  });

  it('applies a typed hex colour, and a picked one', () => {
    render(<Harness type={catalog.get('furniture.bed')!} />);
    const hex = playground().getByRole('textbox', { name: 'Colour, hex' });
    fireEvent.change(hex, { target: { value: '#ABC' } });
    expect(overrides()).toEqual({ color: '#aabbcc' });
    fireEvent.blur(hex);
    expect(hex).toHaveValue('#aabbcc');
    fireEvent.change(hex, { target: { value: '#12' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Use #rgb or #rrggbb');
    expect(overrides()).toEqual({ color: '#aabbcc' });
    fireEvent.change(playground().getByLabelText('Colour'), { target: { value: '#336699' } });
    expect(overrides()).toEqual({ color: '#336699' });
  });
});

describe('counts', () => {
  it('steps within the limits', () => {
    render(<Harness type={catalog.get('window.casement')!} />);
    const more = playground().getByRole('button', { name: 'More sashes' });
    const fewer = playground().getByRole('button', { name: 'Fewer sashes' });
    for (let i = 0; i < 5; i++) fireEvent.click(more);
    expect(overrides()).toEqual({ sashes: 4 });
    expect(more).toBeDisabled();
    expect(fewer).toBeEnabled();
    expect(playground().getByRole('status', { name: 'Sashes' })).toHaveTextContent('4');
  });
});

describe('Reset to defaults', () => {
  it('drops every override', () => {
    render(
      <Harness type={catalog.get('furniture.bed')!} initial={{ width: 1.8, color: '#000000' }} />,
    );
    const reset = playground().getByRole('button', { name: 'Reset to defaults' });
    fireEvent.click(reset);
    expect(overrides()).toEqual({});
    expect(reset).toBeDisabled();
    expect(playground().getByRole('textbox', { name: 'Width' })).toHaveValue('160.0');
  });
});

describe('?p= (a shared playground state)', () => {
  const bed = catalog.get('furniture.bed')!;

  it('round-trips valid overrides, base64url', () => {
    const p = encodeOverrides({ width: 1.8, color: '#336699' });
    expect(p).toMatch(/^[\w-]+$/);
    expect(decodeOverrides(bed, p)).toEqual({ width: 1.8, color: '#336699' });
    expect(encodeOverrides({})).toBe('');
  });

  it('ignores anything not valid against basicOverridesSchema', () => {
    const encode = (v: unknown) => encodeOverrides(v as ParamValues);
    expect(decodeOverrides(bed, encode({ width: 3 }))).toEqual({});
    expect(decodeOverrides(bed, encode({ height: 0.5 }))).toEqual({});
    expect(decodeOverrides(bed, encode({ nope: 1 }))).toEqual({});
    expect(decodeOverrides(bed, '%%%')).toEqual({});
    expect(decodeOverrides(bed, 'bm90IGpzb24')).toEqual({});
    expect(decodeOverrides(bed, null)).toEqual({});
  });
});
