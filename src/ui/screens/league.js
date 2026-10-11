'use strict';
/**
 * League screen (nav "league", game-design §6), ported from the 1.7.4 client:
 *  - `comp_league_top_bar`: ligaboard_top_bg band, league name in its tier colour, liga_timer_bg countdown
 *    (d:hh:mm:ss, "FINISHED" at 0) and the info button (opens the info view).
 *  - `comp_league_list` / `comp_league_list_entry`: one ligaboard_player_bg row per player (the gold variant and
 *    a locked fight button for the own row): rank (yellow for the top 3, "-" without points), picture with the
 *    small_white frame ("?" default_player when the player has none), name, pvp_points + points, up to two prize
 *    icons with amounts in the inset box, fight button (fight_icon_active / _inactive). The list opens centred on
 *    the own row.
 *  - `ctrl_league_info` (params.view === 'info'): "RULES" and "PRIZES" headlines on ligaboard_top_bg, the rules
 *    text and one prize table per league (Gold, Silver, Bronze) in small_yellow frames.
 *  - `comp_league_enter_popup` on the first visit and `comp_league_finish_popup` after a league ended.
 * Fights go through the shared pre-battle screen with mode 'league' (architecture §8.4).
 */
import { h, sprite, fmt } from '../dom.js';
import { iconButton } from '../components/buttons.js';
import { formatCountdown } from '../components/countdown.js';
import { utcDay, isUnlocked } from '../../game/state.js';
import {
  openLeague, standings, canFightLeague, fightLeague, tierById, leagueTierOf, hasJoined, joinLeague,
  collectLeagueResult, prizeTables, TIER_COLORS, RULES_TEXT, LEAGUE_VERSION,
} from '../../game/league.js';
import { getSim, pvpManaCost, simInfo } from '../../game/opponents.js';
import { opponentPreview, withFightXp } from './pvp-view.js';
import { portrait, showSimInfo, eventBanner } from './pvp-widgets.js';

/** Sprites of the prize icons in a row (card fan, blue mana potion, orange stamina potion, gem pile). */
const PRIZE_SPRITES = { card: 'reward_cardslots', mana: 'potion_mana1', stamina: 'potion_stamina1', gems: 'reward_gems' };

/**
 * Text of the league timer: d:hh:mm:ss, "FINISHED" once it ran out (comp_league_top_bar).
 * @param {number} ms
 * @returns {string}
 */
export function timerText(ms) {
  return ms > 0 ? formatCountdown(ms) : 'FINISHED';
}

/**
 * Lines of the finish popup (comp_league_finish_popup with the client's English strings).
 * @param {{tier: string, rank: number, gems?: number, mana?: number, stamina?: number, card?: string|null, nextTier: string}} result
 * @returns {{title: string, congrats: string, passed: string, rank: string, rewards: Array<{kind: string, amount: number}>, enterText: string, next: string, button: string}}
 */
export function finishPopupLines(result) {
  const tier = tierById(result.tier);
  const rewards = [];
  if (result.card) rewards.push({ kind: 'card', amount: 1, rarity: result.card });
  if (result.mana) rewards.push({ kind: 'mana', amount: result.mana });
  if (result.stamina) rewards.push({ kind: 'stamina', amount: result.stamina });
  if (result.gems) rewards.push({ kind: 'gems', amount: result.gems });
  return {
    title: tier.name.toUpperCase(),
    congrats: 'Congratulations!',
    passed: `${tier.name} completed`,
    rank: `Your rank: ${result.rank}`,
    rewards,
    enterText: rewards.length ? 'Take your Reward and enter the next League:' : 'Enter the next league:',
    next: tierById(result.nextTier).name,
    button: 'Join League',
  };
}

/**
 * Lines of the enter popup (comp_league_enter_popup; the client shows server text, reconstructed here).
 * @param {string} tierId
 * @returns {{title: string, headline: string, description1: string, description2: string, nextleague: string, leaguetitle: string, okbutton: string}}
 */
export function enterPopupLines(tierId) {
  const tier = tierById(tierId);
  return {
    title: tier.name.toUpperCase(),
    headline: 'Leagues Unlocked!',
    description1: 'Defeat other players to earn points!',
    description2: 'The three best players of a league advance to the next league.',
    nextleague: 'Enter the next league:',
    leaguetitle: tier.name,
    okbutton: 'Join League',
  };
}

/**
 * Prize icons with amounts ("x5") as in the list rows and the finish popup.
 * @param {Array<{kind: string, amount: number, rarity?: string}>} items
 * @param {number} [max=2]
 * @returns {HTMLElement[]}
 */
