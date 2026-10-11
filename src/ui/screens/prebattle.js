'use strict';
/**
 * Pre-battle (deck placement) screen - architecture.md §8.4 step 2, brief §4.5.
 * Shared by quests, arena, pieces and league.
 *
 * params = { mode, title, opponent, manaCost, fight, onDone, theme? }
 *   opponent = { name, portraitUrl, level, hp, maxHp, faceDown, cards: (cardView|null)[5] }
 *   fight()  runs the game function through the store and returns its info (`{ battle: {events, result}, ... }`)
 *   onDone(info) is called by the battle screen after the result popup
 *
 * Layout like the original's scene_bossprepare / scene_pvp_prepare (dressed with the client's sprites,
 * css/screens/prebattle.css), under the normal HUD and bottom nav: the opponent row (face-up cards or card
 * backs in cardslot01 recesses), the Attack! bar (attackbutton01 on the attackbuttonornament01 flames over a
 * seperator_big band), the player row of 5 deck slots (cardslotlocked on locked slots). No HP bars and no
 * tribe-bonus line (both are revealed inside the fight, DECISIONS D5). PvP adds the opponent's name above
 * the enemy row, the player's name above the deck and the "Mana needed: x / y" bar (scene_pvp_prepare's
 * enemyName / playerDeckLabel / manabar); the boss pre-battle has neither. Our addition: the collection
 * drawer below the deck for drag-and-drop (the original edited the deck on the Deck screen only).
 *
 * Attack! runs the fight function and opens the battle screen, which plays the original entry (HUD slides
 * in, "Loading..." strip, the fx_lightning flash over the middle) and the tribe-bonus moment. The deck's card
 * levels / XP before the fight go along as `before` for the post-battle card XP bars.
 *
 * Boss fights come from the boss intro without a transition and with `params.intro` = { slot, artUrl, rarity,
 * from: {x, y, w, h}, ms }: the intro's card shrinks and flies from `from` (screen-body px) into its slot of the
 * enemy row with a blue lightning trail (reOM @ 5:28: ~0.35 s), then the Attack! bar opens from the middle
 * (~0.4 s) and the button pops in. Until then the slot's own card and the bar are hidden.
 * The intro plays once: `params.intro` is cleared as it starts, so a rebuild of the screen (back from a card
 * view, rerender) shows the landed state instead of a replay.
 *
 * Sounds: ui_button_attack on Attack!, ui_decksetup_card_place / ui_decksetup_card_remove
 * when a card is dropped into or out of the deck.
 */
import { h, spriteUrl, wait } from '../dom.js';
import { renderCard } from '../components/card.js';
import { manaNeededBar } from '../components/bars.js';
import { attackBar } from '../components/buttons.js';
import { createDragDrop } from '../components/drag-drop.js';
import { placeInDeck, removeFromDeck } from '../../game/collection.js';
import { deckCards, deckMana, slotUnlocked } from '../../game/state.js';
import { needsPotion, drinkPotion, buyAndDrinkPotion } from '../../game/player.js';
import { themeFor } from './battle.js';

const PVP_MODES = ['arena', 'pieces', 'league', 'pvp'];

/** Nav button to highlight for a fight mode. */
function navFor(mode) {
  if (mode === 'arena' || mode === 'pieces') return 'arena';
  if (mode === 'league') return 'league';
  return 'quest';
}

/** Wait until the router is idle (a store-triggered rerender may be in flight). */
async function whenIdle(ctx) {
  for (let i = 0; i < 40 && ctx.router.busy; i++) await wait(25);
}

/**
 * Sort owned cards like the collection: level desc, mana desc, name.
 * @param {object[]} insts
 * @param {object} db
 */
function sortInstances(insts, db) {
  const mana = (c) => ((db.get(c.cardId) || {}).mana || 0);
  const name = (c) => ((db.get(c.cardId) || {}).name || c.cardId);
  return insts.slice().sort((a, b) => (b.level - a.level) || (mana(b) - mana(a)) || name(a).localeCompare(name(b)));
}

