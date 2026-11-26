import { HomeModel, HomeSeed } from '@my-home/shared';
import { DirectionalLight, Mesh, PointLight, Texture, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import homeJson from '../../../../data/homes/home.json';
import seedJson from '../../../../data/homes/home.seed.json';
import { buildHome } from '../builder/buildHome';
import type { Visibility } from '../builder/visibility';
import { furniture } from '../catalog/furniture';
import { createContext, defaultSettings } from '../editor/operations';
import { FinishMaterials } from '../finishes/materials';
import { FinishTextures } from '../finishes/textures';
import { furnitureViews } from '../scene/furnitureViews';
import { CAP_FINISH } from '../views/caps';
import { viewFrame } from '../views/named';
import { gateViews, viewInputs, type GateInputs } from './gate';
import {
  buildTraceScene,
  frameCamera,
  traceFinishes,
  traceMeshes,
  whenTexturesArrived,
} from './traceScene';

/** "Our home" with its seed, as the measuring page gets it. */
const model = HomeModel.parse(structuredClone(homeJson));
const seed = HomeSeed.parse(structuredClone(seedJson));
const scene = buildHome(model);
const ctx = createContext(model, furniture, defaultSettings);
const items = seed.placements.map((p) => ({
  id: p.id,
  typeId: p.typeId,
  name: p.name,
  levelId: p.levelId,
  position: p.position,
  rotationY: p.rotationY,
  ...(p.mounting !== undefined && p.mounting !== 'floor' && { mounting: p.mounting }),
  ...(p.elevation !== undefined && p.elevation !== 0 && { elevation: p.elevation }),
  params: { ...p.params },
}));
/** Textures that arrive at once, without a file. */
const materials = () =>
  new FinishMaterials(
    new FinishTextures(
      'desktop',
      () => Promise.resolve(new Texture()),
      (path) => path,
    ),
  );
const inputs = (): GateInputs => ({
  scene,
  furnitureFor: (v: Visibility) => furnitureViews(ctx, items, scene, v),
  planColours: false,
  materials: materials(),
});
const views = gateViews(scene);
const named = (kind: string) => views.find((v) => v.kind === kind)!;

describe('the scene render mode traces', () => {
  it('measures the three fixed views', () => {
    expect(views.map((v) => v.kind)).toEqual(['cutaway', 'section', 'eye']);
  });

  it("is the viewer's batches of what the view shows, and the ground", () => {
    const cutaway = traceMeshes(viewInputs(inputs(), named('cutaway')));
    const whole = traceMeshes(viewInputs(inputs(), named('eye')));
    // The cutaway hides the upper levels and the roof: fewer meshes than the whole house.
    expect(cutaway.length).toBeGreaterThan(50);
    expect(whole.length).toBeGreaterThan(cutaway.length);
    expect(cutaway.some((m) => m.key.startsWith('roof'))).toBe(false);
    expect(whole.some((m) => m.key.startsWith('roof'))).toBe(true);
    expect(cutaway.filter((m) => m.key === 'ground')).toHaveLength(1);
    expect(cutaway.some((m) => m.key.startsWith('cap:'))).toBe(false);
    for (const mesh of cutaway) {
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('cuts a section for real: nothing is left in front of the plane, and the cut is capped', () => {
    const traced = viewInputs(inputs(), named('section'));
    const { normal, constant } = traced.plane!;
    const meshes = traceMeshes(traced);
    const uncut = traceMeshes({ ...traced, plane: undefined });
    const triangles = (list: typeof meshes) =>
      list.reduce((n, m) => n + m.geometry.index!.count / 3, 0);
    expect(triangles(meshes)).toBeLessThan(triangles(uncut));
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position');
      // A cap lies a millimetre in front of the plane, to lie over the soil's.
      const allowed = mesh.key.startsWith('cap:') ? -0.0011 : -1e-4;
      for (let i = 0; i < position.count; i++) {
        const d =
          normal[0] * position.getX(i) +
          normal[1] * position.getY(i) +
          normal[2] * position.getZ(i) +
          constant;
        expect(d).toBeGreaterThan(allowed);
      }
    }
    const caps = meshes.filter((m) => m.key.startsWith('cap:'));
    expect(caps.map((m) => m.finish).sort()).toEqual([CAP_FINISH.dark, CAP_FINISH.soil].sort());
    // Walls, slabs and the roof of a house cut through its middle: tens of square metres.
    const dark = caps.find((m) => m.finish === CAP_FINISH.dark)!;
    expect(dark.geometry.index!.count / 3).toBeGreaterThan(50);
  });

  it('waits for the textures of its finishes', async () => {
    const set = materials();
    const used = traceFinishes(traceMeshes(viewInputs(inputs(), named('eye'))));
    expect(used).toContain('wood.oak-laminate');
    expect(used).not.toContain('part');
    await whenTexturesArrived(set, used);
    expect(set.textures.pending).toBe(0);
    expect(set.textures.maps('wood.oak-laminate').color).toBeDefined();
    // Asked again, with everything there: at once.
    await whenTexturesArrived(set, used);
  });

  it('is lit by the rig: the sun, every lamp that is drawn, the studio', () => {
    const traced = viewInputs(inputs(), named('eye'));
    const built = buildTraceScene(traced);
    const suns = built.scene.children.filter((c) => c instanceof DirectionalLight);
    const lamps = built.scene.children.filter((c) => c instanceof PointLight);
    expect(suns).toHaveLength(1);
    expect((suns[0] as DirectionalLight).intensity).toBe(traced.rig.sun.intensity);
    expect(lamps.length).toBeGreaterThan(0);
    expect(built.lamps).toBe(lamps.length);
    for (const lamp of lamps as PointLight[]) {
      expect(lamp.decay).toBe(2);
      expect(lamp.distance).toBeGreaterThan(0);
      expect(lamp.intensity).toBeCloseTo(65 * traced.rig.lamps.intensity, 6);
    }
    // The studio's intensity is the rig's own, not lowered under the ceiling.
    expect(built.scene.environment).toBeDefined();
    expect(built.scene.environmentIntensity).toBe(traced.rig.environment);
    expect(built.scene.background).toBeNull();
    expect(built.backdrop).toContain('linear-gradient');
    expect(built.meshes).toBe(built.scene.children.filter((c) => c instanceof Mesh).length);
    expect(built.triangles).toBeGreaterThan(20000);
    built.dispose();
  });

  it("draws with copies of the viewer's materials, a shadow flag on each", () => {
    const traced = viewInputs(inputs(), named('cutaway'));
    const built = buildTraceScene(traced);
    const meshes = built.scene.children.filter((c): c is Mesh => c instanceof Mesh);
    const used = new Set(meshes.map((m) => m.material as MeshStandardMaterial));
    // A handful of materials for a few hundred meshes.
    expect(used.size).toBeLessThan(60);
    const viewers = traced.materials.material('paint.plain');
    for (const material of used) {
      expect(material).not.toBe(viewers);
      expect(material.vertexColors).toBe(true);
      expect(material.clippingPlanes).toBeNull();
      expect(typeof material.castShadow).toBe('boolean');
    }
    expect(built.backdrop).toBe('#ffffff');
    built.dispose();
  });

  it('stands the camera where the viewer stands it', () => {
    const cutaway = frameCamera(viewFrame(scene, named('cutaway')), 16 / 9);
    expect(cutaway.fov).toBe(20);
    expect(cutaway.aspect).toBeCloseTo(16 / 9, 6);
    // South-east and above: +x is east, +z is south.
    expect(cutaway.position.x).toBeGreaterThan(0);
    expect(cutaway.position.y).toBeGreaterThan(10);
    const eye = frameCamera(viewFrame(scene, named('eye')), 16 / 9);
    expect(eye.fov).toBe(70);
    const frame = viewFrame(scene, named('eye'));
    expect(
      eye.position.distanceTo({
        x: frame.center[0],
        y: frame.center[1],
        z: frame.center[2],
      } as never),
    ).toBeCloseTo(0.1, 5);
  });
});
