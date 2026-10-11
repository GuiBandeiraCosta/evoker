'use strict';
/**
 * Boss fight intro (ctrl_bossquest spawnBoss, DECISIONS D5): the screen dims, lightning flashes
 * (lightning_long), and the original fx_boss_light picture - the gold-framed title plate, the glowing rune
 * circle and the orange name plate - zooms in with "Boss Fight n" (n = the quest number) or "Showdown!"
 * (the last quest of a chapter) on its top plate and the boss's name on the bottom one; the boss card scales
 * in over the circle. No Continue button and no boss HP: after BOSS_INTRO.hold (or a tap) the picture fades
 * (BOSS_INTRO.leave) and the pre-battle opens in its place without a transition (it is the same scene in the
 * client): the boss card shrinks and flies into its slot of the enemy row (BOSS_INTRO.fly, reOM @ 5:28,
 * drawn by the pre-battle from `params.intro`), then the Attack! bar opens. The pre-battle runs the shared
 * fight protocol of architecture 8.4; the battle screen shows rewards, XP and level-ups.
 */
import { h, fmt, keyActivate } from '../dom.js';
import { cardNameWithPlus } from '../components/card.js';
import { screenBody } from '../chrome.js';
import { prepareBoss, fightBoss, getQuest, questLine } from '../../game/quests.js';
import { describeReward } from '../../game/rewards.js';

/**
 * Reward summary handed to the battle screen's result popup.
 * @param {object} info  resolveBoss result
 * @param {object} db
 * @returns {object}
 */
export function battleRewards(info, db) {
  const items = [];
  if (info.playerXp) items.push({ icon: 'star', label: `+${fmt(info.playerXp)} XP` });
  if (info.cardXp) items.push({ icon: 'cards', label: `+${fmt(info.cardXp)} card XP` });
  if (info.reward && info.reward.type !== 'none') {
    const icons = { gold: 'coin', gems: 'gem', potion: info.reward.potion === 'mana' ? 'potion-blue' : 'potion-orange', token: 'token-bronze', piece: 'cards', card: 'cards' };
    items.push({ icon: icons[info.reward.type] || 'star', label: describeReward(info.reward, db) });
  }
  if (info.gems) items.push({ icon: 'gem', label: `+${fmt(info.gems)} gems (level bonus)` });
  return {
    won: Boolean(info.won),
    playerXp: info.playerXp || 0,
    cardXp: info.cardXp || 0,
    gold: info.reward && info.reward.type === 'gold' ? info.reward.gold : 0,
    gems: (info.reward && info.reward.type === 'gems' ? info.reward.gems : 0) + (info.gems || 0),
    reward: info.reward || null,
    text: info.reward && info.reward.type !== 'none' ? describeReward(info.reward, db) : '',
    items,
    unlocked: info.unlocked || null,
    firstWin: Boolean(info.firstWin),
  };
}

/**
 * Is this quest a "Showdown!": a quest node marked `showdown: true` (the tutorial's quests 5 and 10, as in the video),
 * or the last quest of a main-line section or of a portal line?
 * @param {object} deps
 * @param {string} line
 * @param {number} n
 * @returns {boolean}
 */
export function isShowdown(deps, line, n) {
  const q = deps && deps.quests;
  if (!q) return false;
  let node = null;
  try { node = getQuest(deps, line || 'main', Number(n)); } catch { node = null; }
  if (node && node.showdown) return true;
  if (line === 'main' || !line) {
    const sections = Array.isArray(q.sections) ? q.sections : [];
    return sections.some((s) => Number(s.to) === Number(n));
  }
  const portal = (q.portals || []).find((p) => p.id === line);
  return Boolean(portal && portal.nodes && portal.nodes.length && portal.nodes[portal.nodes.length - 1].n === Number(n));
}

/**
 * Title of the boss intro banner: "Boss Fight n" (n = the quest number), "Showdown!" for a chapter's last boss.
 * @param {object} deps
 * @param {string} line
 * @param {number} n
 * @returns {string}
 */
export function bossTitle(deps, line, n) {
  return isShowdown(deps, line, n) ? 'Showdown!' : `Boss Fight ${n}`;
}

/** Boss intro timings (ms): plate zoom, card scale-in, hold, the picture fading, the card's flight to its slot. */
export const BOSS_INTRO = Object.freeze({ dim: 400, plate: 300, card: 800, hold: 2600, leave: 300, fly: 350 });
/** The boss card of the intro in screen-body px (centre and size, boss-intro.css .boss-card). */
export const BOSS_CARD_BOX = Object.freeze({ x: 360, y: 395, w: 250, h: 352 });

