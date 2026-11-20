import { QUALITIES, qualityLabel, type Quality } from '../quality/setting';

/**
 * The Quality control of the View panel (docs/design/realistic-render.md §3.2): three values,
 * remembered on this device. A phone's labels say what happens.
 */
export function QualityControl({
  quality,
  onChange,
  phone,
}: {
  quality: Quality;
  onChange(quality: Quality): void;
  phone: boolean;
}) {
  return (
    <fieldset className="quality-control">
      <legend>Quality</legend>
      {QUALITIES.map((q) => (
        <label key={q} className="toggle">
          <input type="radio" name="quality" checked={quality === q} onChange={() => onChange(q)} />{' '}
          {qualityLabel(q, phone)}
        </label>
      ))}
    </fieldset>
  );
}
