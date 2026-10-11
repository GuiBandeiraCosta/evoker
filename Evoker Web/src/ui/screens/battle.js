'use strict';
/**
 * Battle screen (architecture.md §8.4 step 3, game-design §1.5, DECISIONS D5). noChrome.
 *
 * Layout like the original (comp_fight_layout / comp_fight_v3, dressed with the client's sprites): top bands
 * (seperator_big) with the opponent portrait in the hud_player01 frame, the name and ROUND n, the opponent HP
 * bar (3-slice trough + hud_healthicon01), opponent row (thin HP bars above the cards), the arena / painted
 * horizon, player row (HP bars below), player HP bar, bottom band (player name, ? button in the hud_player02
 * frame) and the "Skip fight" button (hud_bigbutton03) bottom-left.
 *
 * Sequence (1x = the original pacing; the speed button stays as a convenience):
 *  1. Entry: the bands slide in and the HP bars grow (1000 ms, comp_fight_v3 fadeInHud), the cards fade in
 *     (500 ms), while the "Loading..." strip (comp_server_wait: black band, spinning loading.png pentagram)
 *     shows over the middle (LOADING_MS); then the short lightning flash (fx_lightning, lightning_short).
 *  2. The event log plays in src/ui/battle-player.js: tribe-bonus moment first (glowing tribe icon, "TRIBE
 *     BONUS", HP +20 %), then "ROUND 1" appears and "Skip fight" fades in (400 ms) where the fight can be
 *     skipped (from the quest-3 boss on, always in PvP).
 *  3. Post-battle (src/ui/screens/battle-result.js): Victory / Defeat banner, loot, card XP bars, level-up
 *     popups, Continue, then the player level-up hook and `onDone(info)`.
 *
 * Audio: ctx.sfx(name) with the file stems of assets/orig/sfx, ctx.music('music_fight_cue1' | 'music_fight_cue2')
 * when the screen opens and ctx.music(null) (fade out) when it closes.
 *
 * params = { events, result, attacker, defender, rewards, levelUps, cardLevelUps, cardXp, before, onDone,
 *            info?, theme?, mode?, playerSide?, quest?, line?, speed? }
 *   attacker / defender: display info `{ name, portraitUrl?, avatar? }` (the board itself comes from the
 *   battleStart event snapshot so hp/attack values are exactly the engine's); before: the deck's cards
 *   before the fight (prebattle deckSnapshot) for the XP bars.
 */
import { h, iconUrl, spriteUrl } from '../dom.js';
import { renderCard, plainNumber } from '../components/card.js';
import { hpBar } from '../components/bars.js';
import { button, iconButton } from '../components/buttons.js';
import { playBattle } from '../battle-player.js';
import { SOUNDS } from '../battle/assets.js';
import { runPostBattle } from './battle-result.js';
import { resultKind } from './battle-result-model.js';

const PVP_MODES = ['arena', 'pieces', 'league', 'pvp', 'replay', 'lab'];

/** "Loading..." strip after Attack! (the measured Attack -> fight gap of the videos, ~1.5-2 s), ms at 1x. */
export const LOADING_MS = 1500;
/** comp_fight_v3 fadeInHud: bands slide in and HP bars grow, ms. */
export const HUD_IN_MS = 1000;
/** fx_lightning: eight 80 ms steps. */
export const LIGHTNING_MS = 560;
/** The skip button fades in over this (enableSkipBtn), ms. */
export const SKIP_FADE_MS = 400;
/** Fade to black after the result (ms); the router's fade lifts it on the next screen. */
export const VEIL_MS = 350;
/** Main-line quest from which "Skip fight" is offered (the skip_fight feature unlocks at the quest-3 boss). */
export const SKIP_FROM_QUEST = 3;

/**
 * Can this fight be skipped? PvP and replays always; main-line quests from the quest-3 boss on; portal quests
 * always (they open later in the game).
 * @param {{mode?: string, quest?: number, line?: string, info?: object}} p
 * @returns {boolean}
 */
