'use strict';
/**
 * Arena screen (nav "arena"), ported from the 1.7.4 client's PvP landing (ui.screens.pvplanding,
 * scene_pvp_landing_layout): the hud_headeractive01 / hud_headeridle01 tabs Arena | Pieces | Replays on the
 * tab_background band, then
 *  - Arena (ctrl_pvpenemy_list + comp_enemy_entry): today's event banner (the small promotion banner: title,
 *    headline, orange "x2", time left), then three opponents. Each row: the opponent's strongest card in a
 *    frame glowing in the difficulty colour (pvp_bg_green / orange / red), the name in that colour, star +
 *    level, heart + HP, the info button (hud_smallbutton + info_icon) and the attack button (button_default +
 *    icon_pvp). No reroll: the opponents change after every fight and every 30 minutes (src/game/arena.js).
 *  - Pieces (ctrl_pvp_piece_list): the hunted cards with their puzzle overlays, see arena-pieces.js.
 *  - Replays (ctrl_fighthistory_list + comp_pvp_history_entry): the last fights with the opponent's strongest
 *    card and the attacked icon, name, Won / Lost / Draw, date and time, info and the watch (eye) button.
 * Fights go through the shared pre-battle screen (`ctx.go('prebattle', ...)`), see §8.4.
 */
import { h, fmt, mount, sprite } from '../dom.js';
import { renderCard } from '../components/card.js';
import { tabBar } from '../components/buttons.js';
import { ensureOffers, fightArena, offerInfo } from '../../game/arena.js';
import { getSim, pvpManaCost } from '../../game/opponents.js';
import { maybeAskName } from '../tutorial/name-popup.js';
import {
  offerColor, historyResult, historyDate, strongestCard, offerHp, rerunReplay, opponentPreview, sidePreview,
} from './pvp-view.js';
import { cardThumb, eventBanner, showSimInfo, attackButton, infoButton } from './pvp-widgets.js';
import { renderPiecesTab } from './arena-pieces.js';

const TABS = [
  { id: 'arena', label: 'Arena' },
  { id: 'pieces', label: 'Pieces' },
  { id: 'replays', label: 'Replays' },
];
/** The client's empty-list texts (ctrl_pvpenemy_list, ctrl_fighthistory_list). */
const EMPTY_ARENA = 'Sorry, there are currently no enemies in your range.';
const EMPTY_HISTORY = "Sorry, you don't have a fight history yet.";

/**
 * Render the Arena screen.
 * @param {object} ctx  ScreenContext (architecture §8.1)
 */