function prizeIcons(items, max = 2) {
  return items.slice(0, max).map((it) => h('span.league-prize-item', { class: it.kind, title: it.kind === 'card' ? `1 ${it.rarity} card` : `${it.amount} ${it.kind}` },
    sprite(PRIZE_SPRITES[it.kind] || 'reward_gems', { class: 'league-prize-icon' }),
    h('span.league-prize-amount.num', null, `x${fmt(it.amount)}`)));
}

/**
 * Info view body (ctrl_league_info): RULES, PRIZES, one table per league.
 * @returns {HTMLElement}
 */
function renderLeagueInfo() {
  const headline = (text) => h('div.league-info-headline', null, h('span', null, text));
  const tables = prizeTables().map(({ tier, rows }) => h('div.league-info-league', { dataset: { tier: tier.id } },
    h('div.league-info-subhead', { style: { color: TIER_COLORS[tier.id] } }, h('span', null, tier.name)),
    h('div.league-info-frame', null,
      rows.map((r) => h('div.league-info-row', null, h('span.league-info-rank.num', null, r.rank), h('span.league-info-text', null, r.text))))));
  return h('div.league-info', null,
    headline('RULES'),
    h('div.league-info-frame.league-rules', null, RULES_TEXT),
    headline('PRIZES'),
    tables);
}

/**
 * Render the League screen.
 * @param {object} ctx  ScreenContext
 */
