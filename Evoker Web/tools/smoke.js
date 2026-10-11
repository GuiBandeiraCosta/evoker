#!/usr/bin/env node
'use strict';
/**
 * Browser smoke test (architecture §6 and §8.6).
 *
 * Serves the project on a free port, launches the installed Edge/Chrome headless through tools/cdp.js
 * (harness: tools/qa-lib.js), then drives the app through its screen contract (§8) and debug API
 * (`window.evoker`, §8.5):
 *   title → name dialog → quest map → quest 1 (tap minions) → boss intro → pre-battle → Attack! → battle →
 *   skip → result, then a tour of every screen (and every tab) with a screenshot of each.
 *
 * Screenshots land in tests/screenshots/<nn>-<name>.png. Every step is tolerant: a failing step is
 * reported as FAIL and the run continues. The process exits 1 when any step failed or when the page
 * logged a console error / uncaught exception.
 *
 * Usage: node tools/smoke.js [--base=http://host:port/] [--out=dir] [--headed] [--slow=ms] [--verbose]
 *   --base     drive an already running server instead of serving the project in-process
 *   --out      screenshot directory (default tests/screenshots)
 *   --headed   show the browser window
 *   --slow     extra pause after each step in ms (default 0)
 */
import { createQa, bindApp, screenshotDir, pageScreenId, sleep } from './qa-lib.js';

const PLAYER_NAME = 'Smoke';

const qa = createQa({ title: 'Evoker smoke test', banner: 'SMOKE TEST', defaultOut: screenshotDir(), dedupeFailShots: true });
const { step, shot } = qa;
const {
  screenId, waitScreen, getState, debugCall, bootFresh, tapText, tapAny, dismissOverlays, go: goScreen,
} = bindApp(qa, { goSettleMs: 500, overlays: { generic: true } }); // goSettleMs: lazy art and transitions settle before the screenshot
/** @type {import('./cdp.js').Browser} */
let browser;

/* ------------------------------------------------------------------ the scenario */

/**
 * @param {string} base
 */
