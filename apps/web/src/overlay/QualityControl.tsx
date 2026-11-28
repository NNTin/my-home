import { useEffectsSetting } from '../hud/effects';
import { SkToggle } from '../hud/SkToggle';
import { SkSegmented } from '../hud/SkSegmented';
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
      {/* One choice of three: a segmented row (docs/design/hud.md §4.4), compact on a phone. */}
      <SkSegmented
        label="Quality"
        size={phone ? 'compact' : undefined}
        value={quality}
        options={QUALITIES.map((q) => ({ value: q, label: qualityLabel(q, phone) }))}
        onChange={onChange}
      />
    </fieldset>
  );
}

/**
 * Effects: off is calm, as reduced motion (C3, §10.4): for a slow phone or a quiet evening. In Tools since HUD v2 #203;
 * view quality stays with Views.
 */
export function EffectsSwitch() {
  const [effects, setEffects] = useEffectsSetting();
  return (
    <SkToggle
      className="toggle"
      size="compact"
      label="Effects"
      checked={effects}
      onChange={setEffects}
    >
      Effects
    </SkToggle>
  );
}
