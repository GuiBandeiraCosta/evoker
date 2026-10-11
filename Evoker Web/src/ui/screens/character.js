'use strict';
/**
 * Character screens, reached like in the 1.7.4 client: the profile from the HUD's level / stamina / mana bar
 * and the extended menu's Profile button, the options from its Options button (no tab bar, each is a pushed
 * screen with the back arrow).
 *  - profile (ui.screens.playerinfo): character-profile.js
 *  - settings (ui.screens.settings options_def): character-settings.js
 *  - daily: the 21-day reward calendar. No button leads here any more (the quest map's daily strip took its
 *    place); the route stays for the QA tools.
 *
 * params: { tab?: 'profile' | 'settings' | 'daily' }
 */
import { h, icon } from '../dom.js';
import { button } from '../components/buttons.js';
import { claimDaily } from '../../game/shop.js';
import { dailyCalendar, describeDailyReward, dailyRewardIcons, DAILY_CYCLE } from './daily-view.js';
import { profileView } from './character-profile.js';
import { settingsView } from './character-settings.js';

/** The views of the screen (params.tab). */
const VIEWS = ['profile', 'settings', 'daily'];

/* ------------------------------------------------------------------------------------------------
 * Daily view
 * ---------------------------------------------------------------------------------------------- */

/**
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function dailyView(ctx) {
  const state = ctx.store.get();
  const cal = dailyCalendar(state.daily, ctx.now());
  const event = ctx.event();
  const cells = cal.cells.map((c) => h('div.daily-cell', { class: [c.status, c.index % DAILY_CYCLE === 0 && 'last'], dataset: { day: String(c.index) } },
    h('span.daily-day', null, `Day ${c.index}`),
    h('span.daily-icons', null, dailyRewardIcons(c.reward).map((ic) => h('span.daily-icon', null, icon(ic.icon), ic.count > 1 || ic.icon === 'gem' ? h('span.num', null, ic.icon === 'gem' ? String(ic.count) : `×${ic.count}`) : null))),
    h('span.daily-text', null, describeDailyReward(c.reward)),
    c.status === 'claimed' || c.status === 'claimed-today' ? h('span.daily-check', { 'aria-label': 'Claimed' }, '✓') : null));

  const claim = button(cal.claimable ? 'Claim reward' : (cal.startsTomorrow ? 'Come back tomorrow' : 'Claimed today'), {
    variant: cal.claimable ? 'green' : 'grey', disabled: !cal.claimable, size: 'lg',
    onClick: () => doClaim(ctx),
  });
  return h('div.tab-daily', null,
    event ? h('div.portal-banner.daily-event', null, h('span', null, h('span.muted', null, 'Event: '), event.name), h('span.daily-event-desc', null, event.desc)) : null,
    h('div.daily-head.panel', null,
      h('div.daily-head-row', null,
        h('span.daily-streak', null, 'Streak: ', h('span.num.gold-text', null, String(cal.streak)), h('span.muted', null, ` day${cal.streak === 1 ? '' : 's'}`)),
        h('span.daily-next', null, cal.claimedToday || cal.startsTomorrow ? 'Come back tomorrow for ' : 'Today: ',
          h('span.gold-text', null, describeDailyReward(cal.nextReward)))),
      h('p.daily-hint.muted', null, 'Log in every day to keep your streak. The rewards repeat every 21 days; missing a day starts again at day 1.'),
      claim),
    h('div.daily-grid', null, cells));
}

/**
 * Claim today's reward.
 * @param {object} ctx
 */
async function doClaim(ctx) {
  const info = ctx.store.update((s, deps, now) => claimDaily(s, now));
  if (!info || !info.claimed) { ctx.ui.toast('Already claimed today.'); ctx.rerender(); return; }
  ctx.sfx('reward');
  await ctx.ui.dialog.alert({
    title: `Day ${info.day} reward`,
    message: h('div.daily-reward-popup', null,
      h('div.daily-reward-icons', null, dailyRewardIcons(info.reward).map((ic) => h('span.daily-icon.big', null, icon(ic.icon), h('span.num', null, ic.icon === 'gem' ? String(ic.count) : `×${ic.count}`)))),
      h('p', null, `You received ${describeDailyReward(info.reward)}!`)),
    okLabel: 'Great!',
  });
  ctx.rerender();
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

/**
 * @param {object} ctx  ScreenContext (architecture §8.1)
 */
export function render(ctx) {
  const params = ctx.params || {};
  const active = VIEWS.includes(params.tab) ? params.tab : 'profile';
  params.tab = active;
  ctx.chrome.mount({ active: 'character', back: true, help: 'character' });
  const builders = { profile: profileView, daily: dailyView, settings: settingsView };
  const content = h('div.character-content', { dataset: { tab: active } }, builders[active](ctx));
  const body = h('div.screen-body.character', { dataset: { tab: active } },
    active === 'daily' ? h('h1.screen-title', null, 'Daily rewards') : null,
    content);
  ctx.root.appendChild(body);
}

/** Screen registry entry (src/ui/screens/index.js). */
export const screen = { render };
