import {
  magneticDeclinationOf,
  northBearingOf,
  type HomeModel,
  type HomeSummary,
  type LayoutItem,
  type PhotoRequest,
} from '@my-home/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fetchHome, photosApi, saveHome } from './api';
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
import type { FurnitureToolbarProps } from './overlay/FurnitureToolbar';
import { Hints } from './overlay/Hints';
import { Sheet, sheetSize, type SheetSnap, type SheetTab } from './overlay/Sheet';
import { StageTools } from './overlay/StageTools';
import { TopBar } from './overlay/TopBar';
import { useKeyboardViewport } from './overlay/useKeyboardViewport';
import { useLayoutMode } from './overlay/useLayoutMode';
import { ViewPanel } from './overlay/ViewPanel';
import { filterPhotos, NO_FILTERS } from './photos/filters';
import { aspectOf, fovHOf, frustumCorners } from './photos/frustum';
import { PhotosPanel, type OverlaySettings, type PhotosTab } from './photos/PhotosPanel';
import { openRequests } from './photos/requests';
import { usePhotos } from './photos/usePhotos';
import type { FurnitureHandlers, FurnitureView } from './scene/FurnitureLayer';
import type { PhotoMarkerView, RequestGhostView, Viewpoint } from './scene/PhotoMarkers';
import { Scene } from './scene/Scene';
import { calibrationTargets } from './walk/calibration';
import type { Figure } from './walk/figure';
import { useWalk } from './walk/useWalk';
import { WalkHud, type DeclinationSource, type WalkView } from './walk/WalkHud';
import { loadWalkSession } from './walk/walkSession';
import { buildWalkWorld, placeAt, startPose, type FurnitureBlocker } from './walk/world';

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

/** The tabs of the phone's sheet. Photos and Requests are the two lists of the gallery. */
export type PanelId = 'view' | 'furniture' | 'photos' | 'requests';

const PANELS: PanelId[] = ['view', 'furniture', 'photos', 'requests'];
const SNAPS: SheetSnap[] = ['collapsed', 'half', 'full'];

/**
 * `?panel=view|furniture|photos|requests` opens the viewer with that panel showing, and
 * `?sheet=collapsed|half|full` sets how far the phone's sheet is open (half when a panel is named).
 */
function initialPanel(): { panel: PanelId | undefined; snap: SheetSnap } {
  const params = new URLSearchParams(window.location.search);
  const panel = PANELS.find((p) => p === params.get('panel'));
  const snap = SNAPS.find((s) => s === params.get('sheet'));
  return { panel, snap: snap ?? (panel ? 'half' : 'collapsed') };
}