export const screen = {
  /** @param {object} ctx */
  async render(ctx) {
    const state0 = ctx.store.get();
    if (!state0) { ctx.replace('title'); return; }
    const line = ctx.params.line || 'main';
    const n = Number(ctx.params.quest) || 1;
    const deps = ctx.deps;
    const quest = getQuest(deps, line, n);
    const active = state0.quests.active;
    if (!quest || !active || active.line !== line || active.n !== n || !active.bossReady) {
      ctx.ui.toast('Beat the minions first!', { icon: 'swords' });
      ctx.replace('quest', { line, quest: n });
      return;
    }
    const prep = ctx.store.update((s, d, t) => prepareBoss(s, d, t));
    const lineup = prep.lineup;
    const bossInst = lineup.boss;
    const bossDef = deps.db.get(bossInst.cardId);
    const bossView = ctx.view.defView(bossDef, bossInst.stage, bossInst.level);
    const bossSlot = Math.max(0, lineup.cards.findIndex((c) => c && (c === bossInst || (c.uid && c.uid === bossInst.uid))));
    const title = bossTitle(deps, line, n);
    const showdown = title === 'Showdown!';

    ctx.chrome.mount({ active: 'quest', help: 'battle', back: () => ctx.replace('quest', { line, quest: n }) });
    const body = screenBody(ctx, line === 'main' ? 'boss-body' : 'boss-body portal');
    const root = ctx.root;

    const card = h('div.boss-card', { class: `rarity-${bossView.rarity}` },
      h('img', { src: bossView.artUrl || bossView.artFallbackUrl || '/assets/ui/card-placeholder.svg', alt: bossView.name, draggable: 'false' }));
    const stage = h('div.boss-stage', { role: 'button', tabIndex: 0, 'aria-label': `${title}: ${bossView.name}. Tap to continue.` },
      h('div.boss-dim'),
      h('img.boss-circle', { src: '/assets/orig/ui/fx_glow_map.png', alt: '', draggable: 'false' }),
      h('div.boss-light', null,
        h('div.boss-title', { class: showdown && 'showdown' }, title),
        h('div.boss-name', null, cardNameWithPlus(bossDef.name, bossInst.stage))),
      card);
    body.append(stage);

    // lightning_long: a few flashes at random heights and angles while the dim comes up
    ctx.sfx('lightning_long');
    for (let i = 0; i < 3; i++) {
      const bolt = h('div.boss-bolt', { style: { top: `${430 + (i * 137) % 260}px`, transform: `rotate(${[-18, 12, -6][i]}deg)`, animationDelay: `${i * 260}ms` } });
      stage.appendChild(bolt);
    }
    const soundTimer = setTimeout(() => ctx.sfx('metallic_transition'), BOSS_INTRO.dim);

    let left = false;
    const timer = setTimeout(advance, BOSS_INTRO.hold);
    root._bossTimers = [soundTimer, timer];
    stage.addEventListener('click', advance);
    stage.addEventListener('keydown', keyActivate(advance));

    /** The card flies up to the enemy row, then the pre-battle opens (the same scene in the client). */
    function advance() {
      if (left) return;
      left = true;
      clearTimeout(timer);
      stage.classList.add('leaving');
      setTimeout(() => { if (root.isConnected) goPrebattle(); }, BOSS_INTRO.leave);
    }

    function goPrebattle() {
      const opponent = {
        name: lineup.player.name,
        portraitUrl: bossView.artUrl,
        level: n,
        hp: lineup.player.hp,
        maxHp: lineup.player.maxHp,
        faceDown: false,
        cards: lineup.cards.map((c) => {
          if (!c) return null;
          const def = deps.db.get(c.cardId);
          return def ? ctx.view.defView(def, c.stage, c.level, { uid: c.uid, evolveQuality: c.evolveQuality || 1 }) : null;
        }),
      };
      const fight = () => {
        const info = ctx.store.update((s, d, t) => fightBoss(s, d, t, { event: ctx.event() }));
        return { ...info, rewards: battleRewards(info, deps.db) };
      };
      // the battle screen shows the loot, the card XP and level-ups and the player level-ups (DECISIONS D5)
      const onDone = async (info) => {
        if (!info) { ctx.goTop('quest', { line }); return; }
        ctx.goTop('quest', { line, lastLoss: !info.won });
      };
      ctx.replace('prebattle', {
        mode: 'quest',
        title,
        opponent,
        manaCost: 0,
        fight,
        onDone,
        line,                                                            // line id: picks the backdrop theme
        lineName: questLine(deps, line) ? questLine(deps, line).name : line,
        quest: n,
        showdown,
        // the card of the intro flies into its slot of the enemy row (prebattle.js)
        intro: { slot: bossSlot, artUrl: bossView.artUrl || bossView.artFallbackUrl || null, rarity: bossView.rarity, from: BOSS_CARD_BOX, ms: BOSS_INTRO.fly },
      }, { transition: 'none' });
    }
  },

  onLeave(ctx) {
    for (const id of ctx.root._bossTimers || []) clearTimeout(id);
  },
};
