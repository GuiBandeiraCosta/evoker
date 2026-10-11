'use strict';
/**
 * The tutorial manager (our game.tutorial.tutorialmanagerv3): one overlay layer above the screens that watches
 * the router, the store and the screens' DOM, asks `hintFor` (progress.js) what the current step shows, and draws
 * the text box, the button sparkle, the pointing hand (after its delay) or the drag arrow on the screens' own
 * elements. Screens need no tutorial code: targets are found with the selectors in progress.js TARGETS, fights are
 * read from the battle screen's params, its "ROUND n" label (`.battle-round.shown`) and its result banner (`.wonlost`),
 * the cards screen's mode and slots from
 * `.cards-screen[data-tab]` / `.cards-zone[data-zone]`, the Arena tab from `.arena-screen[data-tab]`.
 * `say(lineId)` shows a one-off line (the quest screen's soul-card drop).
 *
 * Installed once by the title screen (the first screen of every session): `installTutorial(ctx)`. Other modules
 * reach it through `tutorial` (a guarded proxy that does nothing before installation), e.g.
 * `tutorial.step('fight', { line, n, won })` or `tutorial.say('soulCard')`.
 */
import { createLayer, renderText, renderHand, renderDrag, renderSparkle } from './overlay.js';
import { hintFor, recordBossFight, tutorialFacts, patchTutorial, isTutorialActive, markSeen, FINAL_QUEST } from './progress.js';
import { line as lineById } from './lines.js';

/** Overlay refresh period while the tutorial runs, ms. */
export const POLL_MS = 200;
/** Targets below this stage y (the nav) get the hand from above. */
export const FLIP_BELOW_Y = 1000;
/** Default life of a `say()` line, ms. */
export const SAY_MS = 4500;

/** @type {ReturnType<typeof createManager>|null} */
let instance = null;

/**
 * Is a stage element visible enough to point at?
 * @param {Element|null} el
 * @returns {boolean}
 */
function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
}

/**
 * Create the manager (use `installTutorial`).
 * @param {object} ctx  a ScreenContext (store, router, ui.stage, deps)
 */
