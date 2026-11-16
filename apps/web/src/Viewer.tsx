import { northBearingOf, type HomeModel, type HomeSummary, type LayoutItem } from '@my-home/shared';
import { useEffect, useMemo, useState } from 'react';
import { photosApi } from './api';
import {
  buildHome,
  type HomeScene,
  type LevelInfo,
  type Vec2,
  type Vec3,
} from './builder/buildHome';
import { compassMarkers } from './compass/compass';
import {
  defaultVisibility,
  roofIndex,
  roomLabels,
  visibleScene,
  type Visibility,
} from './builder/visibility';
import { canRedo, canUndo } from './editor/editorState';
import {
  collisions,
  createContext,
  createItem,
  defaultSettings,
  duplicateItem,
  hasIssues,
  issuesOf,
  moveItem,
  positionOf,
  relocateItem,
  rotateItem,
  setRotation,
  UNKNOWN_SIZE,
  worldFootprint,
  type EditorSettings,
} from './editor/operations';
import { roomAt } from './editor/placement';
import { shortcutFor } from './editor/shortcuts';
import { rotationFromDrag } from './editor/snapping';
import { registry } from './items/registry';
import { useLayouts } from './layouts/useLayouts';
import { ControlPanel } from './overlay/ControlPanel';
import { FurniturePanel, type FlaggedItem, type SelectedInfo } from './overlay/FurniturePanel';
import type { FurnitureHandlers, FurnitureView } from './scene/FurnitureLayer';
import { Scene } from './scene/Scene';
import type { Figure } from './walk/figure';
import { useCompass } from './walk/useCompass';
import { useWalk } from './walk/useWalk';
import { WalkHud, type WalkView } from './walk/WalkHud';
import { buildWalkWorld, startPose, type FurnitureBlocker } from './walk/world';

const shownLevels = (scene: HomeScene, v: Visibility) =>
  scene.levels.filter((l) => l.index <= v.maxLevelIndex && !v.hiddenLevels.includes(l.id));

/** The level furniture is added to: the highest one still shown (the cutaway level). */
export const currentLevel = (scene: HomeScene, v: Visibility): LevelInfo | undefined =>
  shownLevels(scene, v).at(-1) ?? scene.levels[0];

/** Orbit around the middle of the highest level still shown, so a cutaway looks into it. */
export function orbitTarget(scene: HomeScene, v: Visibility): Vec3 {
  const top = currentLevel(scene, v);
  const { min, max } = scene.bounds;
  return [(min[0] + max[0]) / 2, top ? top.elevation + top.height / 2 : 0, (min[2] + max[2]) / 2];
}

/**
 * What is shown while walking. In first person the whole building, since the camera is inside
 * it. In the overview the cutaway follows the figure: the level it is on, or everything outdoors.
 */
export function walkVisibility(
  scene: HomeScene,
  v: Visibility,
  view: WalkView,
  levelId: string | undefined,
): Visibility {
  const level = scene.levels.find((l) => l.id === levelId);
  const whole = { ...v, maxLevelIndex: roofIndex(scene), hiddenLevels: [] };
  if (view === 'first') return { ...whole, hiddenApartments: [], showRoomNames: false };
  return level ? { ...whole, maxLevelIndex: level.index } : whole;
}

/** `?walk=first` or `?walk=third` (or just `?walk`) opens the viewer already walking. */
function initialWalk(): WalkView | undefined {
  const value = new URLSearchParams(window.location.search).get('walk');
  if (value === null) return undefined;
  return value === 'third' ? 'third' : 'first';
}

const UNKNOWN_COLOR = '#9e9e9e';
const newId = () => crypto.randomUUID();

interface Props {
  model: HomeModel;
  homes: HomeSummary[];
  onSelectHome(id: string): void;
}

