'use strict';
/**
 * The Quest tab's landing feed (the 1.7.4 client's ui.screens.landingpage + comp_promotions, shown by
 * game.states.server_synced at login, later only through the home button): the daily-reward strip "DON'T MISS YOUR
 * NEXT REWARD!", the main quest, today's event with its countdown, the current portal ("Portal closes in:"), the
 * "Get Cards" booster promo and the next portal's teaser. The quest / portal banners open the map (`{line}`).
 * Shown by the quest-map screen for `{ feed: true }`.
 */
import { h, icon, sprite, fmt, keyActivate } from '../dom.js';
import { screenBody } from '../chrome.js';
import { tokenSpriteFor } from './booster-view.js';
import { questLine } from '../../game/quests.js';
import { utcDay, utcDayStart, DAY_MS } from '../../game/state.js';
import { dailyRewardFor, dailyEvent, previousDay, DAILY_REWARDS } from '../../game/shop.js';
import { formatHms, DOUBLE_EVENTS, EVENT_HEADLINES } from './pvp-events.js';
import { runningPortal, enterPortal } from './quest-portal.js';

/* ------------------------------------------------------------------ pure */

/**
 * Is this the landing feed rather than a map? Only with `{feed: true}` (the login, the home button); the
 * Quest tab itself (no params) is the main map.
 * @param {object} [params]
 * @returns {boolean}
 */
export function isFeedView(params) {
  return Boolean(params && params.feed);
}

/**
 * The daily-reward strip: the next streak days (big first item = tomorrow's reward), "…", the last day of the
 * 21-day cycle, and when the next reward can be claimed (next UTC midnight).
 * @param {object} state
 * @param {number} now
 * @returns {{items: {day: number, reward: object, gap?: boolean}[], endsAt: number}}
 */
export function dailyStrip(state, now) {
  const d = state.daily || { streak: 0, lastClaim: '' };
  const today = utcDay(now);
  // claimed today: tomorrow continues the streak; not yet: the claim on open continues it from yesterday or restarts
  const next = d.lastClaim === today || d.lastClaim === previousDay(today) ? (d.streak | 0) + 1 : 1;
  const cycle = DAILY_REWARDS.length;
  const cycleEnd = Math.ceil(next / cycle) * cycle;
  const items = [];
  for (let day = next; day < next + 3 && day <= cycleEnd; day++) items.push({ day, reward: dailyRewardFor(day) });
  if (items[items.length - 1].day < cycleEnd) items.push({ day: cycleEnd, reward: dailyRewardFor(cycleEnd), gap: items[items.length - 1].day < cycleEnd - 1 });
  return { items, endsAt: utcDayStart(now) + DAY_MS };
}

/**
 * Sprite and number for a daily reward in the strip.
 * @param {object} reward  a DAILY_REWARDS entry
 * @returns {{sprite: string, amount: number|null, label: string}}
 */
export function dailyRewardIcon(reward) {
  if (reward.gems) return { sprite: 'reward_gems', amount: reward.gems, label: `${reward.gems} gems` };
  if (reward.tokens) {
    return { sprite: tokenSpriteFor(reward.tokens) || 'token_small', amount: reward.count || 1, label: `${reward.count || 1} ${reward.tokens} tokens` };
  }
  if (reward.mana) return { sprite: 'reward_manapotion', amount: (reward.mana || 0) + (reward.stamina || 0), label: `${reward.mana} mana + ${reward.stamina || 0} stamina potions` };
  return { sprite: 'reward_staminapotions', amount: reward.stamina || 0, label: `${reward.stamina || 0} stamina potions` };
}

/**
 * The banners of the landing feed, in order.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{id: string, name: string, desc: string}|null} [event]  today's event (defaults to shop.dailyEvent)
 * @returns {object[]}  {kind: 'daily'|'quest'|'event'|'portal'|'shop'|'next-portal', ...}
 */
