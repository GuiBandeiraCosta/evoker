'use strict';
/**
 * Quest screen (game-design §4.2): purple progress bar, the original village landscape
 * (village_normal_bg / village_burned_bg with the eb1/eb2/birds parallax layers) over which the original
 * minion cut-outs (assets/orig/minions, tribe of the quest's boss or band) walk in from the right, and the
 * minideck (comp_minideck: the deck's five slots) at the bottom. Tapping a minion spends stamina (Drink-potion
 * dialog when short) and pays at once (quests.tapMinion). The presentation follows the 2016 videos
 * (exploration/research/round3/gameplay-feel.md §1, §3): an orange X-slash (two hud_explosion03 streaks and the
 * hud_explosion01 sparks) with "PERFECT" in gold, the minion gone within ~0.13 s, the tap's gold as a small
 * white number at the top right; fast taps stack. The economy credits every tap and the HUD gold counts up with
 * each tap (the 1.7.0 tutorial video: 200 -> 206 -> 212 ...); only a bonus burst / the quest's end gold is held and
 * counted up at the wave's end in GOLD_SHOWER.steps steps under the goldreward coin shower. A wave's card drop
 * is no dialog: the remaining minions fade out, a glint where the last minion stood, a white flash at the centre
 * turning into the glowing, rarity-framed card, a hold, then the card flies into the minideck (CARD_DROP) and the
 * minions come back / the next wave fades in from dark silhouettes. Player level-ups from the tap xp open the level-up dialog at once. When every minion
 * is down the boss intro follows. The tutorial texts and the pointing hand come from src/ui/tutorial.
 * The pure helpers and timings live in quest-model.js, the tap / coin / card-drop effects in quest-fx.js.
 */
import { h, wait, spriteUrl } from '../dom.js';
import { questBar } from '../components/bars.js';
import { button } from '../components/buttons.js';
import { screenBody, offerPotion } from '../chrome.js';
import { startQuest, tapMinion, leaveQuest, getQuest, questLine, questProgressPct } from '../../game/quests.js';
import { describeReward } from '../../game/rewards.js';
import { PORTAL_LOCKED, PORTAL_CLOSED_TEXT } from './quest-portal.js';
import {
  DESTROY_SOUNDS, MINION_SLOTS, MINION_W, MINION_H, CARD_DROP, TAP_FX, questTribe, minionSprite, backdropFor, burstInfo, miniDeck,
  portalBlock,
} from './quest-model.js';
import { createGoldCounter, createQuestFx } from './quest-fx.js';

/**
 * Does the active quest match the requested one?
 * @param {object} state
 * @param {string} line
 * @param {number} n
 * @returns {boolean}
 */
function isActive(state, line, n) {
  const a = state.quests.active;
  return Boolean(a && a.line === line && a.n === n);
}