/**
 * Snapshot of the deck cards before a fight (for the post-battle XP bars).
 * @param {object} state
 * @returns {{uid: string, cardId: string, stage: number, level: number, xp: number}[]}
 */
export function deckSnapshot(state) {
  return deckCards(state).filter(Boolean).map((c) => ({ uid: c.uid, cardId: c.cardId, stage: c.stage | 0, level: c.level | 0, xp: Number(c.xp) || 0, evolveQuality: c.evolveQuality }));
}

/** @type {import('../router.js').Screen} */
export const screen = {
  /**
   * @param {object} ctx  ScreenContext (architecture.md §8.1)
   */
  render(ctx) {
    const p = ctx.params;
    const mode = p.mode || 'quest';
    const opponent = p.opponent || { name: 'Opponent', cards: [null, null, null, null, null] };
    const { db, deps, view, ui, sfx } = ctx;
    const toast = ui.toast;
    const theme = p.theme || themeFor(mode, p);
    const root = ctx.root;
    root.classList.add('prebattle-screen');
    root.dataset.theme = theme;

    ctx.chrome.mount({ active: navFor(mode), back: true, help: 'prebattle' });

    const body = h('div.screen-body.prebattle-body');
    body.appendChild(h('div.prebattle-bg', { class: theme }));
    root.appendChild(body);

    /* ---- opponent row ---- */
    const oppRow = h('div.card-row.panel.prebattle-row.opp');
    for (let i = 0; i < 5; i++) {
      const v = opponent.cards ? opponent.cards[i] : null;
      const slot = h('div.deck-slot.side-top.opp-slot', { 'aria-label': v ? v.name : 'Empty' });
      if (v) slot.appendChild(opponent.faceDown ? renderCard({ name: v.name || 'Hidden', tribe: v.tribe, rarity: v.rarity }, { size: 'back' }) : renderCard(v, { size: 'battle', side: 'top', interactive: !opponent.faceDown, onClick: () => ctx.go('card-detail', { cardId: v.cardId || v.id, stage: v.stage, level: v.level }) }));
      oppRow.appendChild(slot);
    }

    /* ---- player row, mana bar, drawer (rebuilt after every deck change) ---- */
    const playerRow = h('div.card-row.panel.prebattle-row.me');
    const drawer = h('div.prebattle-drawer');
    const drawerCards = h('div.prebattle-drawer-cards');
    const drawerEmpty = h('div.prebattle-drawer-empty', null, 'All your cards are in the deck.');
    const manaBar = manaNeededBar({ needed: 0, available: 0 });
    const manaIcon = manaBar.querySelector('img');
    if (manaIcon) manaIcon.src = spriteUrl('hud_manaicon01');
    // the marker lives inside the trough so the label can be drawn over it (the trough's drop shadow makes it
    // its own layer)
    const manaTrough = manaBar.querySelector('.bar');
    const manaMarker = manaBar.querySelector('.marker');
    if (manaTrough && manaMarker) manaTrough.appendChild(manaMarker);
    const pvp = PVP_MODES.includes(mode);
    const showMana = () => (p.manaCost > 0) || pvp;
    manaBar.classList.toggle('hidden', !showMana());

    function currentState() { return ctx.store.get(); }
    function deckViews(state) {
      return deckCards(state).map((inst) => (inst && db.get(inst.cardId) ? view.cardView(inst, db.get(inst.cardId)) : null));
    }
    function refresh() {
      const state = currentState();
      const views = deckViews(state);
      while (playerRow.firstChild) playerRow.removeChild(playerRow.firstChild);
      for (let i = 0; i < 5; i++) {
        const locked = !slotUnlocked(state, i);
        const slot = h('div.deck-slot.side-bottom', { class: locked && 'locked', dataset: { slot: String(i) }, 'aria-label': locked ? `Slot ${i + 1} (locked)` : `Slot ${i + 1}` });
        const v = views[i];
        if (v) slot.appendChild(renderCard(v, { size: 'battle', side: 'bottom', draggable: true, interactive: true }));
        playerRow.appendChild(slot);
      }
      // drawer: every owned card not in the deck
      while (drawerCards.firstChild) drawerCards.removeChild(drawerCards.firstChild);
      const others = sortInstances(state.cards.filter((c) => !state.deck.includes(c.uid) && db.get(c.cardId)), db);
      for (const inst of others) drawerCards.appendChild(renderCard(view.cardView(inst, db.get(inst.cardId)), { size: 'compact', draggable: true, interactive: true }));
      drawerEmpty.classList.toggle('hidden', others.length > 0);
      // mana needed by the deck (PvP), as scene_pvp_prepare's manabar: "Mana needed: deck / maximum", the
      // blue line = the mana the player has, the pinocle marker = the deck's cost (both of the maximum)
      const mana = deckMana(state, deps);
      const have = Number(state.player.mana) || 0;
      const max = Math.max(have, Number(state.player.manaMax) || have);
      manaBar.update(mana, max);
      manaBar.classList.toggle('over', mana > have);
      if (manaTrough) manaTrough.style.setProperty('--pct', (max > 0 ? Math.max(0, Math.min(1, have / max)) : 0).toFixed(4));
      const marker = manaBar.querySelector('.marker');
      if (marker) marker.style.setProperty('--pct', String(max > 0 ? Math.max(0, Math.min(1, mana / max)) : 0));
    }

    /* ---- drag and drop ---- */
    const update = (fn) => { try { return ctx.store.update(fn); } catch (err) { toast(err && err.message ? err.message : 'Cannot do that'); return undefined; } };
    const dnd = createDragDrop({
      container: root,
      getScale: ui.stage.getScale,
      canDrop: (info) => info.to !== null && slotUnlocked(currentState(), info.to),
      onDrop: (info) => {
        if (!info.uid || info.to === null) return;
        update((s, d) => placeInDeck(s, d || deps, info.uid, info.to));
        sfx('ui_decksetup_card_place');
        if (root.isConnected) refresh();
      },
      onDropOutside: (info) => {
        if (info.from === null || info.from === undefined) return;
        update((s) => removeFromDeck(s, info.from));
        sfx('ui_decksetup_card_remove');
        if (root.isConnected) refresh();
      },
      onDropInvalid: (info) => { if (info.to !== null) toast('This card slot is still locked.', { icon: 'lock' }); },
      onTap: (ev, el) => { if (el.dataset.uid) ctx.go('card-detail', { uid: el.dataset.uid }); },
    });
    root._dnd = dnd;

    /* ---- Attack! ---- */
    let attacking = false;
    async function attack() {
      if (attacking) return;
      const state = currentState();
      if (!state.deck.some(Boolean)) { toast('Place at least one card in your deck!', { icon: 'cards' }); return; }
      if (showMana()) {
        const mana = deckMana(state, deps);
        const need = needsPotion(state, 'mana', mana, ctx.event());
        if (need.needed) {
          const choice = await ui.dialog.drinkPotion({ kind: 'mana', count: need.potions, gemPrice: need.price, gems: state.player.gems });
          if (choice === 'use') update((s) => drinkPotion(s, 'mana'));
          else if (choice === 'buy') update((s) => buyAndDrinkPotion(s, 'mana', ctx.event()));
          else return;
          if (currentState().player.mana < mana) { toast('Not enough mana', { icon: 'mana-drop' }); return; }
        }
      }
      attacking = true;
      bar.setDisabled(true);
      sfx('ui_button_attack');
      const before = deckSnapshot(currentState());
      let info;
      try {
        info = await p.fight();
      } catch (err) {
        console.error(err);
        toast(err && err.message ? err.message : 'The fight could not start');
        attacking = false;
        bar.setDisabled(false);
        return;
      }
      if (!info || !info.battle || !Array.isArray(info.battle.events)) {
        toast('No battle to play');
        attacking = false;
        bar.setDisabled(false);
        return;
      }
      await whenIdle(ctx);
      const me = currentState().player;
      ctx.replace('battle', {
        ...info.battle,
        attacker: { name: me.name, avatar: me.avatar },
        defender: { name: opponent.name, portraitUrl: opponent.portraitUrl, level: opponent.level },
        rewards: info.rewards !== undefined ? info.rewards : info.reward,
        levelUps: info.levelUps || [],
        cardLevelUps: info.cardLevelUps || [],
        cardXp: info.rewards && info.rewards.cardXp != null ? info.rewards.cardXp : info.cardXp,
        before,
        onDone: p.onDone,
        info, mode, theme,
        quest: p.quest, line: p.line, showdown: p.showdown,
      });
    }
    const bar = attackBar({ onClick: attack });

    body.classList.toggle('pvp', pvp);
    body.append(
      pvp ? h('div.prebattle-name.opp', null, p.title || opponent.name || 'Opponent') : h('div.prebattle-gap.top'),
      oppRow,
      bar,
      pvp ? h('div.prebattle-name.me', null, currentState().player.name || 'You') : null,
      playerRow,
      manaBar,
      drawer);
    drawer.append(h('div.prebattle-drawer-title', null, 'Your cards', h('span.hint', null, 'drag a card into your deck')), drawerCards, drawerEmpty);
    refresh();
    if (p.intro && p.intro.from) {
      const intro = p.intro;
      p.intro = null;   // one-shot (see the header)
      bossCardIntro(intro);
    }

    /**
     * The boss card of the intro flies into its enemy slot, then the Attack! bar opens (see the header).
     * @param {{slot: number, artUrl?: string|null, rarity?: string, from: {x: number, y: number, w: number, h: number}, ms?: number}} intro
     */
    function bossCardIntro(intro) {
      const slotEl = oppRow.children[intro.slot | 0];
      const ms = Number(intro.ms) > 0 ? Number(intro.ms) : 350;
      if (!slotEl || typeof slotEl.animate !== 'function') return;
      slotEl.classList.add('intro-pending');
      bar.classList.add('intro-hidden');
      const f = intro.from;
      const fly = h('div.prebattle-introcard', { class: intro.rarity && `rarity-${intro.rarity}`, style: { left: `${f.x - f.w / 2}px`, top: `${f.y - f.h / 2}px`, width: `${f.w}px`, height: `${f.h}px` } },
        intro.artUrl ? h('img', { src: intro.artUrl, alt: '', draggable: 'false' }) : null);
      body.appendChild(fly);
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        fly.remove();
        slotEl.classList.remove('intro-pending');
        slotEl.classList.add('intro-landed');
        bar.classList.remove('intro-hidden');
        bar.classList.add('intro-in');
        sfx('ui_button_switch');
      };
      // whatever happens to the flight, the slot and the bar come back
      setTimeout(reveal, ms + 1000);
      // wait until the screen is in the DOM and the rows have a layout (a rebuilt screen is attached a frame or
      // two after render), then fly to the slot's box
      const start = (tries) => {
        if (revealed) return;
        if (!fly.isConnected) { if (tries > 0) requestAnimationFrame(() => start(tries - 1)); return; }
        const scale = ui.stage.getScale() || 1;
        const a = slotEl.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const to = { x: (a.left - b.left) / scale + a.width / scale / 2, y: (a.top - b.top) / scale + body.scrollTop + a.height / scale / 2, w: a.width / scale, h: a.height / scale };
        const dx = to.x - f.x;
        const dy = to.y - f.y;
        const trail = h('div.prebattle-introtrail', { style: { left: `${f.x}px`, top: `${f.y}px`, width: `${Math.round(Math.hypot(dx, dy))}px`, transform: `rotate(${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg)`, animationDuration: `${ms + 150}ms` } });
        body.appendChild(trail);
        setTimeout(() => trail.remove(), ms + 200);
        const anim = fly.animate([
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(${to.w / f.w}, ${to.h / f.h})`, opacity: 1 },
        ], { duration: ms, easing: 'cubic-bezier(.5, 0, .75, 0)', fill: 'forwards' });
        anim.onfinish = reveal;
        setTimeout(reveal, ms + 400);
      };
      requestAnimationFrame(() => start(30));
    }
  },

  onLeave(ctx) {
    const root = ctx.root;
    if (root._dnd) { root._dnd.destroy(); root._dnd = null; }
  },
};

export const { render, onLeave } = screen;