export function feedBanners(state, deps, now, event) {
  const out = [];
  out.push({ kind: 'daily', ...dailyStrip(state, now) });
  const mainDef = questLine(deps, 'main');
  const total = mainDef ? mainDef.nodes.length : 100;
  const current = Math.min(total, (state.quests && state.quests.main && state.quests.main.unlocked) || 1);
  const sec = (deps.quests.sections || []).find((s) => current >= s.from && current <= s.to);
  out.push({ kind: 'quest', line: 'main', quest: current, total, section: sec ? sec.name : '' });
  const ev = event === undefined ? dailyEvent(now, state) : event;
  if (ev) out.push({ kind: 'event', id: ev.id, name: ev.name, desc: ev.desc, headline: EVENT_HEADLINES[ev.id] || ev.desc, double: DOUBLE_EVENTS.includes(ev.id), endsAt: utcDayStart(now) + DAY_MS });
  const run = runningPortal(state, deps, now);
  if (run) {
    const def = questLine(deps, run.portalId);
    out.push({ kind: 'portal', line: run.portalId, name: run.name, cards: ((def && def.cards) || []).slice(0, 4), endsAt: run.endsAt });
  }
  out.push({ kind: 'shop' });
  if (run && run.next) {
    const next = questLine(deps, run.next.portalId);
    out.push({ kind: 'next-portal', line: run.next.portalId, name: run.next.name, cards: ((next && next.cards) || []).slice(0, 4), startsAt: run.next.startsAt });
  }
  return out;
}

/* ------------------------------------------------------------------ DOM */

/**
 * A small fan of card arts for a banner.
 * @param {object} ctx
 * @param {string[]} cardIds
 * @returns {HTMLElement}
 */
function cardFan(ctx, cardIds) {
  const defs = cardIds.map((id) => ctx.db.get(id)).filter(Boolean);
  const mid = (defs.length - 1) / 2;
  return h('div.feed-fan', null, defs.map((d, i) => {
    const url = ctx.view.artUrlFor(d, 0);
    return h('div.feed-fan-card', { class: `rarity-${d.rarity}`, style: { '--i': String(i - mid) } },
      url ? h('img', { src: url, alt: d.name, loading: 'lazy', draggable: 'false' }) : null);
  }));
}

/**
 * Countdown element for a banner (d:hh:mm:ss).
 * @param {object} ctx
 * @param {number} endsAt
 * @returns {HTMLElement}
 */
function feedCountdown(ctx, endsAt) {
  return ctx.ui.createCountdown({ endsAt, getNow: ctx.now, className: 'feed-countdown' });
}

/**
 * h:mm:ss timer of a day-long banner (the daily strip and the event: frames quest-hub-1_v174 "7:12:56",
 * quest-map-1_v174 "WISDOM ... 8:12:44", like the Arena's event banner). Ticks until the screen is left or the
 * banner replaced.
 * @param {object} ctx
 * @param {number} endsAt
 * @returns {HTMLElement}
 */
function dayTimer(ctx, endsAt) {
  const el = h('span.countdown.feed-countdown.num');
  const tick = () => { el.textContent = formatHms(endsAt - ctx.now()); };
  tick();
  let seen = false;
  const id = setInterval(() => {
    if (el.isConnected) seen = true;
    else if (seen) { clearInterval(id); return; }
    tick();
  }, 1000);
  ctx.root.addEventListener('screen:leave', () => clearInterval(id), { once: true });
  return el;
}

/**
 * One feed banner.
 * @param {object} ctx
 * @param {object} b  a feedBanners entry
 * @returns {HTMLElement}
 */
