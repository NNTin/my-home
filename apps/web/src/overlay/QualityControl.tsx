import { useEffectsSetting } from '../hud/effects';
import { SkSegmented } from '../hud/SkSegmented';
import { SkToggle } from '../hud/SkToggle';
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
  const [effects, setEffects] = useEffectsSetting();
  return (
    <fieldset className="quality-control">
      <legend>Quality</legend>
      {/* One choice of three: a segmented row (docs/design/hud.md §4.4), compact on a phone. */}
      <SkSegmented
        label="Quality"
        size={phone ? 'compact' : undefined}
        value={quality}
        options={QUALITIES.map((q) => ({ value: q, label: qualityLabel(q, phone) }))}
        onChange={onChange}
      />
      {/* Effects: off is calm, as reduced motion (C3, §10.4): for a slow phone or a quiet evening. */}
      <SkToggle
        className="toggle"
        size="compact"
        label="Effects"
        checked={effects}
        onChange={setEffects}
      >
        Effects
      </SkToggle>
    </fieldset>
  );
}
