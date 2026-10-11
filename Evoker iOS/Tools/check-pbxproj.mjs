#!/usr/bin/env node
// Sanity check of the hand-written Xcode project: balanced braces/parentheses, every referenced object id is
// defined, every file/folder path the project points at exists, the synchronized folder exists.
//   node Tools/check-pbxproj.mjs
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pbx = readFileSync(join(root, 'Evoker.xcodeproj', 'project.pbxproj'), 'utf8');
let errors = 0;
const fail = (m) => { console.error('FAIL ' + m); errors++; };

// braces
let depth = 0, paren = 0;
for (const ch of pbx) {
  if (ch === '{') depth++; else if (ch === '}') depth--;
  if (ch === '(') paren++; else if (ch === ')') paren--;
  if (depth < 0 || paren < 0) { fail('unbalanced brackets'); break; }
}
if (depth !== 0) fail(`unbalanced braces (${depth})`);
if (paren !== 0) fail(`unbalanced parentheses (${paren})`);

// ids
const defined = new Set([...pbx.matchAll(/^\t\t([0-9A-F]{24}) (?:=|\/\*)/gm)].map((m) => m[1]));
const referenced = new Set([...pbx.matchAll(/\b([0-9A-F]{24})\b/g)].map((m) => m[1]));
for (const id of referenced) if (!defined.has(id)) fail(`id ${id} referenced but never defined`);
const root1 = /rootObject = ([0-9A-F]{24})/.exec(pbx);
if (!root1 || !defined.has(root1[1])) fail('rootObject missing');
console.log(`${defined.size} objects, ${referenced.size} ids referenced`);

// sections open/close
for (const m of pbx.matchAll(/\/\* Begin (\w+) section \*\//g)) {
  if (!pbx.includes(`/* End ${m[1]} section */`)) fail(`section ${m[1]} not closed`);
}

// paths
for (const m of pbx.matchAll(/path = "?([^";]+)"?;/g)) {
  const p = m[1];
  if (p.endsWith('.app')) continue;
  if (!existsSync(join(root, p))) fail(`path does not exist: ${p}`);
}
for (const m of pbx.matchAll(/relativePath = "?([^";]+)"?;/g)) {
  if (!existsSync(join(root, m[1], 'Package.swift'))) fail(`package not found: ${m[1]}`);
}
const required = ['Evoker/App/EvokerApp.swift', 'Evoker/Assets.xcassets/Contents.json', 'GameAssets', 'EvokerCore/Package.swift'];
for (const r of required) if (!existsSync(join(root, r))) fail(`required file missing: ${r}`);

if (errors) { console.error(`${errors} problem(s)`); process.exit(1); }
console.log('project.pbxproj looks consistent');