export const screen = {
  /** @param {object} ctx */
  async render(ctx) {
    const state0 = ctx.store.get();
    if (!state0) { ctx.replace('title'); return; }
    const line = ctx.params.line || 'main';
    const n = Number(ctx.params.quest) || 1;
    const deps = ctx.deps;
    const quest = getQuest(deps, line, n);
    const lineDef = questLine(deps, line);
    if (!quest) { ctx.ui.toast('No such quest'); ctx.back('quest-map'); return; }

    /**
     * A portal quest whose portal has ended (or a portal below level 8) can't start or stay active: the active
     * quest is dropped and the player goes back to the main map with the map's toast. True when it left.
     * @returns {boolean}
     */
    function leaveClosedPortal() {
      const st = ctx.store.get();
      const why = st ? portalBlock(st, deps, ctx.now(), line) : null;
      if (!why) return false;
      const a = st.quests.active;
      if (a && a.line === line) ctx.store.update((s) => leaveQuest(s));
      ctx.ui.toast(why === 'level' ? PORTAL_LOCKED.text : PORTAL_CLOSED_TEXT, { icon: 'compass' });
      // the router is busy while this screen renders: leave once it is free (retried briefly)
      let tries = 0;
      const leave = () => {
        if (ctx.router.busy && tries++ < 30) { setTimeout(leave, 100); return; }
        const cur = ctx.router.current();
        if (cur && (cur.id !== 'quest' || (cur.params && cur.params.line) !== line)) return;
        ctx.goTop('quest', {});
      };
      setTimeout(leave, 0);
      return true;
    }
    if (leaveClosedPortal()) return;

    if (!isActive(state0, line, n)) {
      try {
        ctx.store.update((s, d, t) => startQuest(s, d, t, { line, n }));
      } catch (err) {
        ctx.ui.toast(err.message || 'Quest locked', { icon: 'lock' });
        ctx.back('quest-map');
        return;
      }
    }

    const { hud } = ctx.chrome.mount({
      active: 'quest',
      help: 'quest',
      back: () => {
        const a = ctx.store.get().quests.active;
        if (a && a.figuresDone === 0 && !a.bossReady) ctx.store.update((s) => leaveQuest(s));
        ctx.back('quest-map');
      },
    });
    const variant = backdropFor(line, quest);
    const tribe = questTribe(deps, quest);
    // warm the effect sprites so the first hit shows every frame
    for (const f of ['hud_explosion01', 'hud_explosion03', 'lens_flare', 'glowingcard', 'newcardglow', 'reward_gold']) new Image().src = spriteUrl(f);
    const body = screenBody(ctx, line === 'main' ? 'quest-body' : 'quest-body portal');
    const bar = questBar({ percent: questProgressPct(ctx.store.get().quests.active) });
    const arena = h('div.quest-arena');
    const landscape = h('div.quest-landscape', { class: `village ${variant}`, dataset: { tribe, backdrop: variant } },
      h('div.ql-layer.ql-bg'),
      h('div.ql-layer.ql-eb2'),
      h('div.ql-layer.ql-eb1'),
      variant === 'normal' ? h('img.ql-birds', { src: spriteUrl('village_normal_birds'), alt: '', draggable: 'false' }) : null,
      line === 'main' ? null : h('div.quest-swamp-tint'),
      arena,
      h('div.quest-title.plate', null, `${lineDef ? lineDef.name : 'Quest'} - ${quest.sectionName ? quest.sectionName + ' ' : ''}${n}`));
    const tray = h('div.quest-tray.stone-band');
    const bossBtn = button('Boss fight!', { variant: 'red', size: 'lg', className: 'quest-boss-btn', onClick: () => { if (!leaveClosedPortal()) ctx.replace('boss-intro', { line, quest: n }); } });
    body.append(h('div.quest-progress', null, bar), landscape, tray);
    // the HUD gold counts up with every tap; bursts / end gold wait for the wave's coin shower
    const gold = createGoldCounter(ctx, hud);
    const fx = createQuestFx({ ctx, body, landscape, arena, tray, gold });

    let busy = false;
    /** @type {{el: HTMLElement, wave: number, index: number}[]} alive minion elements */
    let alive = [];
    let shownWave = -1;

    /**
     * Minion element at a slot.
     * @param {string} cardId
     * @param {number} wave
     * @param {number} index  position in the wave
     */
    function spawnMinion(cardId, wave, index) {
      const slotIndex = (index + wave) % MINION_SLOTS.length;
      const slot = MINION_SLOTS[slotIndex];
      const def = deps.db.get(cardId);
      const w = Math.round(MINION_W * slot.s);
      const hgt = Math.round(MINION_H * slot.s);
      const el = h('button.quest-minion.enter', {
        type: 'button',
        dataset: { minion: cardId, index: String(index), wave: String(wave) },
        style: { left: (slot.x - w / 2) + 'px', top: (slot.y - hgt) + 'px', width: w + 'px', height: hgt + 'px', zIndex: String(10 + Math.round(slot.y / 10)), '--wave-in': `${CARD_DROP.waveIn}ms` },
        'aria-label': `Attack ${def ? def.name : 'minion'}`, title: def ? def.name : 'Minion',
        onClick: (ev) => onTap(ev.currentTarget),
      },
        h('img.quest-minion-img', { src: minionSprite(tribe, n * 7 + wave * 3 + index), alt: '', draggable: 'false' }),
        h('span.quest-minion-shadow'));
      arena.appendChild(el);
      alive.push({ el, wave, index });
      if (index === 0) ctx.sfx('enemyShow');
      // the wave fades in: dark silhouettes first, then the colours (CARD_DROP.waveIn)
      setTimeout(() => { if (el.isConnected) el.classList.remove('enter'); }, CARD_DROP.waveIn + 40);
      return el;
    }

    /** Sync the minions in the landscape and the bottom band with the store. */
    function renderTray() {
      const active = ctx.store.get().quests.active;
      tray.replaceChildren();
      if (!active) return;
      if (active.bossReady) {
        for (const m of alive) m.el.remove();
        alive = [];
        tray.appendChild(h('div.quest-tray-boss', null, h('span.quest-tray-text', null, 'All minions defeated!'), bossBtn));
        return;
      }
      const wave = active.waves[active.waveIndex] || [];
      if (active.waveIndex !== shownWave) {
        for (const m of alive) m.el.remove();
        alive = [];
        shownWave = active.waveIndex;
        wave.forEach((cardId, j) => { if (j >= active.waveDone) spawnMinion(cardId, active.waveIndex, j); });
      } else {
        // reconcile: the store counts kills, the DOM keeps whichever minion was tapped
        const want = wave.length - active.waveDone;
        while (alive.length > want) {
          const m = alive.shift();
          m.el.remove();
        }
      }
      tray.appendChild(renderMiniDeck());
    }

    /** The minideck row. */
    function renderMiniDeck() {
      const slots = miniDeck(ctx.store.get(), deps.db, ctx.view.artUrlFor);
      return h('div.quest-minideck', null, slots.map((sl) => h('div.qmd-slot', { class: [sl.locked && 'locked', sl.cardId && 'filled'], dataset: { slot: String(sl.index) } },
        sl.art ? h('img.qmd-art', { src: sl.art, alt: '', draggable: 'false' }) : null)));
    }

    /** Player level-ups from the tap xp: the level-up dialog(s) at once (comp_levelup, src/ui/components/popup-levelup.js). */
    async function showLevelUps(details) {
      if (!details || !details.length) return;
      try {
        await ctx.ui.showLevelUp(details);
      } catch (err) {
        console.error(err);
      }
    }

    /**
     * The end of a wave: the coin shower with the HUD gold catching up, the card drop (or a reward burst), then
     * the next wave fades in - or the boss intro follows.
     * @param {object} info  tapMinion result
     * @param {{x: number, y: number}|null} at  where the last minion stood
     */
    async function waveEnd(info, at) {
      const shower = fx.coinShower();
      const reward = info.reward && info.reward.type !== 'none' && !info.reward.burst ? info.reward : null;
      if (reward && reward.type === 'card') await fx.cardDrop(reward, at);
      else if (reward) {
        fx.burst(reward);
        ctx.ui.toast(describeReward(reward, deps.db), { icon: burstInfo(reward).icon });
        await wait(900);
      }
      await shower;
      if (!ctx.root.isConnected) return;
      renderTray();
      if (info.bossReady) {
        await wait(700);
        if (ctx.root.isConnected && !leaveClosedPortal()) ctx.replace('boss-intro', { line, quest: n });
      }
    }

    /** One minion tap: rapid taps are fine (the slashes stack); a wave's end holds the input until the next wave. */
    async function onTap(cell) {
      if (busy) return;
      if (leaveClosedPortal()) return;
      busy = true;
      let info;
      try {
        info = ctx.store.update((s, d, t) => tapMinion(s, d, t, { event: ctx.event() }));
      } catch (err) {
        busy = false;
        throw err;
      }
      if (info.needsPotion) {
        const ok = await offerPotion(ctx, 'stamina', quest.staminaPerTap);
        busy = false;
        if (ok) onTap(cell);
        return;
      }
      ctx.sfx(DESTROY_SOUNDS[tribe] || 'enemyDestroy');
      let at = null;
      if (cell && cell.isConnected) {
        const idx = alive.findIndex((m) => m.el === cell);
        if (idx >= 0) alive.splice(idx, 1);
        at = fx.centreIn(cell);
        fx.tapFx(at, info);
        cell.classList.add('slain');
        setTimeout(() => cell.remove(), TAP_FX.vanishMs);
      } else {
        fx.tapFx({ x: landscape.offsetWidth / 2, y: landscape.offsetHeight / 2 }, info);
      }
      bar.update(info.pct);
      gold.hold(info.burst);
      gold.tap();
      const levelUps = info.levelUpDetails && info.levelUpDetails.length;
      if (!levelUps && !info.waveCleared && !info.soulCard) { busy = false; return; }
      try {
        if (levelUps) { await wait(320); await showLevelUps(info.levelUpDetails); }
        // the scripted soul card of a tutorial quest (quest 1: the Master Brewer joins the deck, tutorial-v2 §1.3)
        if (info.soulCard) { await fx.cardDrop(info.soulCard, at); renderTray(); }
        if (info.waveCleared) await waveEnd(info, at);
        else renderTray();
      } finally {
        busy = false;
      }
    }

    renderTray();
  },
};
