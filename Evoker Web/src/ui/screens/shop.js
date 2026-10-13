'use strict';
/**
 * Shop screen (nav `shop`), after the 1.7.4 booster list (ui.screens.booster.boosterlist_screen / _entry) and the
 * user's 2016 screenshots (exploration/research/round3/frames/user/shop-1.png, shop-2.png): the "Need more Tokens? Visit
 * the Shop!" banner that opens the gem packs (ui.screens.overlays.premiumshop, comp_premiumshop_entry), then a
 * vertical list of framed pack banners (game/shop.js shopOffers): Neophyte Pack, the running portal's two packs
 * (with the portal's "Offer ends in d:hh:mm:ss"), the next portal's two packs with "Coming soon:" and the countdown
 * to the portal's start (not tappable yet), Summoner's Pack, Archmage's Pack. A banner shows the pack's painting in
 * the ornate frame (tinted per pack), the title on its plate, "May contain:" with the rarity squares, "Look inside"
 * and the token count when the player holds tokens. Tapping a banner opens the pack on the `booster-open` grid
 * (nothing is paid here: each card of the grid costs 1 token or gems). Below: the Great Potion Deal on its event
 * day and the set collections link.
 *
 * Stable hooks: `.pack-banner[data-booster][data-portal]` (`.pre` / `[data-pre]` for a coming-soon pack),
 * `.pack-title`, `.pack-look`, `.pack-soon`, `.pack-timer`, `.pack-tokens`, `.shop-topbanner`, `.shop-link`.
 *
 * Also exports the small pieces the booster screen shares: token images, the gem-pack overlay and the
 * "You need more Gems" popup (comp_not_enough_gems_popup).
 *
 * params: { gems?: true }  opens the gem packs on entry (the HUD "+" may pass it)
 */
import { h, icon, fmt, sprite, keyActivate } from '../dom.js';
import { button } from '../components/buttons.js';
import { formatCountdown } from '../components/countdown.js';
import { shopOffers, buyPotionDeal, boosterPool, boosterPrice, potionDealAvailable, POTION_DEAL_GEMS, POTION_DEAL_COUNT } from '../../game/shop.js';
import { eventId } from '../../game/player.js';
import { tokenSpriteFor, capitalize } from './booster-view.js';

/* ------------------------------------------------------------------------------------------------
 * Shared pieces (also used by booster-open)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Token image of a pack: the original token_small / _medium / _big sprites for the main packs, a CSS triangle
 * (sand for the low portal pack, violet for the high one, as on the 1.7.4 card backs) for the portal packs.
 * @param {string} kind  booster / token id
 * @param {string} [cls]
 * @returns {HTMLElement}
 */
export function tokenImage(kind, cls) {
  const name = tokenSpriteFor(kind);
  if (name) return sprite(name, { class: ['token-img', cls] });
  return h('span.token-img.token-tri', { class: [kind === 'portalHigh' ? 'high' : 'low', cls], 'aria-hidden': 'true' });
}

/**
 * What a price tap says instead of a purchase: this is a fan-made recreation, the project page explains how to get
 * gems (daily rewards, set collections, the console cheats). Pinned by tests/shop.test.js.
 */
export const GEM_PURCHASE_NOTICE = Object.freeze({
  text: 'Purchases are not available: this is a fan-made recreation of Evoker. If you would like more Gems, check out',
  url: 'https://github.com/GuiBandeiraCosta/evoker',
  after: 'to see how you can obtain more.',
});

/**
 * The gem packs overlay (premiumshop): five IAP packs with their original names and USD tiers. There is no
 * real-money purchase in the fan-made game, so a price tap only shows GEM_PURCHASE_NOTICE with the project link
 * (a new tab on the web; the iOS shell opens it in Safari).
 * @param {object} ctx
 * @returns {Promise<any>}
 */
