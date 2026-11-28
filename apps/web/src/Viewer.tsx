import {
  catalog,
  effectiveParams,
  magneticDeclinationOf,
  mountingsFor,
  northBearingOf,
  type HomeModel,
  type PlacementMounting,
  type HomeSummary,
  type PhotoPose,
  type PhotoRequest,
} from '@my-home/shared';
import { SkNotice } from './hud/SkToast';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { homeSettingsApi, photosApi } from './api';
import {
  buildHome,
  groundAt,
  type HomeScene,
  type LevelInfo,
  type RoomFloorDescriptor,
  type Vec2,
  type Vec3,
} from './builder/buildHome';
import { furniture as furnitureTypes, UNKNOWN_SIZE } from './catalog/furniture';
import { compassMarkers } from './compass/compass';
import {
  defaultVisibility,
  roofIndex,
  roomLabels,
  visibleScene,
  type Visibility,
} from './builder/visibility';
import { groupShown, scenePieceDraws } from './builder/drawList';
import { canRedo, canUndo } from './editor/editorState';
import { elevationOfItem, mountingOfItem, type EditorItem } from './editor/item';
import {
  collisions,
  createContext,
  createItem,
  defaultSettings,
  duplicateItem,
  hasIssues,
  issuesOf,
  mountHeightOf,
  moveItem,
  positionOf,
  relocateItem,
  rotateItem,
  setElevation,
  setMounting,
  setRotation,
  typeOf,
  worldFootprint,
  type EditorSettings,
} from './editor/operations';
import { roomAt } from './editor/placement';
import { actionFor, chordOf, keptByTarget, type ActionId } from './keys/actions';
import { rotationFromDrag } from './editor/snapping';
import { EditBadge } from './editMode/EditToggle';
import { useEditMode } from './editMode/editMode';
import { HudCorners, type Surface } from './overlay/HudCorners';
import { SelectionLabel } from './overlay/SelectionLabel';
import { SkIconButton } from './hud/SkIconButton';
import { Minimap } from './walk/Minimap';
import { openingSides, roomFloorAt, roomFocus } from './placements/rooms';
import {
  FurniturePanel,
  type FlaggedItem,
  type PieceInfo,
  type RoomInfo,
  type SelectedInfo,
} from './overlay/FurniturePanel';
import { PieceToolbar, type FurnitureToolbarProps } from './overlay/FurnitureToolbar';
import { Hints } from './overlay/Hints';
import { Sheet, sheetSize, type SheetSnap, type SheetTab } from './overlay/Sheet';
import { StageTools } from './overlay/StageTools';
import { ToolsMenu } from './overlay/ToolsMenu';
import { TopBar } from './overlay/TopBar';
import { useKeyboardViewport } from './overlay/useKeyboardViewport';
import { useLayoutMode } from './overlay/useLayoutMode';
import { ViewPanel } from './overlay/ViewPanel';
import { backdropRequested, rigFor, type Backdrop } from './lighting/rig';
import { filterPhotos, NO_FILTERS } from './photos/filters';
import { usePlanColours } from './quality/planColours';
import { useQuality } from './quality/setting';
import {
  focusVisibility,
  frameFor,
  piecePageHref,
  scenePieces,
  type FrameRequest,
} from './placements/focus';
import { useOpeningOverrides } from './placements/useOpeningOverrides';
import { usePlacements, useVisibleAgain } from './placements/usePlacements';
import { aspectOf, fovHOf, frustumCorners } from './photos/frustum';
import { PhotosPanel, type OverlaySettings, type PhotosTab } from './photos/PhotosPanel';
import { openRequests } from './photos/requests';
import { usePhotos } from './photos/usePhotos';
import type { FurnitureHandlers } from './scene/FurnitureLayer';
import { furnitureViews } from './scene/furnitureViews';
import type { PhotoMarkerView, RequestGhostView, Viewpoint } from './scene/PhotoMarkers';
import { Scene } from './scene/Scene';
import type { SaveImage, ViewCamera } from './views/ImageExport';
import type { NamedView } from './views/named';
import { calibrationTargets } from './walk/calibration';
import type { Figure } from './walk/figure';
import { useWalk } from './walk/useWalk';
import { saveHomeDeclination } from './walk/declination';
import { WalkHud, type DeclinationSource, type WalkView } from './walk/WalkHud';
import { loadWalkSession } from './walk/walkSession';
import { groundLevelId, minimapLevels } from './walk/minimap';
import { buildWalkWorld, placeAt, standAt, startPose, type FurnitureBlocker } from './walk/world';
import { loadingProgress } from './loading/loading';

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

/** `?focus=<useId>`: the window, door, gate or piece of furniture to frame and select. */
function initialFocus(): string | undefined {
  return new URLSearchParams(window.location.search).get('focus') ?? undefined;
}

const catalogTypeName = (typeId: string) => catalog.get(typeId)?.name ?? typeId;

