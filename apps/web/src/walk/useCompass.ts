import { useCallback, useEffect, useState } from 'react';
import { yawFromCompass } from './figure';

export interface CompassState {
  /** Whether this device reports its orientation at all. */
  supported: boolean;
  active: boolean;
  error?: string | undefined;
  toggle(): void;
}

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionRequest = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * The compass bearing of an orientation event: degrees clockwise from north, for a phone held
 * upright or flat. iOS reports it directly; elsewhere `alpha` of an absolute event runs the
 * other way round.
 */
export function compassBearing(event: OrientationEvent): number | undefined {
  if (typeof event.webkitCompassHeading === 'number') return event.webkitCompassHeading;
  if (event.absolute && typeof event.alpha === 'number') return (360 - event.alpha) % 360;
  return undefined;
}

/**
 * Optional: turns the figure with the phone, so facing a wall in the real room faces it in the
 * model. Needs the plan's `northBearing`. Phone compasses are easily a few degrees off indoors,
 * which is why the pose can still be corrected by hand.
 */
export function useCompass(northBearing: number, setYaw: (yaw: number) => void): CompassState {
  const supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!active) return;
    const onOrientation = (event: Event) => {
      const bearing = compassBearing(event as OrientationEvent);
      if (bearing !== undefined) setYaw(yawFromCompass(bearing, northBearing));
    };
    // Chrome sends compass-referenced events separately; Safari uses the plain event.
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [active, northBearing, setYaw]);

  const toggle = useCallback(() => {
    if (active) return setActive(false);
    setError(undefined);
    const request = (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission;
    if (!request) return setActive(true);
    // iOS asks the user, and only from a tap.
    request().then(
      (result) =>
        result === 'granted'
          ? setActive(true)
          : setError('The compass needs permission to read the motion sensors.'),
      () => setError('The compass is not available.'),
    );
  }, [active]);

  return { supported, active, error, toggle };
}
