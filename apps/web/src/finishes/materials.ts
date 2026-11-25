import { deviceHasMap, finishes, type DeviceClass } from '@my-home/shared';
import {
  DataTexture,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type ColorSpace,
  type Texture,
} from 'three';
import type { DrawMaterial } from '../builder/drawList';
import type { Glow } from '../scene/batches';
import { SECTION_PLANES } from '../views/planes';
import { FinishTextures, type TextureEvent } from './textures';

/**
 * The materials of finishes (docs/design/realistic-render.md §4.5, §5). One material per finish
 * (and per way of drawing it: double-sided, translucent), shared by every batch of that finish:
 * tints are in the vertices.
 *
 * A textured finish's material holds a texture in every map slot from the start: a 1 x 1
 * placeholder until the file arrives. The arrival swaps the texture and nothing a shader program
 * depends on, so it compiles nothing. The slots are the same for every textured finish of a
 * device (colour, normal, and roughness on a desktop), whether its set has that map or not:
 * a relief-only finish keeps the white placeholder as its colour. So all textured finishes share
 * their programs, and all plain finishes theirs.
 */

function pixel(rgba: [number, number, number, number], colorSpace: ColorSpace): Texture {
  const texture = new DataTexture(new Uint8Array(rgba), 1, 1);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** What a map slot holds until its file arrives: no colour of its own, no relief, full roughness. */
export const PLACEHOLDERS = {
  color: pixel([255, 255, 255, 255], SRGBColorSpace),
  normal: pixel([128, 128, 255, 255], NoColorSpace),
  roughness: pixel([255, 255, 255, 255], NoColorSpace),
} as const;

/** How a material is drawn beyond its finish; the finish gives the roughness and metalness. */
const drawKey = (m: DrawMaterial | undefined) =>
  [
    m?.transparent ? 't' : 'o',
    m?.depthWrite === false ? 'n' : 'w',
    m?.doubleSided ? '2' : '1',
  ].join('/');

const SLOT = { color: 'map', normal: 'normalMap', roughness: 'roughnessMap' } as const;

export class FinishMaterials {
  private readonly materials = new Map<string, MeshStandardMaterial[]>();
  private readonly byKey = new Map<string, MeshStandardMaterial>();

  constructor(readonly textures: FinishTextures) {
    textures.subscribe((event) => this.arrived(event));
  }

  get device(): DeviceClass {
    return this.textures.device;
  }

  /** A file arrived: every material of its finish draws with it from the next frame on. */
  private arrived({ finish, map, texture }: TextureEvent) {
    if (!texture) return;
    // The slot was filled when the material was made: this changes no shader program.
    for (const material of this.materials.get(finish) ?? []) material[SLOT[map]] = texture;
  }

  /**
   * The material of a batch of `finishId`. An unknown finish draws as a plain white one. A piece
   * that glows (selected, colliding) gets a copy with the glow as its emissive colour: a uniform,
   * so the copy compiles nothing, and it gets the finish's textures like the others.
   */
  material(finishId: string, m?: DrawMaterial, glow?: Glow): MeshStandardMaterial {
    const key = `${finishId}|${drawKey(m)}|${glow ? `${glow.color}/${glow.intensity}` : ''}`;
    const found = this.byKey.get(key);
    if (found) return found;
    const finish = finishes.get(finishId);
    const maps = this.textures.maps(finishId);
    const material = new MeshStandardMaterial({
      vertexColors: true,
      transparent: m?.transparent ?? false,
      depthWrite: m?.depthWrite ?? true,
      side: m?.doubleSided ? DoubleSide : FrontSide,
      roughness: finish?.roughness ?? 1,
      metalness: finish?.metalness ?? 0,
      ...(glow && { emissive: glow.color, emissiveIntensity: glow.intensity }),
      // A section cuts every surface of the home, and its shadow with it (§7.2).
      clippingPlanes: SECTION_PLANES,
      clipShadows: true,
      ...(finish?.texture && {
        map: maps.color ?? PLACEHOLDERS.color,
        normalMap: maps.normal ?? PLACEHOLDERS.normal,
        ...(deviceHasMap(this.device, 'roughness') && {
          roughnessMap: maps.roughness ?? PLACEHOLDERS.roughness,
        }),
      }),
    });
    material.name = finishId;
    this.byKey.set(key, material);
    this.materials.set(finishId, [...(this.materials.get(finishId) ?? []), material]);
    return material;
  }

  /** Frees the materials and the textures: this device class is no longer drawn. */
  dispose() {
    for (const material of this.byKey.values()) material.dispose();
    this.byKey.clear();
    this.materials.clear();
    this.textures.dispose();
  }
}

const byDevice = new Map<DeviceClass, FinishMaterials>();

/** The materials and textures of a device class: one set for the visit. */
export function finishMaterials(device: DeviceClass): FinishMaterials {
  let found = byDevice.get(device);
  if (!found) {
    found = new FinishMaterials(new FinishTextures(device));
    byDevice.set(device, found);
  }
  return found;
}

/**
 * Frees what the other device class holds. The class follows the layout, which can change in a
 * visit (a window made narrow): without this both sizes of every texture would stay in memory,
 * which is what one size per device is there to prevent (§5.3).
 */
export function releaseOtherDevices(device: DeviceClass) {
  for (const [other, set] of byDevice) {
    if (other === device) continue;
    set.dispose();
    byDevice.delete(other);
  }
}