/** How far in front of its camera a photo's view cone is drawn, in metres. */
const VIEW_CONE_LENGTH = 1.2;

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
  // A walk this tab was on before the page was reloaded comes back. It is newer than the address,
  // which a reload keeps: `?walk=first` must not put the figure back at the start.
  // It is for that one walk only: leaving walk mode forgets it (see `leaveWalk`).
  const [restored, setRestored] = useState(() => loadWalkSession(model.id));
  const [walkView, setWalkView] = useState<WalkView | undefined>(
    () => restored?.view ?? initialWalk(),
  );
  const leaveWalk = () => {
    setWalkView(undefined);
    setRestored(undefined);
  };
  /** A camera covers the view: the scene stops drawing meanwhile. */
  const [cameraOpen, setCameraOpen] = useState(false);
  const photos = usePhotos(model.id);
  const layout = useLayoutMode();
  const mobile = layout !== 'desktop';
  useKeyboardViewport(mobile);
  const resetView = useRef<(() => void) | undefined>(undefined);
  const [initial] = useState(initialPanel);
  const [photosOpen, setPhotosOpen] = useState(
    initial.panel === 'photos' || initial.panel === 'requests',
  );
  const [photosTab, setPhotosTab] = useState<PhotosTab>(
    initial.panel === 'requests' ? 'requests' : 'photos',
  );
  // The phone's sheet: which of the two other panels it shows while the photos are closed, and
  // how far it is open.
  const [plainPanel, setPlainPanel] = useState<'view' | 'furniture'>(
    initial.panel === 'furniture' ? 'furniture' : 'view',
  );
  const [snap, setSnap] = useState<SheetSnap>(initial.snap);
  const [photoFilters, setPhotoFilters] = useState(NO_FILTERS);
  const [photoId, setPhotoId] = useState<string>();
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const [overlay, setOverlay] = useState<OverlaySettings>({ on: false, opacity: 0.5 });
  const [chosenRequest, setChosenRequest] = useState<string>();
  const closePhotos = () => {
    setPhotosOpen(false);
    setViewingPhoto(false);
  };
  const panel: PanelId = photosOpen
    ? photosTab === 'requests'
      ? 'requests'
      : 'photos'
    : plainPanel;
  const showPanel = (id: PanelId) => {
    if (id === 'view' || id === 'furniture') {
      closePhotos();
      setPlainPanel(id);
    } else {
      setPhotosOpen(true);
      setPhotosTab(id);
    }
  };
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
    // Where the restored walk stood: where the shutter was tapped, if a photo was on its way.
    const back = restored && (restored.pending?.figure ?? restored.figure);
    if (back) return back;
    const pose = startPose(model, world) ?? { x: 0, z: 0, y: 0, yaw: 0 };
    return { ...pose, pitch: 0 };
    // Only where the figure first appears: it must not jump when furniture changes the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  const walking = walkView !== undefined;
  const walk = useWalk(world, start, walking);
  // Magnetic declination of the home: from the model, and editable while walking.
  const [declination, setDeclination] = useState(() => magneticDeclinationOf(model.building));
  const saveDeclination = async (degrees: number, source: DeclinationSource) => {
    // The home may have changed since this page loaded (an agent correcting walls, another tab),
    // and saving replaces the whole home: change the declination on what is stored now.
    const current = await fetchHome(model.id);
    const note =
      source === 'measured'
        ? 'Measured on site, entered in the app'
        : 'From a declination chart or model, entered in the app';
    const saved = await saveHome({
      ...current,
      building: { ...current.building, magneticDeclination: { value: degrees, source, note } },
    });
    setDeclination(magneticDeclinationOf(saved.building));
  };
  const targetsFor = (figure: Figure) => {
    const figurePlan = figure.levelId === undefined ? undefined : ctx.plans.get(figure.levelId);
    const room = figurePlan && roomAt(figurePlan, [figure.x, figure.z]);
    return calibrationTargets(model, figure.levelId, [figure.x, figure.z], room?.outline);
  };
  const figureLevel = scene.levels.find((l) => l.id === walk.levelId);
  const describeFigure = (figure: Figure) => {
    const on = scene.levels.find((l) => l.id === figure.levelId);
    const figurePlan = on && ctx.plans.get(on.id);
    const room = figurePlan && roomAt(figurePlan, [figure.x, figure.z]);
    return [room?.name, on?.name].filter(Boolean).join(' · ');
  };

  const roomIdOf = (figure: Figure) => {
    const figurePlan = figure.levelId === undefined ? undefined : ctx.plans.get(figure.levelId);
    return figurePlan && roomAt(figurePlan, [figure.x, figure.z])?.id;
  };

  // "View from here": the 3D camera sits at the selected photo's pose.
  const photo = photos.photos.find((p) => p.id === photoId);
  const viewed = !walking && viewingPhoto ? photo : undefined;
  // Keyed by what the camera needs, not by the photo object: a reload of the lists hands out new
  // objects for the same photo, and that must not restart the view.
  const viewKey =
    viewed && JSON.stringify({ pose: viewed.pose, fovH: fovHOf(viewed), aspect: aspectOf(viewed) });
  const viewpoint = useMemo(
    () => (viewKey === undefined ? undefined : (JSON.parse(viewKey) as Viewpoint)),
    [viewKey],
  );

  const visibility = useMemo(() => {
    if (walkView) return walkVisibility(scene, chosenVisibility, walkView, figureLevel?.id);
    // Looking from inside the building, like the figure in first person.
    if (viewed) return walkVisibility(scene, chosenVisibility, 'first', undefined);
    return chosenVisibility;
  }, [scene, chosenVisibility, walkView, figureLevel?.id, viewed]);
  const shown = useMemo(() => visibleScene(scene, visibility), [scene, visibility]);
  const labels = useMemo(() => roomLabels(scene, visibility), [scene, visibility]);

  // Camera markers: the photos the gallery shows, on the levels that are visible (and outdoors).
  const markersShown = !viewed && (walkView === 'third' || (!walking && photosOpen));
  const photoMarkers = useMemo((): PhotoMarkerView[] => {
    if (!markersShown) return [];
    const levels = new Set(shownLevels(scene, visibility).map((l) => l.id));
    return filterPhotos(photos.photos, photoFilters)
      .filter((p) => p.levelId === null || levels.has(p.levelId))
      .map((p) => ({
        id: p.id,
        position: [p.pose.position.x, p.pose.position.y, p.pose.position.z],
        corners: frustumCorners(p.pose, fovHOf(p), aspectOf(p), VIEW_CONE_LENGTH),
        selected: p.id === photoId,
        measured: p.sensors?.source === 'sensor',
      }));
  }, [markersShown, scene, visibility, photos.photos, photoFilters, photoId]);

  // Ghost figures: where the open photo requests ask the owner to stand.
  const requestSpot = (request: PhotoRequest) => {
    if (!request.position) return undefined;
    const on = scene.levels.find((l) => l.id === request.levelId);
    const point: [number, number] = [request.position.x, request.position.z];
    return placeAt(world, point, on?.elevation ?? 0);
  };
  const waiting = new Set(openRequests(photos.requests).map((r) => r.id));
  const requestGhosts = walking
    ? photos.requests.flatMap((request): RequestGhostView[] => {
        const spot = waiting.has(request.id) ? requestSpot(request) : undefined;
        return spot
          ? [
              {
                id: request.id,
                position: [spot.x, spot.y, spot.z],
                yaw: request.yaw,
                active: request.id === chosenRequest,
              },
            ]
          : [];
      })
    : [];

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

  // On a phone a long press on an item opens the furniture panel on it ("more").
  const showFurniture = () => {
    showPanel('furniture');
    if (snap === 'collapsed') setSnap('half');
  };
  const touchHandlers: FurnitureHandlers = {
    ...handlers,
    onLongPress(id) {
      // The press began a move: end it, so the panel opens on an item that stays where it is.
      dispatch({ type: 'dragCancel' });
      dispatch({ type: 'select', id });
      showFurniture();
    },
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

  const controls = {
    homes,
    homeId: model.id,
    onSelectHome,
    scene,
    visibility: chosenVisibility,
    onChange: setVisibility,
    onWalk: () => setWalkView('first'),
    photoCount: photos.photos.length,
    openRequests: openRequests(photos.requests).length,
  };
  const photosPanel = (
    <PhotosPanel
      photos={photos}
      levels={scene.levels}
      tab={photosTab}
      onTab={setPhotosTab}
      selectedId={photoId}
      onSelect={setPhotoId}
      filters={photoFilters}
      onFilters={setPhotoFilters}
      viewing={viewed !== undefined}
      onViewFromHere={setViewingPhoto}
      overlay={overlay}
      onOverlay={setOverlay}
      onClose={closePhotos}
      compact={mobile}
    />
  );
  const furniturePanel = (
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
  );
  const tabs: SheetTab<PanelId>[] = [
    { id: 'view', label: 'View', icon: '👁' },
    { id: 'furniture', label: 'Furniture', icon: '🛋' },
    { id: 'photos', label: 'Photos', icon: '📷' },
    { id: 'requests', label: 'Requests', icon: '📌', badge: controls.openRequests },
  ];
  // The tools of the selected item float next to it on a phone, so they need no panel.
  const toolbar: FurnitureToolbarProps | undefined =
    mobile && !walking && selectedItem
      ? {
          name: nameOf(selectedItem),
          onRotate: commands.rotate,
          onDuplicate: commands.duplicate,
          onDelete: commands.remove,
          onMore: showFurniture,
        }
      : undefined;
  const side = layout === 'landscape';
  const sheetShown = mobile && !walking;
  // The 3D view ends where the sheet begins. A sheet opened all the way lies over the view
  // instead, so the canvas is not squeezed to nothing.
  const sheetVars = sheetShown && {
    '--sheet-size': sheetSize(snap, side),
    '--stage-inset': sheetSize(snap === 'full' ? 'half' : snap, side),
  };

  return (
    <div
      className={['viewer', mobile && `mobile ${layout}`, walking && 'walking']
        .filter(Boolean)
        .join(' ')}
      style={sheetVars ? (sheetVars as CSSProperties) : undefined}
    >
      {sheetShown && (
        <TopBar
          {...controls}
          photosOpen={panel === 'photos' && snap !== 'collapsed'}
          onPhotos={() => {
            if (panel === 'photos' && snap !== 'collapsed') return setSnap('collapsed');
            showPanel('photos');
            if (snap === 'collapsed') setSnap('half');
          }}
        />
      )}
      <div className="viewer-main">
        <div className="stage">
          <Scene
            scene={shown}
            target={orbitTarget(scene, visibility)}
            furniture={furniture}
            handlers={walking ? idle : mobile ? touchHandlers : handlers}
            touch={mobile}
            toolbar={toolbar}
            resetViewRef={resetView}
            northBearing={northBearing}
            markers={markers}
            labels={labels}
            walk={walkView && { figure: walk.figureRef, view: walkView }}
            photoMarkers={photoMarkers}
            onSelectPhoto={(id) => {
              setPhotoId(id);
              setPhotosTab('photos');
              setPhotosOpen(true);
              if (snap === 'collapsed') setSnap('half');
              if (walking) leaveWalk();
            }}
            requestGhosts={requestGhosts}
            viewpoint={viewpoint}
            paused={walking && cameraOpen}
          />
          {viewed && overlay.on && (
            <img
              className="photo-overlay"
              src={photosApi.imageUrl(viewed.id)}
              alt=""
              style={{ opacity: overlay.opacity }}
            />
          )}
          {sheetShown && (
            <>
              <StageTools
                status={{
                  loading: layouts.loading,
                  save: layouts.saveState.status,
                  edited: editor.revision > 0,
                  photosError: photos.error,
                }}
                onResetView={viewed ? undefined : () => resetView.current?.()}
              />
              <Hints side={side} />
            </>
          )}
          {walkView && (
            <WalkHud
              homeId={model.id}
              walk={walk}
              describe={describeFigure}
              view={walkView}
              onView={setWalkView}
              onExit={leaveWalk}
              northBearing={northBearing}
              declination={declination}
              onDeclination={saveDeclination}
              calibrationTargets={targetsFor}
              api={photosApi}
              requests={photos.requests}
              roomIdOf={roomIdOf}
              onGoTo={(request) => {
                const spot = requestSpot(request);
                const { yaw, pitch } = walk.figureRef.current;
                if (spot)
                  walk.place({ ...spot, yaw: request.yaw ?? yaw, pitch: request.pitch ?? pitch });
              }}
              onChoose={setChosenRequest}
              onSaved={() => void photos.reload()}
              onCamera={setCameraOpen}
              restored={
                restored && {
                  heading: restored.heading,
                  tilt: restored.tilt,
                  draft: restored.draft,
                  lostPhoto: restored.pending !== undefined,
                }
              }
            />
          )}
        </div>
        {!walking &&
          (mobile ? (
            <Sheet
              tabs={tabs}
              active={panel}
              onTab={showPanel}
              snap={snap}
              onSnap={setSnap}
              side={side}
            >
              {panel === 'view' ? (
                <ViewPanel scene={scene} visibility={chosenVisibility} onChange={setVisibility} />
              ) : panel === 'furniture' ? (
                furniturePanel
              ) : (
                photosPanel
              )}
            </Sheet>
          ) : (
            <>
              <ControlPanel
                {...controls}
                photosOpen={photosOpen}
                onPhotos={() => (photosOpen ? closePhotos() : setPhotosOpen(true))}
              />
              {photosOpen ? photosPanel : furniturePanel}
            </>
          ))}
      </div>
    </div>
  );
}
