'use strict';
/**
 * Pieces tab of the Arena screen (ctrl_pvp_piece_list): the 4 x 2 grid of hunted cards with the original puzzle
 * overlays (piece{N}_{i}.png outline = owned, ...b.png = missing) and a hud_quadbutton attack button (fight_icon)
 * under each; empty slots show cardslot01 + addcard_icon (buy a first piece). The attack button opens the
 * holder's info popup (comp_enemyinfo_popup) with Fight and "Reroll opponent" (gems); the card opens its pieces
 * with the buy-the-rest button (comp_piece_assemble_money_popup).
 */
import { h, fmt, clear, sprite, keyActivate } from '../dom.js';
import { renderCard } from '../components/card.js';
import { huntHolder, fightHolder, skipHolder, buyMissingPieces, buyFirstPiece, huntBuyPrice, MAX_HUNTS, SKIP_GEMS, FIRST_PIECE_GEMS, FIRST_PIECE_GEMS_EVENT } from '../../game/pieces.js';
import { getSim, pvpManaCost, simInfo } from '../../game/opponents.js';
import { eventId } from '../../game/player.js';
import { pieceLayout, pieceSpriteLayout, huntProgress } from './pvp-puzzle.js';
import { opponentPreview, withFightXp } from './pvp-view.js';
import { showSimInfo } from './pvp-widgets.js';

/** Card boxes of the pieces grid and of the piece popup (stage px, the client's thumb ratio). */
const PUZZLE_SMALL = { w: 156, h: 182 };
const PUZZLE_LARGE = { w: 315, h: 447 };
const NO_HOLDER = 'Sorry, there is no opponent with your needed card-piece.';

/**
 * Puzzle card: the art under the original piece overlays (outline = owned, dark = missing); hunts of a piece
 * count the client has no sprites for use clip-path pieces cut from the art.
 * @param {object} def  card definition
 * @param {{owned: number, total: number}} hunt
 * @param {{w: number, h: number}} size
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function renderPuzzle(def, hunt, size, ctx) {
  const url = ctx.view.artUrlFor(def, 0);
  const el = h('div.puzzle', { class: `rarity-${def.rarity}`, style: { width: `${size.w}px`, height: `${size.h}px` } });
  const sprites = pieceSpriteLayout(hunt.total, hunt.owned);
  if (sprites) {
    el.classList.add('sprite-pieces');
    if (url) el.appendChild(h('img.puzzle-art', { src: url, alt: '', draggable: 'false', loading: 'lazy' }));
    for (const p of sprites) {
      el.appendChild(sprite(p.sprite, {
        class: ['puzzle-piece', p.owned ? 'owned' : 'missing'],
        dataset: { piece: String(p.index) },
        style: { left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%` },
      }));
    }
    return el;
  }
  const pieces = pieceLayout(hunt.total, hunt.owned, size.w, size.h);
  for (const p of pieces) {
    el.appendChild(h('div.puzzle-piece', {
      class: p.owned ? 'owned' : 'missing',
      dataset: { piece: String(p.index) },
      style: {
        left: `${p.box.x}px`, top: `${p.box.y}px`, width: `${p.box.w}px`, height: `${p.box.h}px`,
        clipPath: p.polygon,
        backgroundImage: url ? `url("${url}")` : 'none',
        backgroundSize: `${size.w}px ${size.h}px`,
        backgroundPosition: `${p.bgX}px ${p.bgY}px`,
      },
    }));
  }
  return el;
}

/**
 * The Pieces tab.
 * @param {object} ctx  ScreenContext
 * @returns {HTMLElement}
 */