function openGemShop(ctx) {
  const packs = shopOffers(ctx.store.get(), ctx.deps, ctx.now(), null).gemPacks;
  ctx.sfx('shopOpen');
  const explain = () => ctx.ui.dialog.alert({
    title: 'Gems',
    message: h('div.gem-notice', null,
      h('p', null, GEM_PURCHASE_NOTICE.text),
      h('p', null, h('a', { href: GEM_PURCHASE_NOTICE.url, target: '_blank', rel: 'noopener' }, GEM_PURCHASE_NOTICE.url)),
      h('p', null, GEM_PURCHASE_NOTICE.after)),
  });
  const rows = packs.map((p) => {
    const extras = [];
    if (p.card) extras.push(`${capitalize(p.card)} card`);
    if (p.potions) extras.push(`${p.potions} potions`);
    return h('div.gem-pack', { dataset: { pack: p.id } },
      sprite(p.sprite, { class: 'gem-pack-img' }),
      h('div.gem-pack-info', null,
        h('div.gem-pack-amount', null, h('span.num', null, fmt(p.gems)), ' Gems'),
        h('div.gem-pack-name', null, p.name),
        extras.length ? h('div.gem-pack-bonus', null, h('span.bonus', null, 'Bonus'), ' + ', extras.join(' + ')) : null),
      button(p.price, { size: 'sm', variant: 'green', onClick: explain }));
  });
  return ctx.ui.dialog.open({ title: 'Gems', className: 'gem-shop', body: h('div.gem-pack-list', null, rows) });
}

/**
 * "You need more Gems to get a booster card!" (openbooster_screen showNotEnoughGemsOverlay) with "Get more",
 * which opens the gem packs.
 * @param {object} ctx
 * @returns {Promise<void>}
 */
export async function notEnoughGems(ctx) {
  const v = await ctx.ui.dialog.open({
    className: 'shop-warning',
    body: h('div.shop-warning-body', null, sprite('shop_gems01', { class: 'shop-warning-img' }), h('p', null, 'You need more Gems to get a booster card!')),
    buttons: [{ label: h('span.gem-price', null, 'Get more', icon('gem')), value: 'more', variant: 'green', autofocus: true }],
  });
  if (v === 'more') await openGemShop(ctx);
}

/* ------------------------------------------------------------------------------------------------
 * Booster banners
 * ---------------------------------------------------------------------------------------------- */

/**
 * Frame tint and title colour of each pack's banner, after the 2016 shop (frames/user/shop-1.png, shop-2.png):
 * steel-blue frame for Neophyte and the low portal pack (Dreamwalker), gold for the high portal pack (Oneiromancer)
 * and Archmage, violet for Summoner; light titles on the steel banners, pink-violet on Oneiromancer / Summoner,
 * gold on Archmage.
 */
export const PACK_THEMES = Object.freeze({
  neophyte: Object.freeze({ frame: 'steel', title: 'light' }),
  portalLow: Object.freeze({ frame: 'steel', title: 'light' }),
  portalHigh: Object.freeze({ frame: 'gold', title: 'pink' }),
  summoner: Object.freeze({ frame: 'violet', title: 'pink' }),
  archmage: Object.freeze({ frame: 'gold', title: 'gold' }),
});

/** Number of card paintings side by side in a banner's art. */
export const BANNER_ARTS = 4;

/** Where each main pack starts in the list of its rarest cards, so the banners differ. */
const SHOWCASE_OFFSET = { neophyte: 0, summoner: 1, archmage: 6, portalLow: 0, portalHigh: 0 };

/**
 * The card paintings of a banner (the original banners were painted group scenes of the pack's cards): for a portal
 * pack the portal's own cards (rarest first for the high pack, least rare first for the low one), for a main pack
 * the rarest main-set cards it can give.
 * @param {object} ctx
 * @param {object} offer
 * @returns {object[]} card defs
 */
