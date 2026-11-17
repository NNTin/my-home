import { useMemo, useState, type MouseEvent } from 'react';
import type { Vec2 } from '../builder/buildHome';
import type { Figure } from './figure';
import { facing } from './figure';
import {
  fromMap,
  MAP_SIZE,
  mapRotation,
  screenToMap,
  type MapView,
  type MinimapLevel,
  type MinimapOrientation,
} from './minimap';

/** A spot to show on the map: a photo request's target or a photo's camera. */
export interface MapSpot {
  id: string;
  x: number;
  z: number;
  /** Undefined outdoors. */
  levelId: string | undefined;
  yaw?: number;
  /** The request picked to answer next. */
  active?: boolean;
}

interface Props {
  figure: Figure;
  levels: ReadonlyMap<string, MinimapLevel>;
  /** The level shown while the figure is outdoors. */
  groundLevelId: string | undefined;
  northBearing: number;
  /** The room the figure is in, highlighted. */
  roomId: string | undefined;
  requests: MapSpot[];
  photos: MapSpot[];
  /** Sets the figure down at a tapped spot of the enlarged map; false where it cannot stand. */
  onPlace?(point: Vec2, levelId: string): boolean;
}

export const MINIMAP_KEY = 'my-home.walk.minimap';
/** Metres across the small map. */
const SMALL_SPAN = 12;

interface Settings {
  orientation: MinimapOrientation;
  photos: boolean;
}

function storedSettings(): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(MINIMAP_KEY) ?? '{}') as Partial<Settings>;
    return {
      orientation: value.orientation === 'north' ? 'north' : 'heading',
      photos: !!value.photos,
    };
  } catch {
    return { orientation: 'heading', photos: false };
  }
}