function createManager(ctx) {
  const stage = ctx.ui.stage;
  const stageEl = stage.el;
  const layer = createLayer(stageEl);
  const { store, router, deps } = ctx;
  const clock = () => performance.now();

  /** @type {any} */ let textEl = null;
  let textKey = '';
  /** @type {any} */ let handEl = null;
  /** @type {any} */ let dragEl = null;
  /** @type {any} */ let sparkEl = null;
  /** the highlight now shown and since when (the hand joins a sparkle after its delay) */
  let highlightKey = '';
  let highlightAt = 0;
  /** @type {{id: string, until: number, position: string}|null} */ let saying = null;
  const dismissed = new Set();
  /** one-off steps shown on this screen (marked seen when it is left) */
  const shownOnce = new Set();
  let routeAt = clock();
  let routeRef = null;
  /** @type {{n: number, line: string, mode: string, won: boolean, wonBefore: boolean, lostBefore: boolean}|null} */ let fight = null;
  let resultAt = 0;
  /** when each "ROUND n" of the current fight first showed (clock ms by round number) */
  let roundSeen = {};
  let timer = null;

  const currentRoute = () => router.current();
  const screenRoot = () => stage.layer.lastElementChild;

  /**
   * Stage rectangle of an element.
   * @param {Element} el
   */
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    const a = stage.toStage(r.left, r.top);
    const b = stage.toStage(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  /**
   * Stage coordinates of an element's centre.
   * @param {Element} el
   */
  function centre(el) {
    const r = rectOf(el);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /**
   * First visible element matching any of the selectors, inside the current screen (the nav and HUD are part of it).
   * @param {string[]} selectors
   * @returns {Element|null}
   */
  function find(selectors) {
    const root = screenRoot();
    if (!root) return null;
    for (const sel of selectors) {
      if (!sel) continue;
      let list = [];
      try { list = Array.from(root.querySelectorAll(sel)); } catch (err) { list = []; }
      const hit = list.find(visible);
      if (hit) return hit;
    }
    return null;
  }

  /** @param {boolean} [instant]  remove at once (another line replaces it) instead of fading out */
  function clearText(instant) {
    if (textEl) { if (instant) textEl.remove(); else textEl.close(); textEl = null; }
    textKey = '';
  }

  function showText(id, position) {
    const key = `${routeAt}:${id}`;
    if (textEl && textKey === key) return;
    clearText(true);
    const ln = lineById(id);
    if (!ln) return;
    textKey = key;
    textEl = renderText(ln, { position, onTap: () => { dismissed.add(key); if (saying && saying.id === id) saying = null; clearText(); } });
    textEl.dataset.line = id;
    layer.appendChild(textEl);
  }

  function hideHand() {
    if (handEl) { handEl.remove(); handEl = null; }
    if (dragEl) { dragEl.remove(); dragEl = null; }
    if (sparkEl) { sparkEl.remove(); sparkEl = null; }
    highlightKey = '';
  }

  /**
   * Highlight a button: the sparkle at once (when asked), the hand after `delay` ms.
   * @param {Element} el
   * @param {{sparkle?: boolean, delay?: number}} o
   * @param {string} key
   */
  function pointAt(el, o, key) {
    if (dragEl) { dragEl.remove(); dragEl = null; }
    if (highlightKey !== key) { hideHand(); highlightKey = key; highlightAt = clock(); }
    if (o.sparkle) {
      if (!sparkEl) { sparkEl = renderSparkle(); layer.appendChild(sparkEl); }
      sparkEl.place(rectOf(el));
    }
    if (clock() - highlightAt < (o.delay || 0)) return;
    if (!handEl) { handEl = renderHand(); layer.appendChild(handEl); }
    const p = centre(el);
    handEl.classList.toggle('flip', p.y > FLIP_BELOW_Y);
    handEl.place(p.x, p.y);
  }

  function dragFrom(a, b, key) {
    if (highlightKey !== key) { hideHand(); highlightKey = key; highlightAt = clock(); }
    if (!dragEl) { dragEl = renderDrag(); layer.appendChild(dragEl); }
    dragEl.place(centre(a), centre(b));
  }

  /** Slider cards asked for already (per slider: the cards screen builds a new one for each mode). */
  const revealed = new WeakMap();

  /**
   * The cards screen's curved slider may hide a card: ask it once to bring the arrow's card to the front
   * (`slider:reveal` event of the cards screen).
   * @param {string} selector  a TARGETS.sliderCard selector
   */
  function revealCard(selector) {
    const m = /data-uid="([^"]+)"/.exec(String(selector || ''));
    const root = screenRoot();
    const slider = root && root.querySelector('.card-slider');
    if (!m || !slider) return;
    if (!revealed.has(slider)) revealed.set(slider, new Set());
    const asked = revealed.get(slider);
    const body = root.querySelector('.cards-screen[data-tab]');
    const key = `${body ? body.dataset.tab : ''}:${m[1]}`;
    if (asked.has(key)) return;
    asked.add(key);
    try { slider.dispatchEvent(new CustomEvent('slider:reveal', { detail: { uid: m[1] } })); } catch (err) { /* old screen */ }
  }

  /** Mark the one-off steps of the screen being left as seen. */
  function flushOnce() {
    if (!shownOnce.size) return;
    const ids = Array.from(shownOnce);
    shownOnce.clear();
    const s = store.get();
    if (!s) return;
    let next = s;
    for (const id of ids) next = markSeen(next, id);
    if (next !== s) store.update(() => next);
  }

  /** Entering a screen: reset per-screen memory; a quest boss fight is recorded (lostLastBossFight). */
  function onRoute(entry) {
    // the poll may see a new screen before the router notifies: handle each screen entry once
    if (entry && routeRef !== null && entry.params === routeRef) { refresh(); return; }
    flushOnce();
    routeAt = clock();
    routeRef = entry ? entry.params : null;
    dismissed.clear();
    resultAt = 0;
    roundSeen = {};
    fight = null;
    clearText();
    hideHand();
    if (entry && entry.id === 'battle') {
      const p = entry.params || {};
      const mode = String(p.mode || '');
      if ((mode === 'quest' || mode === 'boss') && Number(p.quest) > 0) {
        const n = Number(p.quest);
        const won = p.info && typeof p.info.won === 'boolean' ? p.info.won : Boolean(p.result && p.result.winner === (p.playerSide || 'attacker'));
        // The fight was resolved before the battle opens, so the save already holds its first win: whether the
        // quest had been won (or lost) before this fight comes from the fight's own info (resolveBoss firstWin).
        const before = store.get();
        const facts = before ? tutorialFacts(before) : null;
        const winsNow = facts ? facts.won(n) : false;
        const wonBefore = won && p.info && typeof p.info.firstWin === 'boolean' ? !p.info.firstWin : (won ? false : winsNow);
        const lostBefore = Boolean(facts && facts.record.lost.includes(n)) && !wonBefore;
        fight = { n, line: p.line || 'main', mode, won, wonBefore, lostBefore };
        record(fight.line, fight.n, fight.won);
      }
    }
    if (entry && entry.id === 'league') {
      // the first League visit after the final quest closes the tutorial (tutorial-v2 §9.8)
      const s = store.get();
      if (s && isTutorialActive(s) && tutorialFacts(s).won(FINAL_QUEST)) store.update((x) => patchTutorial(markSeen(x, 'league'), { done: true }));
    }
    refresh();
  }

  function record(line, n, won) {
    const s = store.get();
    if (!s) return;
    const next = recordBossFight(s, line, n, won);
    if (next !== s) store.update(() => next);
  }

  /** What the current screen's DOM says (cards mode and slots, Arena tab, fight timing). */
  function observe(entry, state, now) {
    const extra = { deps };
    const root = screenRoot();
    if (entry.id === 'cards' && root) {
      const body = root.querySelector('.cards-screen[data-tab]');
      const active = root.querySelector('.mode-btn.active[data-tab], [data-tab][aria-selected="true"]');
      extra.cardsTab = (body && body.dataset.tab) || (active && active.dataset.tab) || '';
      const zoneUid = (id) => { const c = root.querySelector(`.cards-zone[data-zone="${id}"] .card[data-uid]`); return c ? c.dataset.uid : null; };
      const stack = root.querySelector('.cards-zone[data-zone="stack"]');
      extra.zones = { fuse1: zoneUid('fuse1'), fuse2: zoneUid('fuse2'), train: zoneUid('train'), stack: stack ? Number(stack.dataset.count) || stack.querySelectorAll('.card[data-uid]').length : 0 };
    }
    if (entry.id === 'arena' && root) {
      const body = root.querySelector('.arena-screen[data-tab]');
      const active = root.querySelector('.tab.active[data-tab], [role="tab"][aria-selected="true"][data-tab]');
      extra.arenaTab = (body && body.dataset.tab) || (active && active.dataset.tab) || (entry.params && entry.params.tab) || 'arena';
    }
    if (entry.id === 'quest' && state.quests && state.quests.active) extra.quest = state.quests.active;
    if (entry.id === 'battle' && fight) {
      const banner = root && root.querySelector('.wonlost');
      if (banner && !resultAt) resultAt = now;
      // the fight lines are timed from the round they belong to (the battle opens with Loading and the tribe bonus)
      const label = root && root.querySelector('.battle-round.shown');
      const m = label ? /ROUND\s+(\d+)/i.exec(label.textContent || '') : null;
      if (m && roundSeen[m[1]] == null) roundSeen[m[1]] = now;
      const sinceRound = {};
      for (const k of Object.keys(roundSeen)) sinceRound[k] = now - roundSeen[k];
      extra.battle = { ...fight, elapsed: now - routeAt, sinceRound, resultShown: Boolean(resultAt), resultElapsed: resultAt ? now - resultAt : 0 };
    }
    if (entry.id === 'cards' && root) {
      // the training / fusion cutscene (cards.js playOpFx): its lesson is done
      const fx = root.querySelector('.cards-fx');
      extra.cutscene = fx ? (fx.classList.contains('enhance') ? 'enhance' : 'evolve') : '';
    }
    return extra;
  }

  /** Re-evaluate the current step and redraw the overlay. */
  function refresh() {
    const state = store.get();
    const entry = currentRoute();
    if (entry && entry.params !== routeRef && routeRef !== null) { onRoute(entry); return; }
    // dialogs and the cards screen's training / fusion cutscene hide the overlay
    const blocked = Boolean(stageEl.querySelector('.dialog-backdrop, .lvl-backdrop, .tut-name-popup, .cards-fx'));
    layer.classList.toggle('blocked', blocked);
    if (!state || !entry) { clearText(); hideHand(); return; }
    // a save that went past the last tutorial quest some other way (debug, import) ends the tutorial
    if (isTutorialActive(state) && tutorialFacts(state).won(FINAL_QUEST + 1)) { store.update((s) => patchTutorial(s, { done: true })); return; }
    const now = clock();
    const extra = observe(entry, state, now);
    if (extra.cutscene) {
      // a training (fusion) was made: the lesson must not come back when the cutscene ends
      const id = extra.cutscene === 'enhance' ? 'trainLesson' : 'fusionLesson';
      shownOnce.delete(id);
      const next = markSeen(state, id);
      if (next !== state) { store.update(() => next); return; }
    }
    const hint = hintFor(state, entry, extra);
    if (hint.once) shownOnce.add(hint.once);
    if (hint.reveal) revealCard(hint.reveal);
    // text: a say() line wins over the step's own text until it expires
    if (saying && now > saying.until) saying = null;
    const textId = saying ? saying.id : hint.text;
    const position = saying ? saying.position : hint.position;
    if (textId && !dismissed.has(`${routeAt}:${textId}`)) showText(textId, position || 'bottom'); else clearText();
    // highlight
    const hand = hint.hand;
    if (!hand || blocked) { hideHand(); return; }
    if (hand.drag) {
      revealCard(hand.drag.from);
      const a = find([hand.drag.from]);
      const b = find([hand.drag.to]);
      if (a && b) { if (handEl) { handEl.remove(); handEl = null; } if (sparkEl) { sparkEl.remove(); sparkEl = null; } dragFrom(a, b, `drag:${hand.drag.from}>${hand.drag.to}`); return; }
      const fb = find(hand.fallback || []);
      if (fb) { pointAt(fb, { sparkle: true }, `tap:${(hand.fallback || []).join(',')}`); return; }
      hideHand();
      return;
    }
    const target = find([hand.tap, ...(hand.fallback || [])]);
    if (target) pointAt(target, hand, `tap:${hand.tap}`); else hideHand();
  }

  const unsubRouter = router.onChange((e) => onRoute(e));
  const unsubStore = store.subscribe(() => refresh());
  timer = setInterval(() => {
    const s = store.get();
    if ((s && isTutorialActive(s)) || saying || textEl || handEl || dragEl || sparkEl) refresh();
  }, POLL_MS);

  return {
    layer,
    refresh,
    /**
     * Show a one-off line (e.g. the soul-card drop) for `duration` ms.
     * @param {string} id  line id (lines.js)
     * @param {{duration?: number, position?: string, force?: boolean}} [o]  force: also after the tutorial
     */
    say(id, o = {}) {
      const s = store.get();
      if (!o.force && !(s && isTutorialActive(s))) return;
      if (!lineById(id)) return;
      // the soul-card line belongs to the scripted drop of quest 1 only (tutorial-v2 §1.4)
      if (id === 'soulCard' && !o.force) {
        const e = currentRoute();
        const p = (e && e.params) || {};
        if (!e || e.id !== 'quest' || (p.line && p.line !== 'main') || Number(p.quest) !== 1) return;
      }
      saying = { id, until: clock() + (o.duration || SAY_MS), position: o.position || 'bottom' };
      refresh();
    },
    /**
     * Hook for other screens (all optional): 'fight' {line, n, won} records a boss fight that did not go through
     * the battle screen; 'refresh' redraws now.
     * @param {string} name
     * @param {object} [data]
     */
    step(name, data = {}) {
      if (name === 'fight') record(data.line || 'main', Number(data.n) || 0, Boolean(data.won));
      refresh();
    },
    /** The line id shown now (tests / QA). */
    currentLine: () => (textEl ? textEl.dataset.line : null),
    destroy() {
      clearInterval(timer);
      unsubRouter();
      unsubStore();
      clearText();
      hideHand();
      layer.remove();
      instance = null;
    },
  };
}

/**
 * Install the tutorial overlay (once per page; later calls return the same manager).
 * @param {object} ctx  ScreenContext
 * @returns {ReturnType<typeof createManager>|null}  null when the stage is not available (tests)
 */
export function installTutorial(ctx) {
  if (instance) return instance;
  if (!ctx || !ctx.ui || !ctx.ui.stage || !ctx.ui.stage.el || typeof document === 'undefined') return null;
  instance = createManager(ctx);
  if (typeof window !== 'undefined' && window.evoker) window.evoker.tutorial = instance;
  return instance;
}

/** Guarded access for hooks in other modules: every call is a no-op before installation. */
export const tutorial = Object.freeze({
  say: (id, o) => { if (instance) instance.say(id, o); },
  step: (name, data) => { if (instance) instance.step(name, data); },
  refresh: () => { if (instance) instance.refresh(); },
  get installed() { return Boolean(instance); },
});