async function runScenario(base) {
  /* --- boot with a clean save --- */
  await step('boot', async () => {
    await bootFresh(base);
    const version = await browser.evaluate(() => window.evoker && window.evoker.version);
    return `ready, evoker ${version || '?'}`;
  });

  /* --- title screen --- */
  await step('title screen', async () => {
    await waitScreen('title', 10000);
    await sleep(600);
    await shot('title');
    if (!(await browser.tap('.title-screen')) && !(await tapText('tap to continue'))) await browser.click(360, 1000);
    // a new game shows the three-step intro lore first; skip it (the button exists only during the intro)
    await sleep(800);
    if (await browser.evaluate(`!!document.querySelector('.intro-skip')`)) {
      await browser.tap('.intro-skip');
      // the skip ends intro part 1 only; the boss preview and the scripted opening fight follow (tap Attack)
      await browser.waitFor("document.querySelector('.tut-fight .attack-btn') && !document.querySelector('.tut-fight.tf-preview')", 10000);
      await sleep(400);
      await browser.tap('.tut-fight .attack-btn');
      await browser.waitFor("!document.querySelector('.tut-opening')", 40000);
      await sleep(600);
      return 'tapped, intro skipped';
    }
    return 'tapped';
  });

  await step('name dialog', async () => {
    const dialogOrMap = await browser.waitFor(`document.querySelector('.dialog-backdrop input, .dialog-backdrop [contenteditable]') ? 'dialog' : ((${pageScreenId})() === 'quest-map' ? 'map' : '')`, 8000);
    if (dialogOrMap === 'map') return 'no name dialog (save already had a name)';
    await browser.tap('.dialog-backdrop input, .dialog-backdrop [contenteditable]');
    await browser.evaluate(() => { const i = document.querySelector('.dialog-backdrop input'); if (i) { i.focus(); i.select && i.select(); } });
    await browser.type(PLAYER_NAME);
    await shot('name-dialog');
    const clicked = await tapText('^(ok|start|continue|play|confirm|done)$', '.dialog-backdrop .dialog-buttons')
      || await browser.tap('.dialog-backdrop .dialog-buttons .btn:not([disabled]):last-child');
    if (!clicked) await browser.press('Enter');
    await waitScreen('quest-map', 10000);
    const s = await getState();
    const name = s && s.player && s.player.name;
    if (name !== PLAYER_NAME) throw new Error(`player name is ${JSON.stringify(name)}, expected ${JSON.stringify(PLAYER_NAME)}`);
    return `name = ${name}`;
  });

  await step('quest map', async () => {
    await waitScreen('quest-map', 10000);
    await sleep(500);
    await shot('quest-map');
  });

  /* --- quest 1: tap the minions --- */
  await step('open quest 1', async () => {
    // Prefer the real node on the map; fall back to the debug navigation.
    const tapped = await tapAny(['[data-quest="1"]', '[data-node="1"]', '.quest-node[data-n="1"]', '.map-node.current', '.map-node.next']);
    let id = null;
    if (tapped) {
      try { await waitScreen('quest', 4000); id = 'quest'; } catch { /* fall through */ }
    }
    if (id !== 'quest') await goScreen('go', 'quest', { line: 'main', quest: 1 });
    await sleep(400);
    await shot('quest');
    return tapped && id === 'quest' ? `via map node ${tapped}` : 'via evoker.go';
  }, { timeoutMs: 30000 });

  await step('tap minions', async () => {
    const minionSelectors = ['button.quest-minion:not(.slain):not(.enter)', '.quest-minion:not(.slain)', '[data-minion]:not(.dead):not(.defeated)', '.minion:not(.dead):not(.defeated):not(.beaten)', '.minion-slot:not(.empty)', '.minion-portrait', '.figure:not(.dead)'];
    let taps = 0;
    let stuck = 0;
    let shotTaken = false;
    for (let i = 0; i < 60; i++) {
      await dismissOverlays(3);
      const s = await getState();
      const active = s && s.quests && s.quests.active;
      if (active && active.bossReady) break;
      const before = active ? active.figuresDone : -1;
      let sel = await tapAny(minionSelectors);
      if (!sel) {
        // a wave's end (coin shower, card drop on the scene) leaves the landscape empty for ~2.5 s
        try { await browser.waitFor('document.querySelector("button.quest-minion:not(.slain):not(.enter)") || (window.evoker.state().quests.active || {}).bossReady', 6000); } catch { /* fall through */ }
        if ((await getState()).quests.active?.bossReady) break;
        sel = await tapAny(minionSelectors);
      }
      if (!sel) {
        // maybe a reward popup or a "boss" button is in the way
        if (await tapText('boss|fight')) { await sleep(400); continue; }
        throw new Error(`no minion element found (tried ${minionSelectors.join(', ')})`);
      }
      taps++;
      await sleep(450);
      if (!shotTaken && taps === 2) { await shot('quest-tapping'); shotTaken = true; }
      const after = await getState();
      const act2 = after && after.quests && after.quests.active;
      if (act2 && act2.bossReady) break;
      if (!act2 || act2.figuresDone === before) {
        stuck++;
        // a potion dialog may have popped up: accept it
        const d = await dismissOverlays(2);
        if (!d.length && stuck > 4) throw new Error(`progress stuck at figuresDone=${before} after ${taps} taps`);
      } else stuck = 0;
    }
    const s = await getState();
    const active = s && s.quests && s.quests.active;
    if (!active || !active.bossReady) throw new Error(`boss not ready after ${taps} taps (active=${JSON.stringify(active && { figuresDone: active.figuresDone, figuresTotal: active.figuresTotal, waveIndex: active.waveIndex })})`);
    await dismissOverlays(4);
    return `${taps} taps, ${active.figuresTotal} figures`;
  }, { timeoutMs: 90000 });

  /* --- boss --- */
  await step('boss intro', async () => {
    // The quest screen shows a red "Boss fight!" button once every wave is cleared (after the last wave's coin
    // shower / card drop) and then opens the boss intro by itself.
    try { await browser.waitFor('document.querySelector(".quest-boss-btn") || (window.evoker.router.current() || {}).id === "boss-intro"', 6000); } catch { /* fall through */ }
    if ((await screenId()) === 'quest') {
      if (!(await browser.tap('.quest-boss-btn')) && !(await tapText('boss fight', '.screen[data-screen="quest"]'))) throw new Error('Boss fight! button not found on the quest screen');
    }
    await waitScreen('boss-intro', 8000);
    await sleep(700);
    await shot('boss-intro');
    if (!(await browser.tap('.boss-continue')) && !(await tapText('continue|fight'))) await browser.click(360, 1100);
    await waitScreen('prebattle', 8000);
  }, { timeoutMs: 40000 });

  await step('prebattle (quest)', async () => {
    await waitScreen('prebattle', 8000);
    await sleep(500);
    await shot('prebattle');
    const tapped = await tapAny(['.attack-bar .attack-btn', '.attack-bar .btn', '.attack-btn']) || await tapText('^attack!?$');
    if (!tapped) throw new Error('Attack! button not found');
    // a Drink-potion dialog would mean mana is short; accept it
    await sleep(300);
    await dismissOverlays(2);
    await waitScreen('battle', 10000);
  }, { timeoutMs: 40000 });

  await step('battle + skip', async () => {
    await sleep(1200);
    await shot('battle');
    const skipped = await tapAny(['.battle-skip', '.btn.skip', '.skip-btn', '[data-action="skip"]']) || await tapText('skip fight');
    if (!skipped) throw new Error('Skip fight button not found');
    await browser.waitFor(() => {
      const el = document.querySelector('.screen[data-screen="battle"]') || document.body;
      return /victory|defeat|draw/i.test(el.textContent || '');
    }, 20000);
    await sleep(600);
    await shot('battle-result');
    const result = await browser.evaluate(() => {
      const el = document.querySelector('.battle-result[data-result]');
      if (el) return el.dataset.result;
      const m = /victory|defeat|draw/i.exec((document.querySelector('.screen[data-screen="battle"]') || document.body).textContent || '');
      return m ? m[0].toLowerCase() : 'unknown';
    });
    return `result: ${result}`;
  }, { timeoutMs: 60000 });

  await step('battle result → back', async () => {
    const deadline = Date.now() + 15000;
    while ((await screenId()) === 'battle' && Date.now() < deadline) {
      const d = await dismissOverlays(2);
      if (!d.length) {
        if (!(await tapText('tap to continue|continue|ok|collect'))) await browser.click(360, 1000);
      }
      await sleep(500);
    }
    const id = await screenId();
    if (id === 'battle') throw new Error('still on the battle screen after dismissing the result');
    if (!id) throw new Error('no screen is rendered (the app never reached the battle)');
    await sleep(500);
    const popups = await dismissOverlays(6);
    const s = await getState();
    const unlocked = s && s.quests && s.quests.main ? s.quests.main.unlocked : '?';
    return `now on ${id}; quests unlocked: ${unlocked}; dismissed ${popups.length} popups`;
  }, { timeoutMs: 40000 });

  /* --- tour --- */
  await step('debug: level 5, gems, potions', async () => {
    await debugCall('setLevel', 5);
    await debugCall('giveGems', 2000);
    await debugCall('giveGold', 5000);
    try { await debugCall('givePotions', 3, 3); } catch { /* optional */ }
    await sleep(200);
    const s = await getState();
    return `level ${s.player.level}, ${s.player.gems} gems`;
  });

  /** @type {{name: string, how: 'go'|'goTop', id: string, params?: object|((s: any) => object)}[]} */
  const tour = [
    { name: 'quest-map', how: 'goTop', id: 'quest-map' },
    { name: 'cards', how: 'goTop', id: 'cards' },
    { name: 'cards-deck', how: 'go', id: 'cards', params: { tab: 'deck' } },
    { name: 'cards-training', how: 'go', id: 'cards', params: { tab: 'training' } },
    { name: 'cards-fusion', how: 'go', id: 'cards', params: { tab: 'fusion' } },
    { name: 'card-detail', how: 'go', id: 'card-detail', params: (s) => ({ uid: s.cards[0].uid }) },
    { name: 'collections', how: 'go', id: 'collections' },
    { name: 'arena', how: 'goTop', id: 'arena' },
    { name: 'arena-pieces', how: 'go', id: 'arena', params: { tab: 'pieces' } },
    { name: 'arena-replays', how: 'go', id: 'arena', params: { tab: 'replays' } },
    { name: 'league', how: 'goTop', id: 'league' },
    { name: 'shop', how: 'goTop', id: 'shop' },
    { name: 'character', how: 'goTop', id: 'character' },
    { name: 'character-daily', how: 'go', id: 'character', params: { tab: 'daily' } },
    { name: 'character-settings', how: 'go', id: 'character', params: { tab: 'settings' } },
    { name: 'help', how: 'go', id: 'help', params: { topic: 'quest-map' } },
  ];
  for (const t of tour) {
    await step(`screen ${t.name}`, async () => {
      const params = typeof t.params === 'function' ? t.params(await getState()) : t.params;
      await goScreen(t.how, t.id, params);
      await dismissOverlays(2);
      await shot(t.name);
    }, { timeoutMs: 30000 });
  }

  await step('screen booster-open', async () => {
    await goScreen('goTop', 'shop');
    await goScreen('go', 'booster-open', { booster: 'neophyte', payWith: 'gems' });
    await sleep(600);
    await shot('booster-open');
    // Pick a card from the middle of the fan (the outer ones are clipped by the stage edge).
    const picked = await tapAny(['.booster-back[data-index="3"]', '.booster-back[data-index="4"]', '.booster-back', '.booster-card', '.booster .card', '.card.back', '.card-back', '.booster-slot']);
    if (picked) {
      await sleep(1500);
      await shot('booster-open-flip');
      await tapText('^take$');
      await sleep(600);
    }
    await dismissOverlays(3);
    return picked ? `picked ${picked}` : 'opened (no card element found to pick)';
  }, { timeoutMs: 40000 });

  await step('prebattle via arena', async () => {
    await goScreen('goTop', 'arena');
    const tapped = await tapAny(['.arena-offer .offer-actions button[aria-label^="Attack"]', '.arena-offer .attack-btn', '.arena-offer .btn.attack', '.opponent .btn', '.arena-row .btn']) || await tapText('^attack!?$', '.screen[data-screen="arena"]');
    if (!tapped) throw new Error('no Attack button on the arena screen');
    await sleep(300);
    await dismissOverlays(2);
    await waitScreen('prebattle', 10000);
    await sleep(500);
    await shot('prebattle-arena');
    await browser.evaluate(() => window.evoker.router.back());
    await sleep(500);
  }, { timeoutMs: 40000 });

  await step('final screenshot', async () => {
    await goScreen('goTop', 'quest-map');
    await shot('quest-map-final');
  });
}

qa.run(async (b, base) => { browser = b; await runScenario(base); });