export function render(ctx) {
  ctx.chrome.mount({ active: 'league', back: true, help: 'league' });

  if (ctx.params && ctx.params.view === 'info') {
    ctx.root.appendChild(h('div.screen-body.league-info-screen', null, renderLeagueInfo()));
    return;
  }

  const now = ctx.now();
  const before = ctx.store.get();
  const lg0 = before.sim.league;
  if (!lg0 || lg0.day !== utcDay(now) || lg0.v !== LEAGUE_VERSION) {
    ctx.store.update((s, deps, n) => openLeague(s, deps, n, { event: ctx.event() }));
  }
  const state = ctx.store.get();
  const league = state.sim.league;
  const tier = tierById(league ? league.tier : leagueTierOf(state));

  // Top bar (comp_league_top_bar_layout: title at y -16, timer plate at y +7, info button at x +137).
  const timer = h('span.league-timer.num', null, timerText(league ? league.endsAt - now : 0));
  const head = h('div.league-top', null,
    h('div.league-title', { class: tier.id, style: { color: TIER_COLORS[tier.id] } }, tier.name),
    h('div.league-timer-plate', null, timer),
    iconButton('info', { sprite: 'info_icon', ariaLabel: 'League info', className: 'league-info-btn', onClick: () => { ctx.sfx('tap'); ctx.go('league', { view: 'info' }); } }));

  const rows = standings(state, ctx.deps, now).map((r) => renderRow(r));
  const list = h('div.league-list', null, eventBanner(ctx), rows.length ? rows : h('div.league-empty', null, 'Loading...'));
  ctx.root.appendChild(h('div.screen-body.league-screen', null, head, list));

  // centerListOnPlayer (ctrl_league after every list update). The screen is built off-document while the fade
  // transition runs (also when coming back from a fight), so wait until the list has a size.
  let tries = 0;
  const centre = () => {
    const me = list.querySelector('.league-row.me');
    if (!me) return;
    if (!list.isConnected || !list.clientHeight) { if (++tries < 80) setTimeout(centre, 50); return; }
    list.scrollTop = Math.max(0, me.offsetTop - list.offsetTop - (list.clientHeight - me.offsetHeight) / 2);
  };
  centre();

  let ticker = setInterval(() => {
    const left = league ? league.endsAt - ctx.now() : 0;
    timer.textContent = timerText(left);
    if (left <= 0) { clearInterval(ticker); ticker = null; setTimeout(() => { if (ctx.root.isConnected) ctx.rerender(); }, 1200); }
  }, 1000);
  ctx.root.addEventListener('screen:leave', () => { if (ticker) clearInterval(ticker); });

  if (state.sim.leaguePending) setTimeout(() => showFinish(state.sim.leaguePending), 60);
  else if (!hasJoined(state) && isUnlocked(state, 'league')) setTimeout(() => showEnter(), 60);

  function renderRow(r) {
    const pic = r.isPlayer || r.picture ? portrait(r.avatar, ctx, { className: 'league-pic' }) : h('div.portrait.league-pic.default', null, sprite('default_player'));
    const fightBtn = h('button.btn.btn-icon.league-fight-btn', {
      type: 'button', class: !r.fightable && 'locked', 'aria-label': r.isPlayer ? 'You' : `Attack ${r.name}`,
      'aria-disabled': r.fightable ? 'false' : 'true', disabled: r.isPlayer,
      onClick: r.isPlayer ? undefined : () => attack(r.id),
    }, sprite(r.fightable ? 'fight_icon_active' : 'fight_icon_inactive', { class: 'icon' }));
    return h('div.league-row', { class: [r.isPlayer && 'me', !r.fightable && !r.isPlayer && 'spent'], dataset: { simId: r.id, rank: r.rankText } },
      h('div.league-rank.num', { class: r.markRank && 'top' }, r.rankText),
      h('div.league-pic-frame', { role: r.isPlayer ? undefined : 'button', tabIndex: r.isPlayer ? undefined : 0, onClick: r.isPlayer ? undefined : () => openSimInfo(r.id) }, pic),
      h('div.league-name', null, r.name),
      h('div.league-points', null, sprite('pvp_points', { class: 'league-points-icon' }), h('span.num', null, String(r.points))),
      h('div.league-prize', { class: r.rewards.length === 1 && 'single' }, prizeIcons(r.rewards)),
      fightBtn);
  }

  async function showEnter() {
    const t = enterPopupLines(leagueTierOf(ctx.store.get()));
    await ctx.ui.dialog.open({
      title: t.title, className: `dialog-league-enter tier-${tier.id}`, closable: false,
      body: h('div.league-popup', null,
        h('div.league-popup-headline', null, t.headline),
        h('p', null, t.description1),
        h('p', null, t.description2),
        h('div.league-popup-next-label', null, t.nextleague),
        h('div.league-popup-next', { style: { color: TIER_COLORS[tier.id] } }, t.leaguetitle)),
      buttons: [{ label: t.okbutton, value: true, autofocus: true }],
    });
    ctx.store.update((s) => joinLeague(s));
  }

  async function showFinish(result) {
    const t = finishPopupLines(result);
    const prev = tierById(result.tier);
    const next = tierById(result.nextTier);
    await ctx.ui.dialog.open({
      title: t.title, className: `dialog-league-finish tier-${prev.id}`, closable: false,
      body: h('div.league-popup', null,
        h('div.league-popup-headline', null, t.congrats),
        h('div.league-popup-passed', null, t.passed),
        h('div.league-popup-rank', null, t.rank),
        t.rewards.length ? h('div.league-popup-rewards', null, prizeIcons(t.rewards, 4)) : null,
        h('div.league-popup-next-label', null, t.enterText),
        h('div.league-popup-next', { style: { color: TIER_COLORS[next.id] } }, t.next)),
      buttons: [{ label: t.button, value: true, variant: 'green', autofocus: true }],
    });
    const info = ctx.store.update((s, deps) => collectLeagueResult(joinLeague(s), deps));
    if (t.rewards.length) ctx.sfx('reward');
    if (info && info.result && info.result.cardId) {
      const def = ctx.deps.db.get(info.result.cardId);
      if (def) ctx.ui.toast(`New card: ${def.name}`, { icon: 'cards' });
    }
    ctx.rerender();
  }

  async function openSimInfo(simId) {
    const s = ctx.store.get();
    const sim = getSim(s, simId);
    if (!sim) return;
    const can = canFightLeague(s, simId, ctx.now());
    const r = await showSimInfo(simInfo(sim, ctx.deps), ctx, { canAttack: can.ok });
    if (r === 'attack') attack(simId);
  }

  function attack(simId) {
    const s = ctx.store.get();
    const check = canFightLeague(s, simId, ctx.now());
    if (!check.ok) {
      ctx.ui.toast(check.reason || 'You cannot fight this player now.', { icon: 'lock' });
      if (check.code === 'ended') ctx.rerender();
      return;
    }
    const sim = getSim(s, simId);
    if (!sim) return;
    const lg = s.sim.league;
    ctx.sfx('tap');
    ctx.go('prebattle', {
      mode: 'league',
      title: sim.name,
      opponent: opponentPreview(sim, ctx.deps, lg.power, ctx.view),
      manaCost: pvpManaCost(s, ctx.deps),
      fight: () => {
        const event = ctx.event();
        const info = ctx.store.update((st, deps, n) => fightLeague(st, deps, n, { simId, event }));
        return withFightXp(info, sim, lg.power, ctx.deps, event);
      },
      onDone: async (info) => {
        await ctx.back('league');
        if (info && info.won && info.points) ctx.ui.toast(`+${info.points} league points!`, { icon: 'league-points' });
      },
    });
  }
}

/** Screen registry entry (src/ui/screens/index.js); the router's `screen:leave` stops the timer. */
export const screen = { render };