function feedBanner(ctx, b) {
  const tap = (fn) => ({ role: 'button', tabIndex: 0, onClick: fn, onKeydown: keyActivate(fn) });
  switch (b.kind) {
    case 'daily':
      return h('div.feed-banner.feed-daily', { dataset: { feed: 'daily' } },
        h('div.feed-daily-title', null, "DON'T MISS YOUR NEXT REWARD!"),
        h('div.feed-daily-items', null, b.items.map((it, i) => {
          const ic = dailyRewardIcon(it.reward);
          return [
            it.gap ? h('span.feed-daily-gap', null, '…') : null,
            h('div.feed-daily-item', { class: i === 0 && 'next', title: `Day ${it.day}: ${ic.label}` },
              h('div.feed-daily-frame', null,
                ic.amount != null && ic.amount > 1 ? h('span.feed-daily-amount', null, fmt(ic.amount)) : null,
                sprite(ic.sprite, { class: 'feed-daily-img', alt: ic.label })),
              i === 0 ? dayTimer(ctx, b.endsAt) : h('span.feed-daily-day', null, `D ${it.day}`)),
          ];
        })));
    case 'quest':
      return h('div.feed-banner.feed-quest', { dataset: { feed: 'quest' }, ...tap(() => ctx.replace('quest-map', { line: 'main' })) },
        h('div.feed-title', null, 'Main Quest'),
        h('div.feed-sub', null, b.section ? `${b.section} - Quest ${b.quest}` : `Quest ${b.quest}`),
        h('div.feed-progress', null, `${b.quest} / ${b.total}`),
        icon('arrow-right', { class: 'feed-arrow' }));
    case 'event':
      return h('div.feed-banner.feed-event', { dataset: { feed: 'event', event: b.id }, title: b.desc },
        b.double ? h('span.feed-x2', null, 'x2') : null,
        h('div.feed-title', null, b.name),
        h('div.feed-sub', null, b.headline.toUpperCase()),
        dayTimer(ctx, b.endsAt));
    case 'portal':
      return h('div.feed-banner.feed-portal', { dataset: { feed: 'portal', line: b.line }, ...tap(() => enterPortal(ctx, () => ctx.replace('quest-map', { line: b.line }))) },
        cardFan(ctx, b.cards),
        h('div.feed-title', null, b.name),
        h('div.feed-closes', null, b.endsAt ? ['Portal closes in:', feedCountdown(ctx, b.endsAt)] : 'Portal open'));
    case 'shop':
      return h('div.feed-banner.feed-shop', { dataset: { feed: 'shop' }, ...tap(() => ctx.goTop('shop')) },
        h('div.feed-shop-plate', null, 'Get Cards'));
    case 'next-portal':
      return h('div.feed-banner.feed-next', { dataset: { feed: 'next-portal', line: b.line }, ...tap(() => ctx.ui.toast(`${b.name} opens soon`, { icon: 'compass' })) },
        cardFan(ctx, b.cards),
        h('div.feed-title', null, b.name),
        h('div.feed-closes', null, 'Coming soon:', feedCountdown(ctx, b.startsAt)));
    default:
      return null;
  }
}

/**
 * The landing feed.
 * @param {object} ctx
 * @param {object} state
 */
export function renderFeed(ctx, state) {
  ctx.chrome.mount({ active: 'quest', back: false, help: 'quest-map' });
  const body = screenBody(ctx, 'qm-feed');
  for (const b of feedBanners(state, ctx.deps, ctx.now(), ctx.event())) {
    const el = feedBanner(ctx, b);
    if (el) body.appendChild(el);
  }
  // a daily reward claimed while the feed shows (a new day, the debug API) moves the strip on at once, and a
  // debug day shift (daily.dayShift) brings that day's event
  let daily = state.daily;
  let seen = false;
  const unsub = ctx.store.subscribe((s) => {
    if (ctx.root.isConnected) seen = true;
    else if (seen) { unsub(); return; }
    if (!s || !s.daily || s.daily === daily) return;
    const was = daily || {};
    daily = s.daily;
    if (was.lastClaim !== s.daily.lastClaim || was.streak !== s.daily.streak) {
      const old = body.querySelector('[data-feed="daily"]');
      if (old) old.replaceWith(feedBanner(ctx, { kind: 'daily', ...dailyStrip(s, ctx.now()) }));
    }
    if ((was.dayShift || 0) !== (s.daily.dayShift || 0)) {
      const fresh = feedBanners(s, ctx.deps, ctx.now(), ctx.event()).find((b) => b.kind === 'event');
      const old = body.querySelector('[data-feed="event"]');
      if (old && fresh) old.replaceWith(feedBanner(ctx, fresh));
    }
  });
  ctx.root.addEventListener('screen:leave', () => unsub());
}
