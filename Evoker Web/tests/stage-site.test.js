'use strict';
/**
 * tools/stage-site.js: the staged site holds exactly what the browser loads at runtime, plus the host's
 * cache policy, and nothing from tests/, tools/, docs/ or exploration/ (README "Publishing").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEADERS, PROJECT_ROOT, SHIP, shouldShip, stageSite } from '../tools/stage-site.js';

test('stage-site ships only the runtime entries, drops notes and litter, writes _headers', async () => {
  assert.deepEqual(SHIP, ['index.html', 'css', 'data', 'src', 'assets']);
  for (const entry of SHIP) assert.ok(existsSync(join(PROJECT_ROOT, entry)), `${entry} exists`);
  assert.equal(shouldShip('assets/bg/README.md'), false);
  assert.equal(shouldShip('assets/cards/Thumbs.db'), false);
  assert.equal(shouldShip('assets/cards/Adept.jpg'), true);
  assert.equal(shouldShip('src/app.js'), true);

  const out = mkdtempSync(join(tmpdir(), 'evoker-stage-'));
  try {
    // The small entries only: the copy itself is fs.cp, the art (180 MB) adds nothing to the check.
    const { entries } = await stageSite(out, { ship: ['index.html', 'css', 'data'] });
    assert.deepEqual(entries, ['index.html', 'css', 'data']);
    assert.ok(existsSync(join(out, 'index.html')));
    assert.ok(existsSync(join(out, 'css', 'main.css')));
    assert.ok(existsSync(join(out, 'data', 'cards.json')));
    for (const dir of ['src', 'assets', 'tests', 'tools', 'docs', 'exploration', 'node_modules']) {
      assert.equal(existsSync(join(out, dir)), false, `${dir} is not staged`);
    }
    const headers = readFileSync(join(out, '_headers'), 'utf8');
    assert.equal(headers, HEADERS);
    assert.match(headers, /^\/index\.html\n {2}Cache-Control: no-cache$/m);
    assert.match(headers, /^\/src\/\*\n {2}Cache-Control: no-cache$/m);
    assert.match(headers, /^\/assets\/\*\n {2}Cache-Control: public, max-age=604800$/m);

    // Staging again wipes what was there before.
    const { entries: again } = await stageSite(out, { ship: ['index.html'] });
    assert.deepEqual(again, ['index.html']);
    assert.equal(existsSync(join(out, 'css')), false, 'a second run starts from an empty folder');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('stage-site refuses to stage into the project itself', async () => {
  await assert.rejects(() => stageSite(PROJECT_ROOT), /refusing/);
});

test('package.json has the stage, preview and deploy scripts', () => {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.stage, 'node tools/stage-site.js');
  assert.match(pkg.scripts.preview, /^node tools\/stage-site\.js && node tools\/serve\.js \d+ --root=dist$/);
  assert.match(pkg.scripts.deploy, /^node tools\/stage-site\.js && npx --yes wrangler@4 pages deploy dist /);
});