export function render(ctx) {
  const initial = TABS.some((t) => t.id === ctx.params.tab) ? ctx.params.tab : 'arena';
  ctx.chrome.mount({ active: 'arena', back: true, help: 'arena' });

  const content = h('div.arena-content');
  const tabs = tabBar(TABS, { active: initial, onSelect: (id) => { ctx.sfx('ui_button_switch'); showTab(id); } });
  const body = h('div.screen-body.arena-screen', null, h('div.arena-top', null, tabs), content);
  ctx.root.appendChild(body);

  /** @type {Array<{stop: () => void}>} */
  let timers = [];
  const stopTimers = () => { for (const t of timers) t.stop(); timers = []; };
  ctx.root.addEventListener('screen:leave', stopTimers);

  function showTab(id) {
    stopTimers();
    ctx.params.tab = id;
    tabs.setActive(id);
    body.dataset.tab = id;
    const pane = id === 'pieces' ? renderPiecesTab(ctx) : id === 'replays' ? renderReplays() : renderArena();
    mount(content, pane);
    content.scrollTop = 0;
  }

  /* ------------------------------------------------------------ Arena tab */
  function renderArena() {
    const state0 = ctx.store.get();
    const eo = ensureOffers(state0, ctx.deps, ctx.now());
    if (eo.state !== state0) ctx.store.update(() => eo.state);
    const state = ctx.store.get();
    const offers = (state.sim.arena && state.sim.arena.offers) || [];

    const rows = offers.map((offer, i) => {
      const sim = getSim(state, offer.simId);
      const color = offerColor(offer);
      const best = sim ? strongestCard(sim.deck, ctx.deps.db) : null;
      return h('div.arena-offer', { class: `c-${color}`, dataset: { offer: String(i), difficulty: offer.difficulty } },
        h('div.offer-glow'),
        cardThumb(best, ctx, 'offer-portrait'),
        h('div.offer-name', null, offer.name),
        h('div.offer-level', null, sprite('hud_experienceicon01', { class: 'offer-icon' }), h('span.num', null, String(offer.level))),
        h('div.offer-hp', null, sprite('hud_healthicon02', { class: 'offer-icon' }), h('span.num', null, fmt(offerHp(sim, offer.power)))),
        h('div.offer-actions', null,
          infoButton(`Info about ${offer.name}`, () => openOfferInfo(i), 'offer-info'),
          attackButton(`Attack ${offer.name}`, () => attackOffer(i), 'offer-attack')));
    });

    // the opponents change every 30 minutes (ensureOffers): a list left open past that refreshes itself
    if (offers.length) {
      const refresh = setInterval(() => {
        const arena = (ctx.store.get() || { sim: {} }).sim.arena;
        const rerollAt = (arena && arena.rerollAt) || 0;
        if (!rerollAt || ctx.now() < rerollAt || body.dataset.tab !== 'arena') return;
        if (!body.isConnected) return; // (the screen's leave stops the timer)
        if (ctx.ui.dialog.isOpen()) return; // not under an open info popup
        clearInterval(refresh);
        showTab('arena');
      }, 1000);
      timers.push({ stop: () => clearInterval(refresh) });
    }

    return h('div.arena-tab', null,
      eventBanner(ctx, (t) => timers.push(t)),
      h('div.arena-offers', null, rows.length ? rows : h('div.arena-empty', null, EMPTY_ARENA)));
  }

  async function openOfferInfo(i) {
    const raw = offerInfo(ctx.store.get(), ctx.deps, i);
    if (!raw) return;
    // the HP the fight uses (buildSimSide: hpMax x the offer's power), as in the list row
    const info = { ...raw, hp: Math.round(raw.hp * (raw.power || 1)) };
    ctx.sfx('ui_button_circular');
    const r = await showSimInfo(info, ctx);
    if (r === 'attack') attackOffer(i);
  }

  function attackOffer(i) {
    const state = ctx.store.get();
    const offer = state.sim.arena && state.sim.arena.offers[i];
    const sim = offer && getSim(state, offer.simId);
    if (!sim) { ctx.ui.toast('That opponent is gone. New opponents found.'); showTab('arena'); return; }
    const opponent = opponentPreview(sim, ctx.deps, offer.power, ctx.view);
    ctx.sfx('tap');
    // The original's pre-battle screen shows the opponent's name above the card backs.
    ctx.go('prebattle', {
      mode: 'arena',
      title: sim.name,
      opponent,
      manaCost: pvpManaCost(state, ctx.deps),
      fight: () => ctx.store.update((s, deps, now) => fightArena(s, deps, now, { offerIndex: i, event: ctx.event() })),
      onDone: () => { ctx.back('arena'); },
    });
  }

  /* ---------------------------------------------------------- Replays tab */
  function renderReplays() {
    const state = ctx.store.get();
    const replays = state.replays || [];
    if (!replays.length) return h('div.replays-tab', null, h('div.arena-empty', null, EMPTY_HISTORY));
    const rows = replays.map((rep, i) => {
      const res = historyResult(rep);
      const when = historyDate(rep.at);
      const opp = rep.defender ? rep.defender.name : '?';
      const best = strongestCard(rep.defender && rep.defender.cards, ctx.deps.db);
      return h('div.replay-row', { class: res.cls, dataset: { replay: String(i), mode: rep.mode || '' } },
        h('div.replay-thumb', null, cardThumb(best, ctx), sprite('attacked_icon', { class: 'replay-attacker', title: 'You attacked' })),
        h('div.replay-name', null, opp),
        h('div.replay-result', { class: res.cls }, res.label),
        h('div.replay-date.num', null, when.date),
        h('div.replay-time.num', null, when.time),
        infoButton(`Info about ${opp}`, () => replayInfo(i), 'replay-info'),
        h('button.pvp-attack.replay-play', { type: 'button', 'aria-label': `Watch replay against ${opp}`, title: 'Watch', onClick: () => watch(i) },
          sprite('hud_eyebutton01', { class: 'pvp-eye-icon' })));
    });
    return h('div.replays-tab', null, h('div.replays-list', null, rows));
  }

  /** The opponent's line-up of a recorded fight. */
  function replayInfo(i) {
    const rep = (ctx.store.get().replays || [])[i];
    if (!rep || !rep.defender) return;
    const cards = (rep.defender.cards || []).map((c) => {
      const def = c && ctx.deps.db.get(c.cardId);
      // the opponent's row as it faced the player: arrows turned like on the fight board (side 'top')
      return def ? renderCard(ctx.view.defView(def, c.stage | 0, Math.max(1, c.level | 0)), { size: 'compact', side: 'top' }) : h('div.deck-slot');
    });
    ctx.sfx('ui_button_circular');
    return ctx.ui.dialog.open({
      title: rep.defender.name,
      className: 'dialog-replay-info',
      body: h('div.replay-info-body', null,
        h('div.replay-info-hp', null, sprite('hud_healthicon02', { class: 'offer-icon' }), h('span.num', null, fmt(rep.defender.maxHp || 0))),
        h('div.replay-info-cards', null, cards)),
      buttons: [{ label: 'Watch', value: 'watch', autofocus: true }],
    }).then((v) => { if (v === 'watch') watch(i); });
  }

  function watch(i) {
    const rep = (ctx.store.get().replays || [])[i];
    if (!rep) return;
    let run;
    try {
      run = rerunReplay(rep, ctx.deps);
    } catch (err) {
      ctx.ui.toast('This replay can no longer be played.');
      console.error(err);
      return;
    }
    const attacker = { ...sidePreview(run.attacker, ctx.deps, ctx.view), side: run.attacker };
    const defender = { ...sidePreview(run.defender, ctx.deps, ctx.view), side: run.defender };
    ctx.sfx('tap');
    ctx.go('battle', {
      events: run.events, result: run.result, attacker, defender,
      rewards: null, levelUps: [], cardLevelUps: [], replay: true, mode: 'replay',
      onDone: () => { ctx.params.tab = 'replays'; ctx.back('arena'); },
    });
  }

  showTab(initial);
  // first Arena visit: the heralds ask for the player's name (comp_name_popup, DECISIONS D1)
  setTimeout(() => { if (ctx.root.isConnected) maybeAskName(ctx); }, 350);
}

/** Screen registry entry (src/ui/screens/index.js); the router's `screen:leave` stops the timers. */
export const screen = { render };