/** The keys of an item's parameters that its type ignores (unknown, invalid or design-only). */
const ignoredParams = (item: EditorItem) => {
  const type = catalog.get(item.typeId);
  return type ? effectiveParams(type, item.params).ignored : [];
};

/** The lazy chunk of the named views (`views/render-views.ts`). */
type Views = typeof import('./views/render-views');
const NONE: never[] = [];

/** How long a focused or clicked window, door or gate glows. */
const HIGHLIGHT_MS = 2000;
const TOAST_MS = 4000;

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

/** Temporary ids of new items, until the server assigns the stable one. */
const newId = () => `new-${crypto.randomUUID()}`;

interface Props {
  model: HomeModel;
  homes: HomeSummary[];
  onSelectHome(id: string): void;
}

/** Renders one home and its furniture; mount with `key={model.id}` so switching homes resets. */
export function Viewer({ model, homes, onSelectHome }: Props) {
  // Edits by agents or other tabs show up when the tab is visible again.
  const visibleAgain = useVisibleAgain();
  const overrides = useOpeningOverrides(model.id, visibleAgain);
  const scene = useMemo(() => buildHome(model, overrides), [model, overrides]);
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
  // Named views (§7.1), from their lazy chunk. `view` is the one whose look the scene has: `on`
  // while the camera is still where the view put it (the address names it), and `before` what
  // was shown before the first one, for "Reset view".
  const [views, setViews] = useState<Views>();
  const [view, setView] = useState<{ view: NamedView; on: boolean; before: Visibility }>();
  const [viewAsked, setViewAsked] = useState(
    () => new URLSearchParams(window.location.search).get('view') !== null,
  );
  const saveImage = useRef<SaveImage | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // Render mode (§9): on from "Render" until "Close"; its still is what "Save image" saves then.
  const [rendering, setRendering] = useState(false);
  const viewCamera = useRef<ViewCamera | undefined>(undefined);
  const saveRender = useRef<SaveImage | undefined>(undefined);
  const [chosenBackdrop, setBackdrop] = useState<Backdrop | undefined>(() =>
    backdropRequested(window.location.search),
  );
  useEffect(() => {
    let wanted = true;
    import('./views/render-views')
      .then(
        (chunk) => wanted && setViews(chunk),
        // Without the chunk the viewer has no named views, and is whole otherwise.
        () => wanted && setViewAsked(false),
      )
      .finally(() => loadingProgress('views'));
    return () => {
      wanted = false;
    };
  }, []);
  /** A camera covers the view: the scene stops drawing meanwhile. */
  const [cameraOpen, setCameraOpen] = useState(false);
  const photos = usePhotos(model.id);
  const layout = useLayoutMode();
  const mobile = layout !== 'desktop';
  const [quality, setQuality] = useQuality(mobile);
  const [planColours, setPlanColours] = usePlanColours();
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
  // The desktop's one open surface (HUD v2 #200): none at rest; the photos are `photosOpen`.
  const [surface, setSurface] = useState<Surface | undefined>(
    initial.panel === 'view' ? 'views' : initial.panel === 'furniture' ? 'furniture' : undefined,
  );
  // The phone's Tools menu, over the stage tools.
  const [phoneTools, setPhoneTools] = useState(false);
  // `?` asked for the keys: Tools opens with the help unfolded (#204).
  const [helpAsked, setHelpAsked] = useState(0);
  // The phone's floor overview (HUD v2 #202); the desktop's is the surface `map`.
  const [phoneMap, setPhoneMap] = useState(false);
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

  const placements = usePlacements(model.id, visibleAgain);
  const { editor, dispatch } = placements;
  // View mode by default: furniture is changed only in edit mode (editMode/editMode.ts).
  const [editing] = useEditMode();
  useEffect(() => {
    // Leaving edit mode ends a drag in progress and puts the item back.
    if (!editing) dispatch({ type: 'dragCancel' });
  }, [editing, dispatch]);
  const [settings, setSettings] = useState<EditorSettings>(defaultSettings);
  const ctx = useMemo(() => createContext(model, furnitureTypes, settings), [model, settings]);

  const { items } = editor;

  // The figure: blocked by walls, fences and the furniture standing on the floor. Pieces on a
  // wall or under the ceiling (wall cabinets, lights) never block it: it walks under them, as under
  // an open piece (a pergola) and over a stepping stone. Outdoor pieces stand on the ground.
  const world = useMemo(() => {
    const blockers = items.flatMap((item): FurnitureBlocker[] => {
      const type = typeOf(ctx, item);
      const level = ctx.plans.get(item.levelId);
      if (!level || mountingOfItem(item) !== 'floor' || type?.open) return [];
      const ground = type?.outdoor
        ? groundAt(scene.terrain, [item.position.x, item.position.z], level.elevation) -
          level.elevation
        : 0;
      return [
        {
          levelId: item.levelId,
          polygon: worldFootprint(ctx, item),
          height: (type?.size ?? UNKNOWN_SIZE).height,
          bottom: ground + elevationOfItem(item),
        },
      ];
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
  const saveDeclination = async (degrees: number, source: DeclinationSource) =>
    setDeclination(await saveHomeDeclination(homeSettingsApi, model.id, degrees, source));
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
  const viewedPhoto = !walking && viewingPhoto ? photo : undefined;
  // A pose being corrected in the gallery moves the camera (and so the overlay) before it is saved.
  const [draftPose, setDraftPose] = useState<PhotoPose>();
  const viewed = viewedPhoto && (draftPose ? { ...viewedPhoto, pose: draftPose } : viewedPhoto);
  // Keyed by what the camera needs, not by the photo object: a reload of the lists hands out new
  // objects for the same photo, and that must not restart the view.
  const viewKey =
    viewed && JSON.stringify({ pose: viewed.pose, fovH: fovHOf(viewed), aspect: aspectOf(viewed) });
  const viewpoint = useMemo(
    () => (viewKey === undefined ? undefined : (JSON.parse(viewKey) as Viewpoint)),
    [viewKey],
  );

  // Walking and "view from here" have their own camera and light: a named view waits.
  const presented = walkView || viewedPhoto ? undefined : view;
  const visibility = useMemo(() => {
    if (walkView) return walkVisibility(scene, chosenVisibility, walkView, figureLevel?.id);
    // Looking from inside the building, like the figure in first person.
    if (viewedPhoto) return walkVisibility(scene, chosenVisibility, 'first', undefined);
    return chosenVisibility;
  }, [scene, chosenVisibility, walkView, figureLevel?.id, viewedPhoto]);
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

  // The minimap's plans: built once per home, as the plan does not change while walking.
  const ground = useMemo(
    () => groundLevelId(scene, model.terrain.groundElevation.value),
    [scene, model],
  );
  const mapLevels = useMemo(() => minimapLevels(scene, ctx.plans, ground), [scene, ctx, ground]);
  const mapPhotos = useMemo(
    () =>
      walking
        ? photos.photos.map((p) => ({
            id: p.id,
            x: p.pose.position.x,
            z: p.pose.position.z,
            yaw: p.pose.yaw,
            levelId: p.levelId ?? undefined,
          }))
        : [],
    [walking, photos.photos],
  );
  const placeFromMap = (point: [number, number], levelId: string) => {
    const on = scene.levels.find((l) => l.id === levelId);
    const spot = standAt(world, point, on?.elevation ?? 0);
    if (!spot) return false;
    const { yaw, pitch } = walk.figureRef.current;
    walk.place({ ...spot, yaw, pitch });
    return true;
  };

  const level = currentLevel(scene, visibility);
  const plan = level && ctx.plans.get(level.id);
  const [roomChoice, setRoomChoice] = useState<string>();
  const roomId = plan?.rooms.some((r) => r.id === roomChoice) ? roomChoice : plan?.rooms[0]?.id;

  const found = useMemo(() => collisions(ctx, items), [ctx, items]);
  const selectedItem = items.find((i) => i.id === editor.selectedId);

  const furniture = useMemo(
    () => furnitureViews(ctx, items, scene, visibility, editor.selectedId, found),
    [ctx, items, found, scene, visibility, editor.selectedId],
  );

  const typeNameOf = (item: EditorItem) =>
    furnitureTypes.get(item.typeId)?.name ?? `Unknown type "${item.typeId}"`;
  /** The item's own name ("Bedroom · Bed"); a new one is named by the server once saved. */
  const nameOf = (item: EditorItem) => item.name || typeNameOf(item);

  // Windows, doors, roof windows and gates: picked with a tap or click, framed by `?focus=`.
  const pieces = useMemo(() => scenePieces(scene), [scene]);
  const pieceDraws = useMemo(() => new Map(scenePieceDraws(scene).map((p) => [p.id, p])), [scene]);
  const [selectedPieceId, setSelectedPieceId] = useState<string>();
  const [selectedRoomId, setSelectedRoomId] = useState<string>();
  const selectedPiece = selectedPieceId === undefined ? undefined : pieces.get(selectedPieceId);
  // On the desktop the furniture panel is Edit's surface and the selection's inspector (HUD v2 #201): it opens when
  // Edit starts; a selection shows its label, which opens it; outside Edit it closes when the selection ends (state
  // adjusted while rendering, when they change; V20).
  const selectionKey = `${editing}:${editor.selectedId ?? ''}:${selectedPieceId ?? ''}:${selectedRoomId ?? ''}`;
  // From nothing: Edit at load opens it too.
  const [seenSelection, setSeenSelection] = useState('false:::');
  if (selectionKey !== seenSelection) {
    const wasEditing = seenSelection.startsWith('true:');
    setSeenSelection(selectionKey);
    const any =
      editor.selectedId !== undefined ||
      selectedPieceId !== undefined ||
      selectedRoomId !== undefined;
    if (editing && !wasEditing) setSurface('furniture');
    else if (!editing && !any && surface === 'furniture') setSurface(undefined);
  }
  const [highlight, setHighlight] = useState<string>();
  useEffect(() => {
    if (highlight === undefined) return;
    const timer = window.setTimeout(() => setHighlight(undefined), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlight]);
  const [toast, setToast] = useState<string>();
  useEffect(() => {
    if (toast === undefined) return;
    const timer = window.setTimeout(() => setToast(undefined), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // A room, picked on its floor in view mode (HUD v2 #201); Edit has none.
  const selectedRoom = editing ? undefined : scene.roomFloors.find((r) => r.id === selectedRoomId);
  const selectRoomAt = (point: Vec3) => {
    const room = roomFloorAt(scene, visibility, point);
    setSelectedRoomId(room?.id);
    setSelectedPieceId(undefined);
    dispatch({ type: 'select' });
  };
  const selectPiece = (id: string | undefined) => {
    // A piece behind what was clicked says "none" (it is not frontmost): that leaves a room alone.
    if (id !== undefined) setSelectedRoomId(undefined);
    setSelectedPieceId(id);
    if (id !== undefined) {
      setHighlight(id);
      dispatch({ type: 'select' });
    }
  };
  const [frame, setFrame] = useState<FrameRequest & { key: number }>();

  // `?focus=<useId>` once the home (and for furniture, the placements) are there. Walking wins.
  // Applied while rendering, as soon as what it waits for has arrived.
  const [focusId, setFocusId] = useState(() => (walkView ? undefined : initialFocus()));
  if (focusId !== undefined) {
    const piece = pieces.get(focusId);
    const item = piece ? undefined : editor.items.find((i) => i.id === focusId);
    if (piece || item || !placements.loading) {
      setFocusId(undefined);
      const key = (frame?.key ?? 0) + 1;
      const level = item && scene.levels.find((l) => l.id === item.levelId);
      if (piece) {
        setVisibility((v) => focusVisibility(scene, v, piece));
        selectPiece(piece.id);
        // A link to a piece shows its details at once (V21).
        setSurface('furniture');
        setFrame({ ...frameFor(scene, piece), key });
      } else if (item && level) {
        const size = typeOf(ctx, item)?.size ?? UNKNOWN_SIZE;
        const apartmentId = ctx.plans
          .get(item.levelId)
          ?.rooms.find((r) => r.id === item.roomId)?.apartmentId;
        setVisibility((v) =>
          focusVisibility(scene, v, { levelId: level.id, ...(apartmentId && { apartmentId }) }),
        );
        setSelectedPieceId(undefined);
        dispatch({ type: 'select', id: item.id });
        setSurface('furniture');
        const center: Vec3 = [item.position.x, level.elevation + size.height / 2, item.position.z];
        const radius = Math.hypot(size.width, size.depth, size.height) / 2;
        setFrame({ ...frameFor(scene, { center, radius, exterior: false }), key });
      } else {
        setToast('Not found in this home');
      }
    }
  }

  /** Opens a named view: what it shows, its look, and (unless `camera` is false) its camera. */
  const openView = (next: NamedView, camera = true) => {
    if (!views) return;
    setView((now) => ({ view: next, on: true, before: now?.before ?? chosenVisibility }));
    setVisibility(views.viewVisibility(scene, next));
    const at = views.viewFrame(scene, next);
    // With `?focus=` the camera frames the use, with the view's field of view.
    setFrame((f) => ({ ...(camera || !f ? at : { ...f, fov: at.fov }), key: (f?.key ?? 0) + 1 }));
  };
  /** "Reset view": the free view, and what was shown before the named views. */
  const closeView = () => {
    if (view) setVisibility(view.before);
    setView(undefined);
    resetView.current?.();
  };
  /** The camera or what is shown was changed by hand: the address no longer names the view. */
  const leaveView = () => setView((now) => (now?.on ? { ...now, on: false } : now));
  // `?view=`, once its chunk is here. Walking wins: the view opens when the walk is left.
  if (viewAsked && views && !walking) {
    setViewAsked(false);
    const asked = views.parseView(window.location.search, scene);
    if (asked) openView(asked, focusId !== undefined || initialFocus() === undefined);
  }
  // Back from a walk or from a photo's pose, which moved the camera: the view takes it again.
  const [waited, setWaited] = useState(false);
  if (waited !== (view !== undefined && !presented)) {
    setWaited(!waited);
    if (waited && view?.on) openView(view.view);
  }
  const named = view?.on ? view.view : undefined;
  useEffect(() => {
    if (!viewAsked) views?.writeViewUrl(named);
  }, [views, named, viewAsked]);

  const edit = (label: string, next: EditorItem[], selectedId?: string | null) =>
    editing &&
    dispatch({ type: 'edit', label, items: next, ...(selectedId !== undefined && { selectedId }) });

  const commands = {
    place(typeId: string) {
      if (!editing || !level) return;
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
    /** Height of the selected item's bottom above the floor, in metres. */
    elevate(elevation: number) {
      if (!selectedItem) return;
      const raised = setElevation(ctx, selectedItem, elevation);
      edit(
        'Height',
        items.map((i) => (i.id === raised.id ? raised : i)),
      );
    },
    mount(mounting: PlacementMounting) {
      if (!selectedItem) return;
      const mounted = setMounting(ctx, items, selectedItem, mounting);
      edit(
        'Mounting',
        items.map((i) => (i.id === mounted.id ? mounted : i)),
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
    onSelect: (id) => {
      setSelectedPieceId(undefined);
      dispatch({ type: 'select', ...(id !== undefined && { id }) });
    },
    onMoveStart: (id) => {
      setSelectedPieceId(undefined);
      dispatch({ type: 'dragStart', id });
    },
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

  const selected: SelectedInfo | undefined = selectedItem && {
    name: nameOf(selectedItem),
    typeName: typeNameOf(selectedItem),
    href: piecePageHref(selectedItem.typeId, model.id, selectedItem.id),
    where: (() => {
      const p = ctx.plans.get(selectedItem.levelId);
      const room = p?.rooms.find((r) => r.id === selectedItem.roomId);
      return room ? `in ${room.name}` : p ? `on ${p.levelName}` : '';
    })(),
    mounting: mountingOfItem(selectedItem),
    mountings: (() => {
      const type = typeOf(ctx, selectedItem)?.type;
      return type ? mountingsFor(type) : [mountingOfItem(selectedItem)];
    })(),
    elevation: elevationOfItem(selectedItem),
    hangsAt: mountHeightOf(ctx, selectedItem),
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

  const selectedOpening = scene.openings.find((o) => o.id === selectedPiece?.id);
  const pieceInfo: PieceInfo | undefined = selectedPiece && {
    name: selectedPiece.name,
    typeName: catalogTypeName(selectedPiece.typeId),
    href: piecePageHref(selectedPiece.typeId, model.id, selectedPiece.id),
    // The spaces it links, where the model's rooms say so (#201).
    between: selectedOpening ? openingSides(scene, selectedOpening) : [],
  };
  const roomShown =
    selectedRoom !== undefined &&
    visibleScene(scene, visibility).roomFloors.some((r) => r.id === selectedRoom.id);
  const focusRoom = (room: RoomFloorDescriptor) => {
    setVisibility((v) =>
      focusVisibility(scene, v, {
        levelId: room.levelId,
        ...(room.apartmentId && { apartmentId: room.apartmentId }),
      }),
    );
    setFrame({
      ...frameFor(scene, { ...roomFocus(room), exterior: false }),
      key: (frame?.key ?? 0) + 1,
    });
  };
  const roomInfo: RoomInfo | undefined = selectedRoom && {
    name: selectedRoom.name,
    levelName: scene.levels.find((l) => l.id === selectedRoom.levelId)?.name ?? '',
    apartmentName: scene.apartments.find((a) => a.id === selectedRoom.apartmentId)?.name,
    onFocus: () => focusRoom(selectedRoom),
  };

  // What a phone shows of the selection in view mode: its name, type and piece page.
  const inspected =
    pieceInfo ??
    (roomShown && roomInfo
      ? { name: roomInfo.name, typeName: 'Room', href: undefined }
      : !editing && selected
        ? selected
        : undefined);
  // The desktop's edge label: the selection while it is drawn; hidden, label and outline go together (#201).
  const pieceDraw = selectedPieceId === undefined ? undefined : pieceDraws.get(selectedPieceId);
  const subjectShown = selectedPieceId
    ? !pieceDraw || groupShown(pieceDraw.group, scene, visibility)
    : selectedRoom
      ? roomShown
      : furniture.some((f) => f.id === editor.selectedId);
  const labelled = subjectShown ? (pieceInfo ?? roomInfo ?? selected) : undefined;

  // Needs attention, as where-used (`/uses`) says: an unknown type, a level or room gone, or
  // parameters that are ignored.
  const flagged: FlaggedItem[] = items.flatMap((item) => {
    const issues = issuesOf(ctx, item);
    const ignored = ignoredParams(item);
    if (!hasIssues(issues) && ignored.length === 0) return [];
    return [
      {
        id: item.id,
        label: nameOf(item),
        problems: [
          ...(issues.unknownType ? [`type "${item.typeId}" is not in the catalogue`] : []),
          ...(issues.missingLevel ? [`level "${item.levelId}" is not in the home model`] : []),
          ...(issues.missingRoom && !issues.missingLevel
            ? [`room "${item.roomId}" is not in the home model`]
            : []),
          ...(issues.offWall ? ['hangs on no wall (its wall is gone or moved)'] : []),
          ...(issues.aboveCeiling ? ['reaches above the ceiling'] : []),
          ...(ignored.length > 0 ? [`ignored: ${ignored.join(', ')}`] : []),
        ],
        canRelocate: editing && issues.missingLevel,
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
  // View mode: an item can be selected to inspect it, never dragged or rotated.
  const inspect: FurnitureHandlers = {
    ...idle,
    onSelect: (id) => {
      setSelectedRoomId(undefined);
      handlers.onSelect(id);
    },
  };

  const controls = {
    homes,
    homeId: model.id,
    onSelectHome,
    scene,
    visibility: chosenVisibility,
    onChange: (v: Visibility) => {
      setVisibility(v);
      leaveView();
    },
    onWalk: () => {
      setRendering(false);
      setWalkView('first');
    },
    photoCount: photos.photos.length,
    openRequests: openRequests(photos.requests).length,
  };
  // The desktop's open surface: the photos, or Views, Tools or the furniture panel (HUD v2 #200).
  const shown: Surface | 'photos' | undefined = photosOpen ? 'photos' : surface;
  const toggleSurface = (next: Surface) => {
    // Pressed again it closes; Tools pressed over the photos (opened from it) goes back to its menu.
    closePhotos();
    setSurface(shown === next ? undefined : next);
  };
  // The viewer's keys (HUD v2 #204, docs/design/hud-v2/hotkeys.md): one action list (keys/actions.ts), each action run
  // as its visible control runs it, a key consumed only by an action that is available. One listener for the viewer's
  // life calling the latest: an action's re-render must not take it off the window in the middle of the same event.
  const closeSurface = () => {
    const trigger = mobile
      ? phoneMap
        ? '.map-entry'
        : '.stage-tools .hud-tools'
      : shown === 'views'
        ? '.hud-views'
        : shown === 'map'
          ? '.map-entry'
          : shown === 'furniture'
            ? document.querySelector('.selection-label')
              ? '.selection-label'
              : '.hud-bottom-right .edit-toggle'
            : '.hud-tools';
    if (mobile) {
      setPhoneTools(false);
      setPhoneMap(false);
    } else {
      closePhotos();
      setSurface(undefined);
    }
    document.querySelector<HTMLElement>(trigger)?.focus();
  };
  const run = (id: ActionId): boolean => {
    const editingItem = editing && selectedItem !== undefined;
    switch (id) {
      case 'escape': {
        // One layer per press: an open surface, then a task (render mode has its own), then the selection, then Walk.
        const bigMap = document.querySelector<HTMLElement>(
          '.walk-map-large [aria-label="Close the map"]',
        );
        if (bigMap) return (bigMap.click(), true);
        if (mobile ? phoneTools || phoneMap : shown) return (closeSurface(), true);
        if (rendering) return false;
        if (
          editor.selectedId !== undefined ||
          selectedPieceId !== undefined ||
          selectedRoomId !== undefined
        ) {
          setSelectedPieceId(undefined);
          setSelectedRoomId(undefined);
          dispatch({ type: 'select' });
          return true;
        }
        if (walking) return (leaveWalk(), true);
        return false;
      }
      case 'help':
        setHelpAsked((n) => n + 1);
        if (mobile) setPhoneTools(true);
        else {
          closePhotos();
          setSurface('tools');
        }
        return true;
      case 'views':
        if (mobile) {
          showPanel('view');
          if (snap === 'collapsed') setSnap('half');
        } else toggleSurface('views');
        return true;
      case 'map': {
        if (walking) {
          const map = document.querySelector<HTMLElement>(
            '.walk-map-large [aria-label="Close the map"], .walk-map',
          );
          return map ? (map.click(), true) : false;
        }
        if (mobile) setPhoneMap((open) => !open);
        else toggleSurface('map');
        return true;
      }
      case 'north': {
        const compass = document.querySelector<HTMLElement>('.compass');
        return compass ? (compass.click(), true) : false;
      }
      case 'walk':
        controls.onWalk();
        return true;
      case 'rotate':
        return editingItem && (commands.rotate(1), true);
      case 'rotate-back':
        return editingItem && (commands.rotate(-1), true);
      case 'duplicate':
        return editingItem && (commands.duplicate(), true);
      case 'delete':
        return editingItem && (commands.remove(), true);
      case 'undo':
        return editing && canUndo(editor) && (dispatch({ type: 'undo' }), true);
      case 'redo':
        return editing && canRedo(editor) && (dispatch({ type: 'redo' }), true);
      default:
        return false;
    }
  };
  const onKey = useRef<(e: KeyboardEvent) => void>(undefined);
  useEffect(() => {
    onKey.current = (e) => {
      // A field, editable text, composition or a key the focused control took keep their keys.
      if (keptByTarget(e)) return;
      const chord = chordOf(e);
      const action = chord && actionFor(chord, walking ? 'walk' : editing ? 'edit' : 'orbit');
      if (action && run(action.id)) e.preventDefault();
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current?.(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  // Orbit's floor overview (HUD v2 #202): the level in view from above, north up; it never moves the walking figure.
  const overviewOpen = mobile ? phoneMap : shown === 'map';
  const closeOverview = () => {
    if (mobile) setPhoneMap(false);
    else setSurface(undefined);
    document.querySelector<HTMLElement>('.map-entry')?.focus();
  };
  const overviewMap = overviewOpen && level && mapLevels.has(level.id) && (
    <div className="orbit-map-slot">
      <Minimap
        overview={{ levelId: level.id, onClose: closeOverview }}
        levels={mapLevels}
        groundLevelId={ground}
        northBearing={northBearing}
        roomId={undefined}
        requests={[]}
        photos={mapPhotos}
      />
    </div>
  );
  // Loading and saving, for the phone's stage tools, the desktop's corner and Tools (#203).
  const stageStatus = {
    loading: placements.loading,
    save: placements.syncState.status,
    edited: editor.revision > 0,
    photosError: photos.error,
  };
  const toolsMenu = (
    <ToolsMenu
      {...controls}
      status={stageStatus}
      touch={mobile}
      helpAsked={helpAsked}
      className={mobile ? 'tools-popover' : undefined}
      // On a phone, the photos are open while the sheet shows them.
      photosOpen={mobile ? panel === 'photos' && snap !== 'collapsed' : photosOpen}
      onPhotos={() => {
        if (mobile) {
          setPhoneTools(false);
          if (panel === 'photos' && snap !== 'collapsed') return setSnap('collapsed');
          showPanel('photos');
          if (snap === 'collapsed') setSnap('half');
        } else if (photosOpen) closePhotos();
        else {
          setSurface(undefined);
          setPhotosOpen(true);
        }
      }}
    />
  );
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
      onDraftPose={setDraftPose}
      onClose={closePhotos}
      compact={mobile}
    />
  );
  const furniturePanel = (
    <FurniturePanel
      editing={editing}
      loading={placements.loading}
      error={placements.error}
      sync={placements.syncState}
      piece={pieceInfo}
      room={roomShown ? roomInfo : undefined}
      levelName={level?.name ?? ''}
      rooms={plan?.rooms ?? []}
      roomId={roomId}
      onRoomChange={setRoomChoice}
      categories={furnitureTypes.categories}
      onPlace={commands.place}
      selected={selected}
      canUndo={canUndo(editor)}
      canRedo={canRedo(editor)}
      onUndo={() => dispatch({ type: 'undo' })}
      onRedo={() => dispatch({ type: 'redo' })}
      onRotate={commands.rotate}
      onDuplicate={commands.duplicate}
      onDelete={commands.remove}
      onElevation={commands.elevate}
      onMounting={commands.mount}
      settings={settings}
      onSettings={setSettings}
      flagged={flagged}
      onSelectItem={(id) => dispatch({ type: 'select', id })}
      onRelocate={commands.relocate}
    />
  );
  const backdrop = chosenBackdrop ?? (presented ? views?.VIEW_BACKDROP : undefined);
  /** The backdrop on screen: the one chosen, or the rig's own. */
  const shownBackdrop = backdrop ?? rigFor({ kind: 'free' }).backdrop;
  const viewsControl = views && (
    <views.ViewsControl
      scene={scene}
      view={view?.view}
      onView={(next) => {
        const now = view?.view;
        if (!next) closeView();
        // The slider moves the cut and nothing else: the camera stays where it is.
        else if (now?.kind === 'section' && next.kind === 'section' && now.look === next.look)
          setView((v) => v && { ...v, view: next });
        else openView(next);
      }}
      backdrop={shownBackdrop}
      onBackdrop={setBackdrop}
      // A cutaway opens on the level being looked into; from a view of the whole house, the lowest.
      levelId={view && view.view.kind !== 'cutaway' ? undefined : level?.id}
      saving={saving}
      onSave={() => {
        const save = saveRender.current ?? saveImage.current;
        if (!save || saving) return;
        setSaving(true);
        save(presented?.view.kind ?? 'free')
          .catch(() => setToast('The image could not be saved'))
          .finally(() => setSaving(false));
      }}
      // Not on a phone, and not over a photo's view.
      onRender={mobile || viewed ? undefined : () => setRendering((on) => !on)}
      rendering={rendering}
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
    mobile && !walking && editing && selectedItem
      ? {
          name: nameOf(selectedItem),
          href: piecePageHref(selectedItem.typeId, model.id, selectedItem.id),
          onRotate: commands.rotate,
          // ▲ ▼ for pieces on a wall or raised (the microwave), so a bed's toolbar stays narrow.
          ...((mountingOfItem(selectedItem) === 'wall' || elevationOfItem(selectedItem) > 0) && {
            onRaise: (cm: number) => commands.elevate(elevationOfItem(selectedItem) + cm / 100),
          }),
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
      className={[
        'viewer',
        mobile && `mobile ${layout}`,
        walking && 'walking',
        editing && 'editing',
      ]
        .filter(Boolean)
        .join(' ')}
      style={sheetVars ? (sheetVars as CSSProperties) : undefined}
    >
      {sheetShown && (
        <TopBar
          scene={scene}
          visibility={chosenVisibility}
          onChange={controls.onChange}
          onWalk={controls.onWalk}
        />
      )}
      <div className="viewer-main">
        <div className="stage">
          <Scene
            scene={scene}
            visibility={visibility}
            target={orbitTarget(scene, visibility)}
            furniture={furniture}
            handlers={walking ? idle : !editing ? inspect : mobile ? touchHandlers : handlers}
            editable={editing}
            touch={mobile}
            toolbar={toolbar}
            resetViewRef={resetView}
            northBearing={northBearing}
            // A named view shows the model alone: no compass letters, no room names (§7.1).
            markers={markers}
            lettersHidden={named !== undefined}
            labels={named ? NONE : labels}
            rigView={presented && views?.viewRig(presented.view)}
            backdrop={backdrop}
            stage={
              views && (
                <>
                  <views.ImageExport actionRef={saveImage} cameraRef={viewCamera} />
                  {presented && (
                    <views.Stage
                      scene={scene}
                      view={presented.view}
                      backdrop={shownBackdrop}
                      visibility={visibility}
                      furniture={furniture}
                    />
                  )}
                </>
              )
            }
            onOrbit={leaveView}
            // While walking the view waits for the walk to end: nothing is still to come.
            busy={viewAsked && !walking}
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
            pieces={
              walking
                ? undefined
                : {
                    onSelectPiece: selectPiece,
                    highlightId: highlight,
                    ...(!editing && { onSelectRoom: selectRoomAt }),
                  }
            }
            roomOutline={roomShown ? selectedRoom : undefined}
            frame={frame}
            quality={quality}
            onNotice={setToast}
            planColours={planColours}
          />
          <SkNotice className="viewer-toast" message={toast} duration={TOAST_MS / 1000} />
          {views && (
            <views.RenderMode
              scene={scene}
              furnitureFor={(v) => furnitureViews(ctx, items, scene, v)}
              loading={placements.loading}
              planColours={planColours}
              phone={mobile}
              on={rendering && !walking && !viewed}
              visibility={visibility}
              furniture={furniture}
              view={presented?.view}
              backdrop={shownBackdrop}
              camera={viewCamera}
              saveRef={saveRender}
              onClose={() => setRendering(false)}
              onNotice={setToast}
            />
          )}
          {mobile && !walking && inspected && (
            <PieceToolbar
              name={inspected.name}
              typeName={inspected.typeName}
              href={inspected.href}
              onDetails={showFurniture}
              onClose={() => {
                setSelectedRoomId(undefined);
                if (selectedItem) dispatch({ type: 'select' });
                else setSelectedPieceId(undefined);
              }}
            />
          )}
          {!walking && <EditBadge />}
          {!walking && (
            <SkIconButton
              className="map-entry"
              size="compact"
              appearance="clear"
              backing
              icon="map"
              label="Floor overview"
              pressed={overviewOpen}
              onClick={() =>
                mobile ? (phoneMap ? closeOverview() : setPhoneMap(true)) : toggleSurface('map')
              }
            />
          )}
          {!walking && overviewMap}
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
                status={stageStatus}
                onResetView={viewed ? undefined : closeView}
                toolsOpen={phoneTools}
                onTools={() => setPhoneTools((open) => !open)}
                tools={toolsMenu}
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
              sensors={mobile}
              map={{
                levels: mapLevels,
                groundLevelId: ground,
                photos: mapPhotos,
                onPlace: placeFromMap,
              }}
              restored={
                restored && {
                  mode: restored.mode,
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
                <ViewPanel
                  scene={scene}
                  visibility={chosenVisibility}
                  onChange={controls.onChange}
                  views={viewsControl}
                  quality={quality}
                  onQuality={setQuality}
                  planColours={planColours}
                  onPlanColours={setPlanColours}
                />
              ) : panel === 'furniture' ? (
                furniturePanel
              ) : (
                photosPanel
              )}
            </Sheet>
          ) : (
            <>
              {labelled && (
                <SelectionLabel
                  name={labelled.name}
                  open={shown === 'furniture'}
                  onToggle={() => toggleSurface('furniture')}
                />
              )}
              <HudCorners
                scene={scene}
                visibility={chosenVisibility}
                onChange={controls.onChange}
                onWalk={controls.onWalk}
                surface={shown}
                onSurface={toggleSurface}
                status={stageStatus}
              />
              {/* The one open surface, at the right (§ Primary): each is a paper panel of its own. */}
              {shown && shown !== 'map' && (
                <div className="hud-surface">
                  {shown === 'photos' ? (
                    photosPanel
                  ) : shown === 'views' ? (
                    <ViewPanel
                      scene={scene}
                      visibility={chosenVisibility}
                      onChange={controls.onChange}
                      views={viewsControl}
                      quality={quality}
                      onQuality={setQuality}
                      planColours={planColours}
                      onPlanColours={setPlanColours}
                      phone={false}
                    />
                  ) : shown === 'tools' ? (
                    toolsMenu
                  ) : (
                    furniturePanel
                  )}
                </div>
              )}
            </>
          ))}
      </div>
    </div>
  );
}