function storeSettings(settings: Settings) {
  try {
    localStorage.setItem(MINIMAP_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full store: the choice lasts for this visit only.
  }
}

const path = (polygons: Vec2[][]) =>
  polygons
    .filter((p) => p.length > 1)
    .map((p) => `M${p.map(([x, z]) => `${x.toFixed(2)} ${z.toFixed(2)}`).join('L')}Z`)
    .join('');

/** The figure's cone: where it looks, about 60° wide. */
function cone(figure: Figure, length: number): string {
  const side = (turn: number) => {
    const [dx, dz] = facing(figure.yaw + turn);
    return `${(figure.x + dx * length).toFixed(2)} ${(figure.z + dz * length).toFixed(2)}`;
  };
  return `M${figure.x.toFixed(2)} ${figure.z.toFixed(2)}L${side(0.5)}L${side(-0.5)}Z`;
}

/**
 * A top-down map of the figure's level, drawn in SVG from the plan: rooms with their names, the
 * walls, doors, windows and the stair, the figure as a dot with a cone, and the photo request
 * targets. Small in a corner; a tap enlarges it. Heading-up or north-up, remembered per device.
 */
export function Minimap({
  figure,
  levels,
  groundLevelId,
  northBearing,
  roomId,
  requests,
  photos,
  onPlace,
}: Props) {
  const [settings, setSettings] = useState(storedSettings);
  const change = (next: Partial<Settings>) => {
    const value = { ...settings, ...next };
    storeSettings(value);
    setSettings(value);
  };
  const [large, setLarge] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [refused, setRefused] = useState(false);
  const levelId = figure.levelId ?? groundLevelId;
  const level = levelId === undefined ? undefined : levels.get(levelId);

  /**
   * While a spot is being picked the enlarged map stands still: heading-up would otherwise turn
   * it under the finger as the phone (Sensor mode) or the figure turns.
   */
  const [frozen, setFrozen] = useState<number>();
  const rotation = frozen ?? mapRotation(settings.orientation, figure.yaw, northBearing);
  const view: MapView | undefined = useMemo(() => {
    if (!level) return undefined;
    if (!large) {
      return { center: [figure.x, figure.z], scale: MAP_SIZE / SMALL_SPAN, rotation };
    }
    // The whole level, turned any way, fits.
    const { min, max } = level.bounds;
    const diagonal = Math.max(4, Math.hypot(max[0] - min[0], max[1] - min[1]) + 1);
    return {
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
      scale: MAP_SIZE / diagonal,
      rotation,
    };
  }, [level, large, figure.x, figure.z, rotation]);

  // The plan does not change while walking: its paths are built once per level.
  const shapes = useMemo(
    () =>
      level && {
        footprint: path([level.footprint]),
        rooms: new Map(level.rooms.map((r) => [r.id, path([r.outline])])),
        walls: path(level.walls),
        doors: path(level.doors),
        windows: path(level.windows),
        fences: path(level.fences),
        gates: path(level.gates),
      },
    [level],
  );

  if (!level || !view || !shapes) return null;
  const metre = 1 / view.scale;
  const font = (large ? 3.2 : 7) * metre;
  const here = (spot: MapSpot) => (spot.levelId ?? groundLevelId) === levelId;
  const shownRequests = requests.filter(here);
  const shownPhotos = settings.photos ? photos.filter(here) : [];
  const northAngle = northBearing + rotation;
  const where = level.rooms.find((r) => r.id === roomId)?.name;

  const map = (
    <svg
      className="walk-map-svg"
      viewBox={`${-MAP_SIZE / 2} ${-MAP_SIZE / 2} ${MAP_SIZE} ${MAP_SIZE}`}
      data-level={level.levelId}
      data-orientation={settings.orientation}
      data-rotation={rotation.toFixed(1)}
      aria-hidden="true"
    >
      <g
        transform={`rotate(${rotation.toFixed(2)}) scale(${view.scale.toFixed(4)}) translate(${(-view.center[0]).toFixed(3)} ${(-view.center[1]).toFixed(3)})`}
      >
        <path className="map-footprint" d={shapes.footprint} />
        {level.rooms.map((r) => (
          <path
            key={r.id}
            className={r.id === roomId ? 'map-room here' : 'map-room'}
            data-room={r.id}
            d={shapes.rooms.get(r.id)}
          />
        ))}
        {level.stairs.map((stair) => (
          <path
            key={stair.id}
            className="map-stair"
            data-stair={stair.id}
            data-from={stair.fromLevelId}
            data-to={stair.toLevelId}
            d={path(stair.steps)}
          />
        ))}
        <path className="map-wall" d={shapes.walls} />
        <path className="map-window" d={shapes.windows} />
        <path className="map-door" d={shapes.doors} />
        <path className="map-fence" d={shapes.fences} />
        <path className="map-gate" d={shapes.gates} />
        {level.rooms.map((r) => (
          <text
            key={r.id}
            className="map-label"
            x={r.label[0]}
            y={r.label[1]}
            fontSize={font}
            // In metres, like everything in the turned and scaled group.
            strokeWidth={font * 0.2}
            transform={`rotate(${(-rotation).toFixed(2)} ${r.label[0]} ${r.label[1]})`}
          >
            {r.name}
          </text>
        ))}
        {shownPhotos.map((p) => (
          <g key={p.id} className="map-photo" data-photo={p.id}>
            <path d={cone({ x: p.x, z: p.z, y: 0, yaw: p.yaw ?? 0, pitch: 0 }, 0.9)} />
            <circle cx={p.x} cy={p.z} r={0.15} />
          </g>
        ))}
        {shownRequests.map((r) => (
          <circle
            key={r.id}
            className={r.active ? 'map-request active' : 'map-request'}
            data-request={r.id}
            cx={r.x}
            cy={r.z}
            r={(large ? 1.6 : 3) * metre}
          />
        ))}
        <g className="map-figure" data-x={figure.x.toFixed(2)} data-z={figure.z.toFixed(2)}>
          <path className="map-cone" d={cone(figure, (large ? 9 : 22) * metre)} />
          <circle cx={figure.x} cy={figure.z} r={(large ? 1.8 : 4) * metre} />
        </g>
      </g>
      <g className="map-north" transform={`translate(${MAP_SIZE / 2 - 11} ${-MAP_SIZE / 2 + 11})`}>
        <path d="M0 -6L3 3L0 1L-3 3Z" transform={`rotate(${northAngle.toFixed(1)})`} />
        {/* Upright, beyond the arrow's tip. */}
        <text
          x={(Math.sin((northAngle * Math.PI) / 180) * 8.5).toFixed(2)}
          y={(-Math.cos((northAngle * Math.PI) / 180) * 8.5 + 2).toFixed(2)}
          fontSize={6}
        >
          N
        </text>
      </g>
    </svg>
  );

  const label = `Map of ${level.name}${where ? `, in ${where}` : ''}`;
  if (!large) {
    return (
      <button
        type="button"
        className="walk-map"
        aria-label={`${label}. Tap to enlarge`}
        onClick={() => setLarge(true)}
      >
        {map}
      </button>
    );
  }

  const shrink = () => {
    setLarge(false);
    setPlacing(false);
    setFrozen(undefined);
    setRefused(false);
  };
  const tap = (e: MouseEvent<HTMLDivElement>) => {
    if (!placing || !onPlace) return shrink();
    const at = screenToMap(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
    const point = at && fromMap(view, at);
    if (point && onPlace(point, level.levelId)) shrink();
    else setRefused(true);
  };
  return (
    <section
      className="walk-map-large"
      aria-label="Map"
      onKeyDown={(e) => {
        if (e.key === 'Escape') shrink();
      }}
    >
      <div className="walk-map-head">
        <strong>{level.name}</strong>
        <div className="segmented" role="radiogroup" aria-label="Map orientation">
          {(
            [
              ['heading', '⬆ Heading'],
              ['north', 'N North'],
            ] as const
          ).map(([orientation, text]) => (
            <button
              key={orientation}
              type="button"
              role="radio"
              aria-checked={settings.orientation === orientation}
              onClick={() => {
                change({ orientation });
                // Picking a spot: turn once to the chosen orientation, then stand still again.
                if (frozen !== undefined) {
                  setFrozen(mapRotation(orientation, figure.yaw, northBearing));
                }
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={settings.photos}
          aria-label="Photos on the map"
          title="Show the cameras of the photos of this level"
          onClick={() => change({ photos: !settings.photos })}
        >
          📷
        </button>
        {onPlace && (
          <button
            type="button"
            aria-pressed={placing}
            title="Tap a spot on the map to put the figure there"
            onClick={() => {
              setPlacing(!placing);
              setFrozen(placing ? undefined : rotation);
              setRefused(false);
            }}
          >
            📍 Move
          </button>
        )}
        <button type="button" className="primary" aria-label="Close the map" onClick={shrink}>
          ✕
        </button>
      </div>
      <p className="hint" role="status">
        {refused
          ? 'The figure cannot stand there: tap a free spot on a floor.'
          : placing
            ? 'Tap the spot to put the figure there.'
            : 'Tap the map to make it small again.'}
      </p>
      <div
        className="walk-map-area"
        role="application"
        aria-label={placing ? 'Map: tap where the figure should stand' : `${label}. Tap to shrink`}
        onClick={tap}
      >
        {map}
      </div>
    </section>
  );
}