/** Renders one home and its furniture; mount with `key={model.id}` so switching homes resets. */
export function Viewer({ model, homes, onSelectHome }: Props) {
  const scene = useMemo(() => buildHome(model), [model]);
  const [chosenVisibility, setVisibility] = useState(() => defaultVisibility(scene));
  const [walkView, setWalkView] = useState<WalkView | undefined>(initialWalk);
  const northBearing = northBearingOf(model.building);
  const markers = useMemo(
    () =>
      compassMarkers(
        model.building.footprint.map((p): Vec2 => [p.x.value, p.z.value]),
        model.terrain.groundElevation.value,
        northBearing,
      ),
    [model, northBearing],
  );

  const layouts = useLayouts(model.id);
  const { editor, actions } = layouts;
  const { dispatch } = actions;
  const [settings, setSettings] = useState<EditorSettings>(defaultSettings);
  const ctx = useMemo(() => createContext(model, registry, settings), [model, settings]);

  const { items } = editor;

  // The figure: blocked by walls, fences and the furniture of the active layout.
  const world = useMemo(() => {
    const blockers = items.flatMap((item): FurnitureBlocker[] => {
      const type = registry.get(item.typeId);
      return ctx.plans.has(item.levelId)
        ? [
            {
              levelId: item.levelId,
              polygon: worldFootprint(ctx, item),
              height: (type?.size ?? UNKNOWN_SIZE).height,
            },
          ]
        : [];
    });
    return buildWalkWorld(model, scene, blockers);
  }, [model, scene, ctx, items]);
  const start = useMemo(() => {
    const pose = startPose(model, world) ?? { x: 0, z: 0, y: 0, yaw: 0 };
    return { ...pose, pitch: 0 };
    // Only where the figure first appears: it must not jump when furniture changes the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  const walking = walkView !== undefined;
  const walk = useWalk(world, start, walking);
  const compass = useCompass(northBearing, walk.setYaw);
  const figureLevel = scene.levels.find((l) => l.id === walk.levelId);
  const describeFigure = (figure: Figure) => {
    const on = scene.levels.find((l) => l.id === figure.levelId);
    const figurePlan = on && ctx.plans.get(on.id);
    const room = figurePlan && roomAt(figurePlan, [figure.x, figure.z]);
    return [room?.name, on?.name].filter(Boolean).join(' · ');
  };

  const visibility = useMemo(
    () =>
      walkView
        ? walkVisibility(scene, chosenVisibility, walkView, figureLevel?.id)
        : chosenVisibility,
    [scene, chosenVisibility, walkView, figureLevel?.id],
  );
  const shown = useMemo(() => visibleScene(scene, visibility), [scene, visibility]);
  const labels = useMemo(() => roomLabels(scene, visibility), [scene, visibility]);

  const level = currentLevel(scene, visibility);
  const plan = level && ctx.plans.get(level.id);
  const [roomChoice, setRoomChoice] = useState<string>();
  const roomId = plan?.rooms.some((r) => r.id === roomChoice) ? roomChoice : plan?.rooms[0]?.id;

  const found = useMemo(() => collisions(ctx, items), [ctx, items]);
  const selectedItem = items.find((i) => i.id === editor.selectedId);

  const furniture = useMemo((): FurnitureView[] => {
    const levels = new Set(shownLevels(scene, visibility).map((l) => l.id));
    const hiddenApartments = new Set(visibility.hiddenApartments);
    return items.flatMap((item) => {
      const p = ctx.plans.get(item.levelId);
      if (!p || !levels.has(item.levelId)) return [];
      const apartment = p.rooms.find((r) => r.id === item.roomId)?.apartmentId;
      if (apartment !== undefined && hiddenApartments.has(apartment)) return [];
      const type = registry.get(item.typeId);
      return [
        {
          id: item.id,
          position: [item.position.x, p.elevation, item.position.z] as Vec3,
          rotationY: item.rotationY,
          size: type?.size ?? UNKNOWN_SIZE,
          color: type?.color ?? UNKNOWN_COLOR,
          ...(type && { Render: type.Render }),
          selected: item.id === editor.selectedId,
          colliding: found.has(item.id),
        },
      ];
    });
  }, [ctx, items, found, scene, visibility, editor.selectedId]);

  const nameOf = (item: LayoutItem) =>
    registry.get(item.typeId)?.name ?? `Unknown type "${item.typeId}"`;

  const edit = (label: string, next: LayoutItem[], selectedId?: string | null) =>
    dispatch({ type: 'edit', label, items: next, ...(selectedId !== undefined && { selectedId }) });

  const commands = {
    place(typeId: string) {
      if (!level) return;
      const item = createItem(ctx, items, {
        id: newId(),
        typeId,
        levelId: level.id,
        ...(roomId !== undefined && { roomId }),
      });
      edit('Place', [...items, item], item.id);
    },
    rotate(steps: number) {
      if (!selectedItem) return;
      const rotated = rotateItem(ctx, selectedItem, steps);
      edit(
        'Rotate',
        items.map((i) => (i.id === rotated.id ? rotated : i)),
      );
    },
    duplicate() {
      if (!selectedItem) return;
      const copy = duplicateItem(ctx, items, selectedItem, newId());
      edit('Duplicate', [...items, copy], copy.id);
    },
    remove() {
      if (!selectedItem) return;
      edit(
        'Delete',
        items.filter((i) => i.id !== selectedItem.id),
        null,
      );
    },
    relocate(id: string) {
      const item = items.find((i) => i.id === id);
      if (!item || !level) return;
      const moved = relocateItem(ctx, items, item, level.id, roomId);
      edit(
        'Move',
        items.map((i) => (i.id === id ? moved : i)),
        id,
      );
    },
  };

  const handlers: FurnitureHandlers = {
    onSelect: (id) => dispatch({ type: 'select', ...(id !== undefined && { id }) }),
    onMoveStart: (id) => dispatch({ type: 'dragStart', id }),
    onRotateStart: (id) => dispatch({ type: 'dragStart', id }),
    onMove(id, target) {
      const current = items.find((i) => i.id === id);
      const before = editor.drag?.id === id ? editor.drag.before : undefined;
      if (!current || !before) return;
      // Snap from the rotation the drag started with, so leaving a wall undoes its turn.
      const moved = moveItem(ctx, { ...current, rotationY: before.rotationY }, target);
      dispatch({ type: 'dragMove', item: moved });
    },
    onRotate(id, from, to) {
      const current = items.find((i) => i.id === id);
      const before = editor.drag?.id === id ? editor.drag.before : undefined;
      if (!current || !before) return;
      const r = rotationFromDrag(
        positionOf(current),
        from,
        to,
        before.rotationY,
        settings.rotationStep,
      );
      dispatch({ type: 'dragMove', item: setRotation(ctx, current, r) });
    },
    onDragEnd: () => dispatch({ type: 'dragEnd' }),
  };

  // Keyboard shortcuts (see editor/shortcuts.ts).
  const onKey = (e: KeyboardEvent) => {
    // While walking the keys steer the figure; the furniture editor is put away.
    const action = walking ? undefined : shortcutFor(e);
    if (!action) return;
    if (action === 'undo' || action === 'redo' || action === 'duplicate') e.preventDefault();
    if (action === 'undo') dispatch({ type: 'undo' });
    else if (action === 'redo') dispatch({ type: 'redo' });
    else if (action === 'deselect') dispatch({ type: 'select' });
    else if (action === 'rotate') commands.rotate(1);
    else if (action === 'rotate-back') commands.rotate(-1);
    else if (action === 'duplicate') commands.duplicate();
    else if (action === 'delete') {
      if (selectedItem) e.preventDefault();
      commands.remove();
    }
  };
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selected: SelectedInfo | undefined = selectedItem && {
    name: nameOf(selectedItem),
    where: (() => {
      const p = ctx.plans.get(selectedItem.levelId);
      const room = p?.rooms.find((r) => r.id === selectedItem.roomId);
      return room ? `in ${room.name}` : p ? `on ${p.levelName}` : '';
    })(),
    problems: [
      ...(found.get(selectedItem.id)?.wallIds.length ? ['Overlaps a wall'] : []),
      ...(found.get(selectedItem.id)?.itemIds.length
        ? [
            `Overlaps ${found
              .get(selectedItem.id)!
              .itemIds.map((id) => {
                const other = items.find((i) => i.id === id);
                return other ? nameOf(other).toLowerCase() : id;
              })
              .join(', ')}`,
          ]
        : []),
    ],
  };

  const flagged: FlaggedItem[] = items.flatMap((item) => {
    const issues = issuesOf(ctx, item);
    if (!hasIssues(issues)) return [];
    return [
      {
        id: item.id,
        label: nameOf(item),
        problems: [
          ...(issues.unknownType ? ['unknown furniture type'] : []),
          ...(issues.missingLevel ? [`level "${item.levelId}" no longer exists`] : []),
          ...(issues.missingRoom && !issues.missingLevel
            ? [`room "${item.roomId}" no longer exists`]
            : []),
        ],
        canRelocate: issues.missingLevel,
      },
    ];
  });

  // While walking, furniture is scenery: no selecting or dragging.
  const idle: FurnitureHandlers = {
    onSelect: () => {},
    onMoveStart: () => {},
    onRotateStart: () => {},
    onMove: () => {},
    onRotate: () => {},
    onDragEnd: () => {},
  };

  return (
    <>
      <Scene
        scene={shown}
        target={orbitTarget(scene, visibility)}
        furniture={furniture}
        handlers={walking ? idle : handlers}
        northBearing={northBearing}
        markers={markers}
        labels={labels}
        walk={walkView && { figure: walk.figureRef, view: walkView }}
      />
      {walkView ? (
        <WalkHud
          homeId={model.id}
          walk={walk}
          describe={describeFigure}
          view={walkView}
          onView={setWalkView}
          onExit={() => setWalkView(undefined)}
          compass={compass}
          api={photosApi}
        />
      ) : (
        <>
          <ControlPanel
            homes={homes}
            homeId={model.id}
            onSelectHome={onSelectHome}
            scene={scene}
            visibility={chosenVisibility}
            onChange={setVisibility}
            onWalk={() => setWalkView('first')}
          />
          <FurniturePanel
            layouts={layouts}
            levelName={level?.name ?? ''}
            rooms={plan?.rooms ?? []}
            roomId={roomId}
            onRoomChange={setRoomChoice}
            categories={registry.categories}
            onPlace={commands.place}
            selected={selected}
            canUndo={canUndo(editor)}
            canRedo={canRedo(editor)}
            onUndo={() => dispatch({ type: 'undo' })}
            onRedo={() => dispatch({ type: 'redo' })}
            onRotate={commands.rotate}
            onDuplicate={commands.duplicate}
            onDelete={commands.remove}
            settings={settings}
            onSettings={setSettings}
            flagged={flagged}
            onSelectItem={(id) => dispatch({ type: 'select', id })}
            onRelocate={commands.relocate}
          />
        </>
      )}
    </>
  );
}
