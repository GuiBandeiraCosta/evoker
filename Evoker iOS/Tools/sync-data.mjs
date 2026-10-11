#!/usr/bin/env node
// Copies the built data files of the web game into the EvokerCore package resources.
//   node Tools/sync-data.mjs
// The data is authored in Evoker Web (data/card-overrides.json, abilities.json, quests.json, names.json and
// `npm run build:data` there); the iOS package only consumes the result. Re-run after any data change.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webData = join(here, '..', '..', 'Evoker Web', 'data');
const dest = join(here, '..', 'EvokerCore', 'Sources', 'EvokerCore', 'Data');
mkdirSync(dest, { recursive: true });
const files = ['cards.json', 'abilities.json', 'quests.json', 'names.json'];
for (const f of files) {
  const src = join(webData, f);
  JSON.parse(readFileSync(src, 'utf8')); // fail loudly on a malformed file
  copyFileSync(src, join(dest, f));
  console.log(`copied ${f}`);
}
