import { useThree } from '@react-three/fiber';
import { createElement, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useHost } from '../hud/useElement';
import { CanvasTexture, SRGBColorSpace, type Vector3 } from 'three';
import type { Vec3 } from '../builder/buildHome';
import { compassRotation, northUpPosition, type CompassMarker } from './compass';

/**
 * The HUD compass (`<sakuga-compass>`, packages/sakuga-vfx/compass, HUD v2 #202): the scene turns it through the
 * `--rose` CSS variable on its host on every camera move, without React; a press turns the view north-up, and the
 * element swings its needle in.
 */
export function CompassRose({
  roseRef,
  onNorthUp,
  compact = false,
}: {
  roseRef: RefObject<HTMLElement | null>;
  onNorthUp(): void;
  /** A phone's: 60 px, the compact line. */
  compact?: boolean;
}) {
  const latest = useRef(onNorthUp);
  useEffect(() => {
    latest.current = onNorthUp;
  });
  // The element, handed to the scene's ref (it turns it), with its click listened to.
  const [host, setHost] = useHost<HTMLElement>();
  useEffect(() => {
    roseRef.current = host;
    if (!host) return;
    const click = () => latest.current();
    host.addEventListener('click', click);
    return () => {
      host.removeEventListener('click', click);
      // Unmounted: the scene no longer turns an element that is gone.
      if (roseRef.current === host) roseRef.current = null;
    };
  }, [host, roseRef]);
  return createElement('sakuga-compass', {
    ref: setHost,
    className: 'compass',
    size: compact ? 'compact' : undefined,
    label: 'Compass: turn the view north-up',
    title: 'Turn the view north-up',
  });
}

/** The HUD compass rose and the home's north, for views the orbit controls do not drive. */
export interface RoseTarget {
  ref: RefObject<HTMLElement | null>;
  /** `building.northBearing`. */
  northBearing: number;
}

/**
 * Turns the rose for a camera that looks along a plan yaw (first person, "view from here"). The
 * orbit tracker below only hears the orbit controls, which are off in those views.
 */
export function turnRose(rose: RoseTarget, yaw: number) {
  const value = `${compassRotation(rose.northBearing, yaw)}deg`;
  const style = rose.ref.current?.style;
  if (style && style.getPropertyValue('--rose') !== value) style.setProperty('--rose', value);
}

/** What the tracker needs from drei's OrbitControls (three-stdlib). */
interface Controls {
  target: Vector3;
  getAzimuthalAngle(): number;
  update(): void;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/**
 * Inside the canvas: reports the compass rotation whenever the orbit camera moves and provides
 * the north-up action. Writes to the DOM directly so orbiting does not re-render React.
 */
export function CompassTracker({
  northBearing,
  roseRef,
  northUpRef,
}: {
  northBearing: number;
  roseRef: RefObject<HTMLElement | null>;
  northUpRef: RefObject<(() => void) | undefined>;
}) {
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!controls) return;
    const update = () => {
      const deg = compassRotation(northBearing, controls.getAzimuthalAngle());
      roseRef.current?.style.setProperty('--rose', `${deg}deg`);
    };
    update();
    controls.addEventListener('change', update);
    northUpRef.current = () => {
      const [x, y, z] = northUpPosition(
        camera.position.toArray() as Vec3,
        controls.target.toArray() as Vec3,
        northBearing,
      );
      camera.position.set(x, y, z);
      controls.update();
    };
    return () => {
      controls.removeEventListener('change', update);
      northUpRef.current = undefined;
    };
  }, [controls, camera, northBearing, roseRef, northUpRef]);
  return null;
}

/** A letter on a round, translucent badge that always faces the camera. */
function MarkerSprite({ marker }: { marker: CompassMarker }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(20, 24, 30, 0.55)';
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = marker.label === 'N' ? '#ff8a80' : '#f1f3f4';
      ctx.font = 'bold 76px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(marker.label, 64, 68);
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [marker.label]);
  const [x, y, z] = marker.position;
  return (
    <sprite position={[x, y + 0.6, z]} scale={[1.1, 1.1, 1]}>
      <spriteMaterial map={texture} transparent opacity={0.85} depthWrite={false} />
    </sprite>
  );
}

export function CompassMarkers({
  markers,
  hidden = false,
}: {
  markers: CompassMarker[];
  /**
   * Not drawn for now (a named view). They stay in the scene: taking them out would free their
   * shader program, and bringing them back would compile it again (§4.5).
   */
  hidden?: boolean;
}) {
  return (
    // Not part of an exported image (§7.4).
    <group visible={!hidden} userData={{ overlay: true }}>
      {markers.map((m) => (
        <MarkerSprite key={m.label} marker={m} />
      ))}
    </group>
  );
}
