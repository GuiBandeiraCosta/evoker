#!/usr/bin/env node
'use strict';
/**
 * Stage the publishable site into a folder (default `dist/`) for a static host.
 *
 * The game has no build step: this only copies what the browser loads at runtime (index.html, css/, data/,
 * src/, assets/) into one clean folder, leaving tests, tools, docs and exploration/ behind (the APKs there
 * exceed the per-file limit of every free host anyway). It also writes `_headers` (the cache policy Cloudflare
 * Pages and Netlify read): code and data revalidate on every load, card art and sprites are cached a week.
 *
 * Usage: node tools/stage-site.js [outDir]        (default dist/, wiped first)
 *        npm run deploy                           (stage, then upload with wrangler — see README "Publishing")
 */
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Top-level entries the browser loads at runtime: everything else in the repository stays out of the site. */
export const SHIP = ['index.html', 'css', 'data', 'src', 'assets'];

/** Files never worth serving (notes, OS litter). */
const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db']);
const SKIP_EXT = /\.md$/i;

/**
 * Cache policy, in the `_headers` format Cloudflare Pages and Netlify both read. No file name carries a content
 * hash, so code and data must revalidate (the host answers 304 from the ETag); art only changes by name.
 */
export const HEADERS = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '/index.html',
  '  Cache-Control: no-cache',
  '/src/*',
  '  Cache-Control: no-cache',
  '/css/*',
  '  Cache-Control: no-cache',
  '/data/*',
  '  Cache-Control: no-cache',
  '/assets/*',
  '  Cache-Control: public, max-age=604800',
  '',
].join('\n');

/**
 * @param {string} src  path being copied
 * @returns {boolean}
 */
export function shouldShip(src) {
  const name = basename(src);
  return !SKIP_NAMES.has(name) && !SKIP_EXT.test(name);
}

/**
 * Copy the site into `outDir` (created fresh) and write `_headers`.
 * @param {string} outDir
 * @param {{ ship?: string[], root?: string }} [opts]  `ship` overrides the entry list (tests), `root` the project root
 * @returns {Promise<{ outDir: string, entries: string[] }>}
 */
export async function stageSite(outDir, { ship = SHIP, root = PROJECT_ROOT } = {}) {
  const out = resolve(outDir);
  if (out === resolve(root) || resolve(root).startsWith(out + sep)) {
    throw new Error(`refusing to stage into ${out}: it contains the project`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const entries = [];
  for (const entry of ship) {
    const from = join(root, entry);
    const info = await stat(from);
    await cp(from, join(out, entry), { recursive: info.isDirectory(), filter: shouldShip });
    entries.push(entry);
  }
  await writeFile(join(out, '_headers'), HEADERS);
  return { outDir: out, entries };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = process.argv[2] || join(PROJECT_ROOT, 'dist');
  const { outDir: out, entries } = await stageSite(outDir);
  console.log(`Staged ${entries.join(', ')} + _headers into ${out}`);
}