export function renderPiecesTab(ctx) {
  const grid = h('div.pieces-grid');
  const event = ctx.event();

  function paint() {
    const state = ctx.store.get();
    const list = state.pieces || [];
    clear(grid);
    for (let i = 0; i < MAX_HUNTS; i++) {
      const hunt = list[i];
      const def = hunt && ctx.deps.db.get(hunt.cardId);
      if (hunt && def) {
        const prog = huntProgress(hunt);
        grid.appendChild(h('div.piece-slot.hunt', { dataset: { slot: String(i), cardId: def.id } },
          h('div.piece-card', {
            role: 'button', tabIndex: 0, 'aria-label': `${def.name}: ${prog.text} pieces`, title: `${def.name}  ${prog.text}`,
            onClick: () => openPieces(i), onKeydown: keyActivate(() => openPieces(i)),
          }, renderPuzzle(def, hunt, PUZZLE_SMALL, ctx)),
          h('button.piece-attack', { type: 'button', 'aria-label': `Attack for a piece of ${def.name}`, title: 'Attack', onClick: () => openHolder(i) },
            sprite('fight_icon_active', { class: 'piece-attack-icon' }))));
      } else {
        const price = eventId(event) === 'card-piece-day' ? FIRST_PIECE_GEMS_EVENT : FIRST_PIECE_GEMS;
        grid.appendChild(h('div.piece-slot.empty', { dataset: { slot: String(i) } },
          h('button.piece-add', { type: 'button', 'aria-label': `Get a card piece for ${price} gems`, title: 'Get an awesome new card piece.', onClick: () => buyFirst(price) },
            sprite('addcard_icon', { class: 'piece-add-icon' })),
          h('button.piece-get', { type: 'button', 'aria-label': `Buy a card piece: ${price} gems`, onClick: () => buyFirst(price) },
            sprite('getcardpiece_icon', { class: 'piece-get-icon' }), h('span.num', null, fmt(price)), sprite('hud_gemicon01', { class: 'piece-gem' }))));
      }
    }
  }

  /** Holder info popup (comp_enemyinfo_popup with Fight and "Reroll opponent"). */
  async function openHolder(index) {
    let state = ctx.store.get();
    const hh = huntHolder(state, ctx.deps, ctx.now(), index);
    if (hh.state !== state) ctx.store.update(() => hh.state);
    state = ctx.store.get();
    const hunt = state.pieces[index];
    const sim = hunt && getSim(state, hunt.holderId);
    if (!sim) {
      const def = hunt && ctx.deps.db.get(hunt.cardId);
      const ok = await ctx.ui.dialog.confirm({ title: 'Pieces', message: `${NO_HOLDER} Would you like to assemble it now?`, okLabel: 'Assemble' });
      if (ok && def) buyMissing(index, def);
      return;
    }
    ctx.sfx('ui_button_circular');
    const r = await showSimInfo(simInfo(sim, ctx.deps), ctx, { rerollGems: SKIP_GEMS });
    if (r === 'attack') attackHolder(index);
    if (r === 'reroll') { if (await skip(index)) openHolder(index); }
  }

  /** The hunted card with its pieces and the buy-the-rest button. */
  async function openPieces(index) {
    const state = ctx.store.get();
    const hunt = state.pieces[index];
    const def = hunt && ctx.deps.db.get(hunt.cardId);
    if (!def) return;
    const prog = huntProgress(hunt);
    const price = huntBuyPrice(state, ctx.deps, index, event);
    ctx.sfx('ui_button_card');
    const choice = await ctx.ui.dialog.open({
      title: def.name,
      className: 'dialog-piece-detail',
      body: h('div.piece-detail', { class: `rarity-${def.rarity}`, dataset: { cardId: def.id } },
        renderPuzzle(def, hunt, PUZZLE_LARGE, ctx),
        h('div.piece-detail-count', null, sprite('cardpiece_icon', { class: 'piece-detail-icon' }), h('span.num', null, prog.text))),
      buttons: [
        ...(prog.missing > 0 ? [{ label: h('span.gem-price', null, `Complete: ${fmt(price)}`, sprite('hud_gemicon01')), value: 'buy', variant: 'green' }] : []),
        { label: 'Attack', value: 'attack', autofocus: true },
      ],
    });
    if (choice === 'buy') buyMissing(index, def);
    if (choice === 'attack') openHolder(index);
  }

  function attackHolder(index) {
    const state = ctx.store.get();
    const hunt = state.pieces[index];
    const sim = hunt && getSim(state, hunt.holderId);
    if (!sim) { ctx.ui.toast(NO_HOLDER); return; }
    const def = ctx.deps.db.get(hunt.cardId);
    const cardId = hunt.cardId;
    ctx.sfx('tap');
    ctx.go('prebattle', {
      mode: 'pieces',
      title: sim.name,
      opponent: opponentPreview(sim, ctx.deps, 1, ctx.view),
      manaCost: pvpManaCost(state, ctx.deps),
      fight: () => {
        const ev = ctx.event();
        const info = ctx.store.update((s, deps, now) => fightHolder(s, deps, now, { index, event: ev }));
        return withFightXp(info, sim, 1, ctx.deps, ev);
      },
      onDone: async (info) => {
        ctx.params.tab = 'pieces';
        await ctx.back('arena');
        // the result screen already showed the piece / the completed card (battle-result sets rewardShown)
        if (info && info.rewardShown) return;
        if (info && info.completed) celebrate(ctx, cardId);
        else if (info && info.won) ctx.ui.toast(`You won a piece of ${def ? def.name : 'the card'}!`, { icon: 'cards' });
      },
    });
  }

  /** "Reroll opponent" for gems (the client's rematchCardPieceEnemy). Resolves true when a new holder was found. */
  async function skip(index) {
    const state = ctx.store.get();
    if (state.player.gems < SKIP_GEMS) { ctx.ui.toast('You need more Gems to get a new enemy!', { icon: 'gem' }); return false; }
    try {
      ctx.store.update((s, deps, now) => skipHolder(s, deps, now, index));
    } catch (err) { ctx.ui.toast(String(err && err.message || err)); return false; }
    ctx.sfx('gremlin');
    paint();
    return true;
  }

  async function buyMissing(index, def) {
    const state = ctx.store.get();
    const prog = huntProgress(state.pieces[index]);
    const price = huntBuyPrice(state, ctx.deps, index, event);
    if (state.player.gems < price) { ctx.ui.toast(`You need ${fmt(price)} gems.`, { icon: 'gem' }); return; }
    const ok = await ctx.ui.dialog.confirm({
      title: 'Buy pieces',
      message: `Buy the ${prog.missing} missing piece${prog.missing === 1 ? '' : 's'} of ${def.name} for ${fmt(price)} gems?`,
      okLabel: 'Buy',
    });
    if (!ok) return;
    try {
      ctx.store.update((s, deps, now) => buyMissingPieces(s, deps, now, { index, event: ctx.event() }));
    } catch (err) { ctx.ui.toast(String(err && err.message || err)); return; }
    ctx.sfx('buy');
    paint();
    celebrate(ctx, def.id);
  }

  async function buyFirst(price) {
    const state = ctx.store.get();
    if ((state.pieces || []).length >= MAX_HUNTS) { ctx.ui.toast('All piece slots are in use.'); return; }
    if (state.player.gems < price) { ctx.ui.toast('You need more Gems to get a new card-piece!', { icon: 'gem' }); return; }
    const ok = await ctx.ui.dialog.confirm({ title: 'Get more', message: `Get an awesome new card piece for ${fmt(price)} gems?`, okLabel: 'Buy' });
    if (!ok) return;
    let info;
    try {
      info = ctx.store.update((s, deps, now) => buyFirstPiece(s, deps, now, { event: ctx.event() }));
    } catch (err) { ctx.ui.toast(String(err && err.message || err)); return; }
    ctx.sfx('buy');
    const def = info && ctx.deps.db.get(info.cardId);
    paint();
    ctx.ui.toast(def ? `Random card piece received: ${def.name}` : 'Random card piece received', { icon: 'cards' });
  }

  paint();
  return h('div.pieces-tab', null, grid);
}

/**
 * Full-card celebration popup when a hunt completes.
 * @param {object} ctx
 * @param {string} cardId
 * @returns {Promise<any>}
 */
function celebrate(ctx, cardId) {
  const def = ctx.deps.db.get(cardId);
  if (!def) return Promise.resolve();
  const view = ctx.view.defView(def, 0, 1);
  const body = h('div.piece-celebrate', { class: `rarity-${def.rarity}` },
    h('div.celebrate-glow'),
    h('div.celebrate-sparks', null, Array.from({ length: 10 }, (_, i) => h('span.spark', { style: { '--i': String(i) } }))),
    renderCard(view, { size: 'compact', className: 'celebrate-card' }),
    h('div.celebrate-name', null, def.name),
    h('p.celebrate-text', null, 'All pieces collected! The card has been added to your collection.'));
  ctx.sfx('fanfare');
  return ctx.ui.dialog.open({ title: 'Card complete!', body, className: 'dialog-celebrate', buttons: [{ label: 'Great!', value: true, variant: 'green', autofocus: true }] });
}