export function canSkip(p) {
  const mode = String((p && p.mode) || 'quest');
  if (mode !== 'quest' && mode !== 'boss') return true;
  const line = (p && p.line) || (p && p.info && p.info.quest && p.info.quest.line) || 'main';
  if (line !== 'main') return true;
  const n = Number(p && p.quest) || Number(p && p.info && p.info.quest && p.info.quest.n) || 0;
  return n >= SKIP_FROM_QUEST;
}

/** Backdrop themes (assets/bg/README.md); 'sunset' is the original arena painting. */
export const THEMES = ['valley', 'sunset', 'swamp', 'lava'];

/**
 * Backdrop theme for a fight mode.
 * @param {string} [mode]  quest | boss | portal | arena | pieces | league | replay
 * @param {{quest?: number, line?: string}} [extra]
 * @returns {string}
 */
export function themeFor(mode, extra = {}) {
  const m = String(mode || 'quest');
  if (PVP_MODES.includes(m)) return 'sunset';
  if (m === 'portal' || (extra.line && extra.line !== 'main')) return 'swamp';
  if (m === 'boss' && Number(extra.quest) >= 31) return 'lava';
  if (Number(extra.quest) >= 31 && (!extra.line || extra.line === 'main')) return 'lava';
  return 'valley';
}

/**
 * Fight music cue for a mode: cue2 in the arena (PvP), cue1 on quests.
 * @param {string} [mode]
 * @returns {string}
 */
export function musicFor(mode) {
  return PVP_MODES.includes(String(mode || '')) ? 'music_fight_cue2' : 'music_fight_cue1';
}

/**
 * Player HP bar dressed with the original sprites (hud_healthicon01 heart, 3-slice trough).
 * @param {{cur: number, max: number, className?: string}} opts
 * @returns {HTMLElement & {update: (cur: number, max?: number) => void}}
 */
export function origHpBar(opts) {
  const bar = hpBar({ ...opts, className: ['orig-hp', opts.className].filter(Boolean).join(' ') });
  const heart = bar.querySelector('img');
  if (heart) heart.src = spriteUrl('hud_healthicon01');
  // the fight screen prints plain digits like the original ("11280 / 11280"); the number may go below 0
  // (overkill), only the fill stops at empty
  const trough = bar.querySelector('.bar');
  if (trough && typeof trough.update === 'function') {
    let max = opts.max;
    bar.update = (cur, m = max) => {
      max = m;
      trough.update(Math.max(0, Number(cur) || 0), max, `${plainNumber(cur)} / ${plainNumber(max)}`);
    };
    bar.update(opts.cur, opts.max);
  }
  return bar;
}

