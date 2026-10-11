'use strict';
/**
 * Booster screen (noChrome), a port of the 1.7.4 ui.screens.booster.openbooster_screen / openbooster_def /
 * boostercard_comp: the cavern (cardshop_background_01) with a top bar of its own (topbar_bg: back arrow, gem
 * count, token count, green refresh button) and the pack's nine cards in a 3×3 grid.
 * - A sealed booster plays the opening first: the glowing pack on the altar under a beam of light grows and
 *   bursts, and the nine flipcard backs fly into the grid (cardbooster_start).
 * - Each face-down card shows what the next pick costs: the pack's token and "1" while the player has tokens,
 *   else the gem icon and the pack's gem price (getCostsFromBoosterData). Tapping one pays (tryDrawCard; "You
 *   need more Gems to get a booster card!" when short), flips it with a flash, zooms it to the centre in its
 *   rarity frame (playDrawCardAnimation), drops the "Card added to set: <set> n/8" plate for a card new to its
 *   set (new_card_notify_def), and on a tap settles it face up into its grid slot.
 * - A drawn card opens the card detail when tapped. The refresh button, and the last pick, ask "Do you want to
 *   open a new booster?" (showDiscardWarningOverlay); OK discards the rest and seals a fresh booster.
 *
 * params: { booster, portalId? }   (the booster stays in the save between visits)
 */
import { h, fmt, wait, sprite, spriteUrl } from '../dom.js';
import { button } from '../components/buttons.js';
import { renderCard, glowSpriteFor } from '../components/card.js';
import { openBooster, drawBoosterCard, discardBooster, pickPayment, getBooster, BOOSTERS } from '../../game/shop.js';
import { questLine } from '../../game/quests.js';
import { boosterGrid, boosterFinished, setProgressPercent, rarityGlowVar } from './booster-view.js';
import { tokenImage, notEnoughGems } from './shop.js';

/** Grid geometry on the 720×1280 stage (openbooster_def: three columns, three rows over the cavern). */
const CELL_W = 196;
const CELL_H = 278;
const COL_X = [124, 360, 596];
const ROW_Y = [352, 672, 992];
/** Centre and scale of the zoomed card (detail card 600 px wide). */
const REVEAL = { x: 360, y: 650, scale: 0.84, width: 600, height: 829 };
/** The altar in the background painting, where the sealed pack rests. */
const ALTAR = { x: 360, y: 820 };

/**
 * @param {object} ctx  ScreenContext
 */
