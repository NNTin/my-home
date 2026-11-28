import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { homeModelJsonSchema } from '../src/model/home-model';

// Writes the JSON Schema for home files; `$schema` in data/homes/*.json points here.
const target = new URL('../schema/home-model.schema.json', import.meta.url);
const json = JSON.stringify(homeModelJsonSchema(), null, 2);
const options = (await resolveConfig(target)) ?? {};
await writeFile(target, await format(json, { ...options, parser: 'json' }));
console.log(`wrote ${target.pathname}`);