/** @type {import('../router.js').Screen} */
export const screen = {
  noChrome: true,

  /**
   * @param {object} ctx  ScreenContext (architecture.md §8.1)
   */
  render(ctx) {
    const p = ctx.params;
    const events = Array.isArray(p.events) ? p.events : (p.battle && p.battle.events) || [];
    const start = events.find((e) => e.t === 'battleStart') || { attacker: { player: {}, cards: [] }, defender: { player: {}, cards: [] } };
    const playerSide = p.playerSide === 'defender' ? 'defender' : 'attacker';
    const oppSide = playerSide === 'attacker' ? 'defender' : 'attacker';
    const state = ctx.store.get();
    const { db, view, sfx } = ctx;
    const theme = THEMES.includes(p.theme) ? p.theme : themeFor(p.mode, p);
    const root = ctx.root;
    root.classList.add('battle-screen');
    root.dataset.theme = theme;

    /* ---- music: the fight cue while the screen is open, silence afterwards (the next screen picks its own) ---- */
    ctx.music(musicFor(p.mode));
    root._music = () => ctx.music(null);

    const sideInfo = (key) => ({ ...(start[key] && start[key].player ? start[key].player : {}), ...((key === playerSide ? p.attacker || p.player : p.defender || p.opponent) || {}) });
    const opp = sideInfo(oppSide);
    const me = sideInfo(playerSide);
    const myName = me.name || state.player.name || 'You';

    /* ---- views for the two rows ---- */
    const makeView = (snap) => {
      const def = db.get(snap.cardId);
      if (def) {
        const v = view.battleView(snap, def);
        // the engine reports 0 for cards without an ability value ("Takes no damage in the first round",
        // trainers, no ability): the original shows no anvil chip at all then
        if (!(def.base && def.base.ability != null) && !(v.abilityValue > 0)) v.abilityValue = null;
        return v;
      }
      return { ...snap, uid: snap.instanceId, artUrl: null, healDirs: [], levelCap: snap.level };
    };
    const cards = { attacker: [], defender: [] };
    const slots = { attacker: [], defender: [] };
    const row = (key, pos) => {
      const el = h('div.battle-row', { class: pos, dataset: { side: key } });
      for (let i = 0; i < 5; i++) {
        const snap = start[key] && start[key].cards ? start[key].cards[i] : null;
        const slot = h('div.battle-slot', { dataset: { slot: String(i), side: key } });
        slots[key][i] = slot;
        if (snap) {
          const wrap = renderCard(makeView(snap), { size: 'battle', side: pos, hpBar: true });
          cards[key][i] = wrap;
          slot.appendChild(wrap);
        } else cards[key][i] = null;
        el.appendChild(slot);
      }
      return el;
    };

    const oppBar = origHpBar({ cur: opp.hp || 0, max: opp.maxHp || opp.hp || 1, className: 'battle-hp opp' });
    const myBar = origHpBar({ cur: me.hp || 0, max: me.maxHp || me.hp || 1, className: 'battle-hp me' });
    // "ROUND n" is absent until round 1 starts (battle-player adds .shown)
    const roundLabel = h('div.battle-round.round-label', null, 'ROUND 1');
    const portraitSrc = opp.portraitUrl || (typeof opp.portrait === 'string' && opp.portrait.includes('/') ? opp.portrait : iconUrl('avatar'));
    const portrait = h('div.battle-portrait', null, h('img', { src: portraitSrc, alt: '' }));
    portrait.querySelector('img').addEventListener('error', (ev) => { ev.target.src = iconUrl('avatar'); });

    let player = null;
    let post = null;
    let ended = false;
    let skipRequested = false;
    const skippable = canSkip(p);
    const speed = { value: (Number(p.speed) || Number(state.settings.speed) || 1) >= 2 ? 2 : 1 };
    const skip = () => {
      if (player) { player.skip(); return; }
      skipRequested = true;
    };
    const skipBtn = button('Skip fight', { className: 'battle-skip', onClick: skip });
    skipBtn.classList.add('waiting');
    skipBtn.tabIndex = -1;
    if (!skippable) skipBtn.classList.add('locked');
    const speedBtn = button(`${speed.value}x`, { className: 'battle-speed', size: 'sm', title: 'Playback speed', onClick: () => {
      speed.value = speed.value >= 2 ? 1 : 2;
      if (player) player.setSpeed(speed.value);
      speedBtn.textContent = `${speed.value}x`;
      sfx('ui_button_switch');
    } });
    const helpBtn = iconButton('question', { className: 'battle-help', ariaLabel: 'Help', onClick: () => ctx.ui.dialog.alert({
      title: 'The fight',
      message: 'Cards attack in slot order, attacker first. Each card hits the enemy card facing it (or the enemy player when the slot is empty); diagonal arrows split the damage. The fight ends when a player runs out of health or after 20 rounds - the player with more health wins.',
    }) });
    const helpFrame = h('div.battle-help-frame', null, helpBtn);

    const top = h('div.battle-top', null,
      h('div.battle-band.band-round', null, roundLabel),
      h('div.battle-band.band-name', null, h('span.battle-opp-name', null, opp.name || 'Opponent')),
      portrait);
    const bottom = h('div.battle-bottom', null,
      h('div.battle-band.band-player', null, h('span.battle-my-name', null, myName)),
      helpFrame,
      h('div.battle-controls', null, skipBtn, speedBtn));

    const field = h('div.battle-field', null,
      h('div.battle-bg', { class: theme }),
      top,
      h('div.battle-hp-row.opp', null, oppBar),
      row(oppSide, 'top'),
      row(playerSide, 'bottom'),
      h('div.battle-hp-row.me', null, myBar),
      bottom);
    root.appendChild(field);
    // Escape never leaves a running fight (the result is already in the save): where the fight may be
    // skipped it skips to the result; on the result screens it does nothing (Continue is the way out).
    root._onBack = () => { if (skippable && !(player && player.finished())) skip(); };

    /* ---- after the fight ---- */
    const finish = () => {
      if (ended) return;
      ended = true;
      const info = p.info || p;
      // the board fades to black (round3/gameplay-feel.md §8), the next screen fades in from black
      root.appendChild(h('div.battle-veil', { style: { '--dur': `${VEIL_MS}ms` } }));
      setTimeout(() => {
        if (typeof p.onDone === 'function') { try { p.onDone(info); } catch (err) { console.error(err); } } else ctx.back('quest-map');
      }, VEIL_MS);
    };
    const showResult = (summary) => {
      if (post) return;
      skipBtn.disabled = true;
      const winner = (p.result && p.result.winner) || summary.winner;
      const kind = resultKind(winner, playerSide);
      post = runPostBattle({ root, ctx, p, kind, sfx, pvp: PVP_MODES.includes(String(p.mode || '')), onFinish: finish });
      root._post = post;
      setTimeout(() => { try { post.el.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }, 30);
    };

    /* ---- entry: HUD in, "Loading...", lightning; then the fight ---- */
    const getScale = ctx.ui.stage.getScale;
    const timers = new Set();
    root._timers = timers;
    const after = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    const scaled = (ms) => Math.max(1, Math.round(ms / speed.value));
    const loading = h('div.battle-loading', { role: 'status', style: { '--dur': `${scaled(LOADING_MS)}ms` } },
      h('img.battle-loading-spinner', { src: spriteUrl('loading'), alt: '' }),
      h('span.battle-loading-text', null, 'Loading...'));
    const startFight = () => {
      root.classList.remove('entering');
      loading.classList.add('closing');
      after(220, () => loading.remove());
      if (!events.length) {
        roundLabel.textContent = 'ROUND -';
        roundLabel.classList.add('shown');
        after(300, () => showResult({ winner: (p.result && p.result.winner) || 'draw' }));
        return;
      }
      player = playBattle({
        fx: root, cards, slots, players: { [oppSide]: oppBar, [playerSide]: myBar }, round: roundLabel, getScale, top: oppSide,
        frames: { [oppSide]: portrait, [playerSide]: helpFrame },
      }, events, {
        speed: speed.value,
        sfx,
        onRound: (n) => {
          if (n !== 1 || !skippable) return;
          skipBtn.style.transitionDuration = `${SKIP_FADE_MS}ms`;
          skipBtn.classList.remove('waiting');
          skipBtn.tabIndex = 0;
        },
        onEnd: (summary, info) => {
          root.dataset.ended = info && info.skipped ? 'skipped' : 'played';   // test hook (tests/e2e)
          sfx(summary.winner === playerSide ? SOUNDS.victory[0] : SOUNDS.defeat[0]);
          roundLabel.classList.add('fading');
          showResult(summary);
        },
      });
      root._player = player;
      if (skipRequested) player.skip();
    };
    root.classList.add('entering');
    root.style.setProperty('--hud-in', `${scaled(HUD_IN_MS)}ms`);
    root.appendChild(loading);
    after(scaled(LOADING_MS), () => {
      if (skipRequested) { startFight(); return; }
      const bolt = h('div.battle-lightning', { style: { '--dur': `${scaled(LIGHTNING_MS)}ms` } });
      root.appendChild(bolt);
      sfx('lightning_short');
      after(scaled(LIGHTNING_MS) + 40, () => bolt.remove());
      after(scaled(Math.round(LIGHTNING_MS * 0.6)), startFight);
    });
  },

  onLeave(ctx) {
    const root = ctx.root;
    if (root._timers) { for (const id of root._timers) clearTimeout(id); root._timers.clear(); }
    if (root._player) { root._player.destroy(); root._player = null; }
    if (root._post) { root._post.destroy(); root._post = null; }
    if (root._music) { root._music(); root._music = null; }
  },
};

export const { render, onLeave, noChrome } = screen;
