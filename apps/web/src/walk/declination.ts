import type { HomeSettingsApi } from '../api';
import type { DeclinationSource } from './WalkHud';

/**
 * Saves the magnetic declination entered in walk mode as the home's setting (stored on top of
 * the git model, so a deploy keeps it) and returns the saved value in degrees. It reads the
 * current version first, so another tab's change is overwritten, never refused.
 */
export async function saveHomeDeclination(
  api: Pick<HomeSettingsApi, 'get' | 'put'>,
  homeId: string,
  degrees: number,
  source: DeclinationSource,
): Promise<number> {
  const note =
    source === 'measured'
      ? 'Measured on site, entered in the app'
      : 'From a declination chart or model, entered in the app';
  const { version } = await api.get(homeId);
  const saved = await api.put(homeId, {
    version,
    magneticDeclination: { value: degrees, source, note },
  });
  return saved.magneticDeclination?.value ?? degrees;
}
