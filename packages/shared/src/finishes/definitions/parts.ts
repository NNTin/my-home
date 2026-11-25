import type { Finish } from '../types';

/** Finishes of catalogue parts: a part names one as `material.finish` (§5.7 of the design). */
export const parts: Finish[] = [
  {
    id: 'wood.veneer',
    name: 'Oak veneer',
    surfaces: ['part'],
    texture: { id: 'wood-veneer', maps: ['color', 'normal', 'roughness'] },
    tileSize: 1.83,
    tint: '#ffffff',
    tintable: true,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'fabric.weave',
    name: 'Woven fabric',
    surfaces: ['part'],
    // Relief only: the colour is the tint.
    texture: { id: 'fabric-weave', maps: ['normal'] },
    tileSize: 0.271,
    tint: '#d9d4c7',
    tintable: true,
    roughness: 1,
    metalness: 0,
  },
  {
    id: 'metal.brushed',
    name: 'Brushed metal',
    surfaces: ['part'],
    tint: '#b9bdc1',
    tintable: true,
    roughness: 0.4,
    metalness: 1,
  },
  {
    id: 'ceramic.white',
    name: 'White ceramic',
    surfaces: ['part'],
    tint: '#f4f4f0',
    tintable: false,
    roughness: 0.2,
    metalness: 0,
  },
  {
    id: 'plastic.matt',
    name: 'Matt plastic',
    surfaces: ['part'],
    tint: '#e8e8e5',
    tintable: true,
    roughness: 0.7,
    metalness: 0,
  },
  {
    id: 'glass.clear',
    name: 'Clear glass',
    surfaces: ['part'],
    tint: '#dfeaf0',
    tintable: true,
    roughness: 0.05,
    metalness: 0,
  },
];