export function render(ctx) {
  const params = ctx.params || {};
  const id = params.booster;
  const def = BOOSTERS[id];
  const portalId = def && def.portal ? params.portalId : undefined;
  const reduced = Boolean(ctx.store.get().settings && ctx.store.get().settings.reducedMotion);
  const pause = (ms) => (reduced ? Promise.resolve() : wait(ms));

  const body = h('div.screen-body.booster-open', { class: reduced && 'reduced' });
  ctx.root.appendChild(body);

  let entered = null;
  if (def && (!def.portal || questLine(ctx.deps, portalId))) {
    try {
      entered = ctx.store.update((s, deps, now) => openBooster(s, deps, now, { booster: id, portalId }));
    } catch (err) {
      entered = null;
    }
  }
  if (!entered) {
    body.appendChild(h('div.booster-error.panel', null,
      h('p', null, 'This booster could not be opened.'),
      button('Back to shop', { onClick: () => ctx.back('shop') })));
    return;
  }

  const line = portalId ? questLine(ctx.deps, portalId) : null;
  const title = line ? `${line.tokens[id === 'portalLow' ? 'low' : 'high'].name.replace(/ token$/i, '')} Pack` : def.name;

  /* ---------------- top bar ---------------- */
  const gemsVal = h('span.num');
  const tokensVal = h('span.num');
  const back = h('button.hud-btn.booster-backbtn', { type: 'button', 'aria-label': 'Back', title: 'Back', onClick: () => ctx.back('shop') },
    sprite('back_icon_active', { class: 'hud-btn-icon' }));
  const reset = h('button.booster-reset', { type: 'button', 'aria-label': 'New booster', title: 'New booster', onClick: () => askNewBooster() },
    sprite('refresh', { class: 'booster-reset-icon' }));
  const topBar = h('div.booster-topbar', null,
    back,
    h('div.booster-res.gems', { title: 'Gems' }, sprite('hud_gemicon01', { class: 'booster-res-img' }), gemsVal),
    h('div.booster-res.tokens', { title: `${title} tokens` }, tokenImage(id, 'booster-res-img'), tokensVal),
    reset);

  /* ---------------- grid ---------------- */
  const grid = h('div.booster-grid', { 'aria-label': title });
  const layer = h('div.booster-layer');
  body.append(topBar, h('div.booster-name', null, title), grid, layer);

  let busy = false;
  /** @type {HTMLElement[]} */
  let cells = [];

  const booster = () => getBooster(ctx.store.get(), id, portalId);
  const payment = () => pickPayment(ctx.store.get(), id, portalId, ctx.event());

  function updateBar() {
    const p = payment();
    gemsVal.textContent = String(p.gems);
    tokensVal.textContent = String(p.tokens);
  }

  /**
   * Cost overlay of a face-down card (token "1" or gem price).
   * @param {{type: string, amount: number}} cost
   * @returns {HTMLElement}
   */
  function costNode(cost) {
    return h('span.booster-cost', { class: cost.type },
      cost.type === 'token' ? tokenImage(id, 'booster-cost-img') : sprite('hud_gemiconsingle', { class: 'booster-cost-img' }),
      h('span.num', null, String(cost.amount)));
  }

  /**
   * Face-up thumbnail of a drawn card in its slot (art in the rarity-coloured frame).
   * @param {string} cardId
   * @returns {HTMLElement}
   */
  function faceUp(cardId) {
    const d = ctx.db.get(cardId);
    const art = d ? ctx.view.artUrlFor(d, 0) : null;
    return h('div.booster-face', { class: `rarity-${d ? d.rarity : 'common'}` },
      art ? h('img', { src: art, alt: d.name, draggable: 'false' }) : null,
      h('span.booster-face-name', null, d ? d.name : cardId));
  }

  /** (Re)build the nine cells from the save. */
  function buildGrid() {
    const b = booster();
    const model = boosterGrid(b, payment());
    grid.textContent = '';
    cells = model.map((c) => {
      const cell = h('button.booster-cell', {
        type: 'button',
        class: c.drawn ? 'drawn' : 'booster-back',
        dataset: { index: String(c.position) },
        'aria-label': c.drawn ? `${ctx.db.get(c.cardId) ? ctx.db.get(c.cardId).name : 'Card'} (drawn)` : `Card ${c.position + 1}`,
        style: {
          left: `${COL_X[c.col] - CELL_W / 2}px`, top: `${ROW_Y[c.row] - CELL_H / 2}px`,
          '--fx': `${ALTAR.x - COL_X[c.col]}px`, '--fy': `${ALTAR.y - ROW_Y[c.row]}px`,
          '--delay': `${(c.row * 3 + c.col) * 55}ms`,
        },
      }, c.drawn ? faceUp(b.cards[c.position]) : [h('div.booster-back-face'), costNode(c.cost)]);
      grid.appendChild(cell);
      return cell;
    });
    updateBar();
  }

  /** Refresh the price labels after a pick (token → gems when the last token is spent). */
  function refreshCosts() {
    const p = payment();
    for (const cell of cells) {
      if (cell.classList.contains('drawn')) continue;
      const old = cell.querySelector('.booster-cost');
      if (old) old.replaceWith(costNode(p));
    }
    updateBar();
  }

  /* ---------------- opening (sealed booster) ---------------- */
  async function playOpening() {
    busy = true;
    grid.classList.add('sealed');
    topBar.classList.add('faded');
    const intro = h('div.booster-intro', { 'aria-hidden': 'true' },
      h('div.booster-beam'),
      h('div.booster-chest', null, sprite('flipcard', { class: 'booster-chest-card' }), h('div.booster-chest-glow')));
    layer.appendChild(intro);
    ctx.sfx('boosterOpen');
    let skip = false;
    const onSkip = () => { skip = true; };
    intro.addEventListener('click', onSkip);
    const step = async (ms) => { if (!skip) await pause(ms); };
    await step(700);
    intro.classList.add('grow');
    await step(650);
    intro.classList.add('burst');
    await step(220);
    intro.remove();
    grid.classList.remove('sealed');
    grid.classList.add('dealing');
    ctx.sfx('shuffle');
    topBar.classList.remove('faded');
    ctx.store.update((s, deps, now) => openBooster(s, deps, now, { booster: id, portalId, open: true }));
    await pause(skip ? 0 : 900);
    grid.classList.remove('dealing');
    busy = false;
  }

  /* ---------------- drawing a card ---------------- */
  async function pick(index) {
    if (busy) return;
    const b = booster();
    if (!b || b.drawn.includes(index)) return;
    const pay = payment();
    if (!pay.canPay) {
      await notEnoughGems(ctx);
      updateBar();
      return;
    }
    let result;
    try {
      result = ctx.store.update((s, deps, now) => drawBoosterCard(s, deps, now, { booster: id, portalId, position: index, event: ctx.event() }));
    } catch (err) {
      ctx.ui.toast(err.message);
      return;
    }
    busy = true;
    ctx.sfx('flip');
    const cell = cells[index];
    cell.classList.add('flash');
    refreshCosts();
    await pause(160);

    const cardDef = ctx.db.get(result.cardId);
    const view = ctx.view.defView(cardDef, 0, 1);
    const glow = glowSpriteFor(view.rarity);
    const col = index % 3;
    const row = Math.floor(index / 3);
    const fromScale = CELL_W / REVEAL.width;
    const reveal = h('div.booster-reveal', {
      class: [`rarity-${view.rarity}`, reduced && 'no-anim'],
      style: {
        '--glow': rarityGlowVar(view.rarity), '--glow-img': `url('${spriteUrl(glow)}')`,
        '--from-x': `${COL_X[col] - REVEAL.x}px`, '--from-y': `${ROW_Y[row] - REVEAL.y}px`,
        '--from-s': String(fromScale), '--to-s': String(REVEAL.scale),
      },
    },
    sprite('newcardglow', { class: 'booster-rays' }),
    h('div.booster-glow'),
    renderCard(view, { size: 'detail', showStats: false }),
    h('div.booster-sheen'));
    const shade = h('div.booster-shade');
    layer.append(shade, reveal);
    let plate = null;
    if (result.setAdded) {
      const sa = result.setAdded;
      plate = h('div.booster-setplate', null,
        h('div.booster-setplate-label', null, 'Card added to set:'),
        h('div.booster-setplate-name', null, sa.name),
        h('div.booster-setplate-bar', null,
          h('div.booster-setplate-fill', { style: { width: `${setProgressPercent(sa.owned, sa.total)}%` } }),
          h('span.booster-setplate-count.num', null, `${sa.owned}/${sa.total}`)));
      layer.appendChild(plate);
    }
    cell.textContent = '';
    cell.classList.remove('flash', 'booster-back');
    cell.classList.add('drawn', 'pending');
    cell.appendChild(faceUp(result.cardId));
    cell.setAttribute('aria-label', `${view.name} (drawn)`);
    if (result.converted) {
      ctx.ui.toast(`Collection full: ${view.name} sold for ${fmt(result.gold)} gold`, { icon: 'coin', duration: 3500 });
    }

    // settle on a tap (or after a while)
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(t); layer.removeEventListener('click', finish); resolve(); };
      const t = setTimeout(finish, reduced ? 1500 : 3200);
      setTimeout(() => layer.addEventListener('click', finish), reduced ? 0 : 350);
    });
    ctx.sfx('take');
    reveal.classList.add('settle');
    shade.classList.add('out');
    if (plate) plate.classList.add('out');
    await pause(380);
    reveal.remove();
    shade.remove();
    if (plate) plate.remove();
    cell.classList.remove('pending');
    busy = false;
    if (result.remaining === 0) askNewBooster();
  }

  /* ---------------- new booster ---------------- */
  async function askNewBooster() {
    if (busy) return;
    busy = true;
    const ok = await ctx.ui.dialog.open({
      className: 'shop-warning',
      body: h('div.shop-warning-body', null, sprite('fx_alldieskull01', { class: 'shop-warning-img skull' }), h('p', null, 'Do you want to open a new booster?')),
      buttons: [{ label: 'Ok', value: true, variant: 'green', autofocus: true }],
    });
    if (!ok) { busy = false; return; }
    ctx.sfx('shuffle');
    grid.classList.add('discarding');
    await pause(650);
    try {
      ctx.store.update((s, deps, now) => discardBooster(s, deps, now, { booster: id, portalId }));
    } catch (err) {
      ctx.ui.toast(err.message);
    }
    grid.classList.remove('discarding');
    buildGrid();
    busy = false;
    await playOpening();
  }

  grid.addEventListener('click', (ev) => {
    const target = ev.target instanceof Element ? ev.target.closest('.booster-cell') : null;
    if (!target || busy) return;
    const index = Number(target.dataset.index);
    if (target.classList.contains('drawn')) {
      const b = booster();
      if (b && b.cards[index]) ctx.go('card-detail', { cardId: b.cards[index], stage: 0, level: 1 });
      return;
    }
    pick(index);
  });

  buildGrid();
  if (entered.fresh && !reduced) playOpening();
  else if (entered.fresh) ctx.store.update((s, deps, now) => openBooster(s, deps, now, { booster: id, portalId, open: true }));
  else if (boosterFinished(booster())) setTimeout(() => { if (body.isConnected) askNewBooster(); }, 300);
}

/** Screen registry entry (src/ui/screens/index.js). */
export const screen = { render, noChrome: true };