function showcaseCards(ctx, offer) {
  let pool;
  try {
    pool = boosterPool(ctx.deps, offer.id, offer.portalId);
  } catch (err) {
    return [];
  }
  const rarest = pool.slice().reverse();
  let portal = [...new Set(rarest.flatMap((e) => e.portal))].filter((d) => d.art);
  if (offer.id === 'portalLow') portal = portal.slice().reverse();
  const main = [...new Set(rarest.flatMap((e) => e.main))].filter((d) => d.art);
  const start = SHOWCASE_OFFSET[offer.id] || 0;
  const out = portal.slice(0, BANNER_ARTS);
  for (let i = 0; out.length < BANNER_ARTS && i < main.length; i++) {
    const d = main[(start + i) % main.length];
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(0, BANNER_ARTS);
}

/**
 * Painting of a card for a banner: its last fusion stage (the most elaborate art).
 * @param {object} ctx
 * @param {object} def
 * @returns {string|null}
 */
function bannerArtUrl(ctx, def) {
  const stages = Object.keys(def.art || {}).map(Number).filter((n) => Number.isFinite(n));
  return ctx.view.artUrlFor(def, stages.length ? Math.max(...stages) : 0);
}

/**
 * One framed booster banner (boosterlist_entry_comp with the booster_template / booster_pre_template layout): the
 * pack's painting in the ornate frame, the title on its plate, "May contain:" with the rarity squares, "Look inside"
 * and the token count; a pre-package shows "Coming soon:" with the countdown instead and cannot be opened.
 * @param {object} ctx
 * @param {object} offer  entry of shopOffers().boosters
 * @param {object[]} countdowns  collects {el, endsAt} for the ticking timers
 * @returns {HTMLElement}
 */
function boosterBanner(ctx, offer, countdowns) {
  const theme = PACK_THEMES[offer.id] || PACK_THEMES.neophyte;
  const open = () => {
    if (offer.pre) return; // boosterlist_entry_comp boosterTapped: nothing happens for a pre-package
    ctx.sfx('open');
    ctx.go('booster-open', { booster: offer.id, portalId: offer.portalId }, { transition: 'fade' });
  };
  const timer = (label, ms, cls) => {
    const endsAt = ctx.now() + ms;
    const val = h('span.num', null, formatCountdown(ms));
    countdowns.push({ el: val, endsAt });
    return h(cls, null, h('span.pack-timer-label', null, label), val);
  };
  const arts = showcaseCards(ctx, offer).map((d, i) => h('div.pack-art-slice', {
    class: `rarity-${d.rarity}`, style: { '--i': String(i), '--art': `url('${bannerArtUrl(ctx, d)}')` }, title: d.name,
  }));
  const squares = h('span.pack-squares', null, offer.mayContain.map((r) => h('span.pack-square', { class: `rarity-${r}`, title: capitalize(r) })));
  // the pack's token with the count while the player holds some (tokenAmountLbl); a pre-package shows its token
  const tokens = h('div.pack-tokens', { class: offer.tokens > 0 ? 'has' : 'none', title: offer.tokens > 0 ? `${offer.tokens} tokens` : undefined },
    offer.pre || offer.tokens > 0 ? tokenImage(offer.id) : null, offer.tokens > 0 ? h('span.num', null, fmt(offer.tokens)) : null);
  let center;
  if (!offer.pre) {
    center = h('button.pack-look', { type: 'button', onClick: (ev) => { ev.stopPropagation(); open(); } }, 'Look inside');
  } else if (offer.startsInMs > 0) {
    center = timer('Coming soon:', offer.startsInMs, 'div.pack-soon');
  } else {
    center = h('div.pack-soon', null, h('span.pack-timer-label', null, 'Coming soon'));
  }
  return h('div.pack-banner', {
    class: [`theme-${theme.frame}`, `title-${theme.title}`, offer.portalId ? 'portal' : 'main', offer.pre && 'pre'],
    dataset: { booster: offer.id, portal: offer.portalId || undefined, pre: offer.pre ? '1' : undefined },
    ...(offer.pre ? { 'aria-label': `${offer.name}: coming soon` } : {
      role: 'button', tabIndex: 0, 'aria-label': `${offer.name}: look inside`, onClick: open, onKeydown: keyActivate(open),
    }),
  },
  h('div.pack-art', null, arts),
  h('div.pack-frame'),
  h('div.pack-title', null, h('span.pack-title-text', null, offer.name)),
  !offer.pre && offer.endsInMs > 0 ? timer('Offer ends in', offer.endsInMs, 'div.pack-timer') : null,
  offer.discounted && !offer.pre ? h('div.pack-sale', null, '−50 %') : null,
  h('div.pack-foot', null,
    h('div.pack-contains', null, h('span.pack-contains-label', null, 'May contain:'), squares),
    center,
    tokens));
}

/**
 * The shop offers priced for the screen's event (ctx.event(): the daily event on the save's clock, which follows
 * debug.addDays) instead of the one shopOffers derives from the real clock: booster prices, the "-50 %" badges
 * and the Great Potion Deal.
 * @param {object} offers  shopOffers() result
 * @param {object} state
 * @param {number} now
 * @param {object|null} event
 * @returns {object}
 */
export function offersForEvent(offers, state, now, event) {
  if (event === undefined) return offers;
  return {
    ...offers,
    event,
    boosters: offers.boosters.map((b) => ({ ...b, price: boosterPrice(b.id, event), discounted: eventId(event) === 'get-the-best-cards' })),
    potionDeal: potionDealAvailable(state, now, event) ? { gems: POTION_DEAL_GEMS, potions: POTION_DEAL_COUNT } : null,
  };
}

/**
 * Great Potion Deal panel (event day only).
 * @param {object} ctx
 * @param {{gems: number, potions: number}} deal
 * @returns {HTMLElement}
 */
function potionDealPanel(ctx, deal) {
  const gems = ctx.store.get().player.gems;
  const canPay = gems >= deal.gems;
  const buy = async () => {
    const ok = await ctx.ui.dialog.confirm({
      title: 'Great Potion Deal',
      message: h('span', null, 'Buy 2 stamina potions and 1 mana potion for ', h('span.deal-price-wrap', null, h('span.gem-price.deal-price', null, fmt(deal.gems), sprite('hud_gemiconsingle', { class: 'icon' })), '?')),
      okLabel: 'Buy',
    });
    if (!ok) return;
    try {
      ctx.store.update((s, deps, now) => buyPotionDeal(s, now, ctx.event()));
      ctx.sfx('buyPotions');
      ctx.ui.toast('3 potions added to your bag!', { icon: 'potion-orange' });
      ctx.rerender();
    } catch (err) {
      ctx.ui.toast(err.message);
    }
  };
  return h('div.shop-item.shop-deal.panel', null,
    h('div.shop-token.potions', null, icon('potion-orange', { class: 'shop-potion' }), icon('potion-orange', { class: 'shop-potion' }), icon('potion-blue', { class: 'shop-potion blue' })),
    h('div.shop-info', null,
      h('div.shop-name', null, 'Great Potion Deal'),
      h('div.shop-pool', null, `${deal.potions} potions (2 stamina + 1 mana) for ${fmt(deal.gems)} gems, today only.`)),
    h('div.shop-buy', null,
      h('span.shop-price', null, h('span.num', null, fmt(deal.gems)), icon('gem')),
      button('Buy', { onClick: buy, disabled: !canPay, size: 'sm', variant: canPay ? 'green' : 'grey' })));
}

/**
 * @param {object} ctx  ScreenContext (architecture §8.1)
 */
export function render(ctx) {
  ctx.chrome.mount({ active: 'shop', back: true, help: 'shop' });
  const state = ctx.store.get();
  const offers = offersForEvent(shopOffers(state, ctx.deps, ctx.now()), state, ctx.now(), ctx.event());
  const countdowns = [];

  const body = h('div.screen-body.shop', null,
    h('button.shop-topbanner', { type: 'button', onClick: () => openGemShop(ctx) },
      sprite('shop_gems01', { class: 'shop-topbanner-img' }),
      h('span.shop-topbanner-text', null, 'Need more Tokens?', h('br'), 'Visit the Shop!')),
    offers.potionDeal ? potionDealPanel(ctx, offers.potionDeal) : null,
    offers.boosters.map((o) => boosterBanner(ctx, o, countdowns)),
    h('button.shop-link.panel', { type: 'button', onClick: () => ctx.go('collections', {}) },
      icon('trophy'), h('span.grow', null, 'Set collections'), h('span.muted', null, 'Complete a set for gems'), icon('arrow-right')));
  ctx.root.appendChild(body);

  if (countdowns.length) {
    const tick = () => {
      if (!body.isConnected) { clearInterval(id); return; }
      const now = ctx.now();
      for (const c of countdowns) c.el.textContent = formatCountdown(c.endsAt - now);
    };
    const id = setInterval(tick, 1000);
  }
  if (ctx.params && ctx.params.gems) {
    ctx.params.gems = false;
    openGemShop(ctx);
  }
}

/** Screen registry entry (src/ui/screens/index.js). */
export const screen = { render };
