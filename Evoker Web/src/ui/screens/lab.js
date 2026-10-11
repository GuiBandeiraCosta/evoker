'use strict';
/**
 * Card Lab - a test screen for the behaviour of every card in combat (not part of the game flow).
 *
 * Pick any card at any fusion stage and level; "Auto set-up" builds the simplest scenario around it: the card in
 * the middle of your row with a sturdy ability-free ally on each side (so "stun a friend", "heal your neighbours",
 * "boost your allies" have targets), and five ability-free attackers opposite (so "when hit", reflects and
 * "when it dies" trigger; the Strong preset kills, the Weak one only scratches). Every one of the ten slots can
 * then be changed by hand, including putting ability cards on the enemy side. Fight! runs the real engine with
 * the real battle screen (skippable), then the engine's event log is listed here line by line. The effect showcase
 * (lab-model.js SHOWCASE) has one "Show" per effect type an ability can have: the card, rows and seed that show it.
 *
 * Opened with `?lab` in the URL (http://localhost:8080/?lab) or `window.evoker.go('lab')`. Fights touch nothing in
 * the save (no mana, no XP, no replays); a fresh browser without a save gets a plain new one, since the battle
 * screen and the HUD read the settings and the player from it.
 */
import { h } from '../dom.js';
import { button } from '../components/buttons.js';
import { capFor } from '../../core/stats.js';
import { newGame } from '../../game/state.js';
import { seedFromNow } from '../store.js';
import { LAB_HP, fillerCards, requiredTribe, autoScenario, runLabFight, SHOWCASE, showcaseScenario, effectFires } from './lab-model.js';

export { LAB_HP, fillerCards, requiredTribe, autoScenario, runLabFight };
const STAGE_LABELS = ['base', '+', '++', '+++', '++++'];

/** @typedef {import('./lab-model.js').LabSlot} LabSlot */

/** The lab's state lives across the battle round-trip. */
const lab = {
  cardId: /** @type {string|null} */ (null),
  stage: 0,
  level: 1,
  strong: false,
  hp: LAB_HP,
  own: /** @type {(LabSlot|null)[]} */ ([null, null, null, null, null]),
  opp: /** @type {(LabSlot|null)[]} */ ([null, null, null, null, null]),
  seed: /** @type {number|null} */ (null),
  showcase: /** @type {string|null} */ (null),
  last: /** @type {null|{seed: number, winner: string, rounds: number, attackerHp: number|null, defenderHp: number|null, lines: string[], fired: number|null, type: string|null}} */ (null),
};

export const screen = {
  render(ctx) {
    const db = ctx.db;
    const root = ctx.root;
    root.classList.add('lab-screen');
    if (!ctx.store.get()) ctx.store.set(newGame('Lab', seedFromNow(Date.now()), Date.now(), ctx.deps));
    ctx.chrome.mount({ active: 'cards', back: () => ctx.replace('title', {}, { transition: 'fade' }), hideNav: true, help: 'battle' });
    const body = h('div.screen-body.lab-body');
    root.appendChild(body);

    const defs = db.all().filter((d) => !d.trainer).sort((a, b) => a.name.localeCompare(b.name));
    const sets = [...new Set(defs.map((d) => d.set))];
    const cardOptions = (empty) => [
      empty ? h('option', { value: '' }, '- empty -') : null,
      ...sets.map((set) => h('optgroup', { label: String(set).replace(/-/g, ' ') },
        ...defs.filter((d) => d.set === set).map((d) => h('option', { value: d.id }, `${d.name} (${d.rarity})`)))),
    ];
    const stageOptions = () => STAGE_LABELS.map((l, s) => h('option', { value: String(s) }, l));

    /* ---- the tested card ---- */
    const cardSel = h('select.lab-card', { 'aria-label': 'Card', onChange: () => { lab.cardId = cardSel.value || null; lab.stage = 0; const d = def(); lab.level = d ? capFor(d, 0) : 1; auto(); refresh(); } }, ...cardOptions(true));
    const stageSel = h('select.lab-stage', { 'aria-label': 'Fusion stage', onChange: () => { lab.stage = Number(stageSel.value) || 0; const d = def(); if (d) lab.level = capFor(d, lab.stage); auto(); refresh(); } }, ...stageOptions());
    const levelIn = h('input.lab-level', { type: 'number', min: '1', 'aria-label': 'Level', onChange: () => { lab.level = Math.max(1, Number(levelIn.value) || 1); auto(); refresh(); } });
    const abilityEl = h('div.lab-ability');
    const def = () => (lab.cardId ? db.get(lab.cardId) : null);
    function auto() {
      lab.showcase = null;
      const d = def();
      if (!d) return;
      lab.level = Math.min(Math.max(1, lab.level), capFor(d, lab.stage));
      const s = autoScenario(db, d.id, lab.stage, lab.level, lab.strong);
      lab.own = s.own; lab.opp = s.opp;
    }

    /* ---- the two rows ---- */
    const slotEditors = { own: [], opp: [] };
    function slotEditor(side, i) {
      const sel = h('select.lab-slot-card', { 'aria-label': `${side} slot ${i + 1} card`, onChange: () => { const id = sel.value; const cur = (lab[side][i] || {}); lab[side][i] = id ? { cardId: id, stage: cur.stage || 0, level: cur.level || capFor(db.get(id), cur.stage || 0) } : null; refresh(); } }, ...cardOptions(true));
      const st = h('select.lab-slot-stage', { 'aria-label': `${side} slot ${i + 1} stage`, onChange: () => { if (lab[side][i]) { lab[side][i].stage = Number(st.value) || 0; lab[side][i].level = capFor(db.get(lab[side][i].cardId), lab[side][i].stage); refresh(); } } }, ...stageOptions());
      const lv = h('input.lab-slot-level', { type: 'number', min: '1', 'aria-label': `${side} slot ${i + 1} level`, onChange: () => { if (lab[side][i]) { lab[side][i].level = Math.max(1, Number(lv.value) || 1); refresh(); } } });
      const el = h('div.lab-slot', { dataset: { side, slot: String(i) } }, h('div.lab-slot-num', null, String(i + 1)), sel, h('div.lab-slot-line', null, st, lv));
      slotEditors[side][i] = { el, sel, st, lv };
      return el;
    }
    const ownRow = h('div.lab-row', { dataset: { side: 'own' } }, ...[0, 1, 2, 3, 4].map((i) => slotEditor('own', i)));
    const oppRow = h('div.lab-row', { dataset: { side: 'opp' } }, ...[0, 1, 2, 3, 4].map((i) => slotEditor('opp', i)));

    /* ---- controls ---- */
    const strongBtn = button('Opponents: weak', { size: 'sm', className: 'lab-strong', onClick: () => { lab.strong = !lab.strong; auto(); refresh(); } });
    const autoBtn = button('Auto set-up', { size: 'sm', className: 'lab-auto', onClick: () => { auto(); refresh(); } });
    const hpIn = h('input.lab-hp', { type: 'number', min: '1', 'aria-label': 'Player HP', onChange: () => { lab.hp = Math.max(1, Number(hpIn.value) || LAB_HP); } });
    const fightBtn = button('Fight!', { className: 'lab-fight', onClick: () => fight(null) });
    const againBtn = button('Same fight again', { size: 'sm', className: 'lab-again', onClick: () => { if (lab.last) fight(lab.last.seed); } });
    const logEl = h('div.lab-log');

    /* ---- effect showcase: one row per effect type ---- */
    function show(entry) {
      const d = db.get(entry.cardId);
      if (!d) { ctx.ui.toast(`Unknown card ${entry.cardId}`); return; }
      lab.cardId = d.id; lab.stage = entry.stage; lab.level = capFor(d, entry.stage); lab.strong = entry.strong;
      const rows = showcaseScenario(db, entry);
      lab.own = rows.own; lab.opp = rows.opp;
      lab.showcase = entry.type;
      refresh();
      fight(entry.seed);
    }
    const showcaseEl = h('div.lab-showcase', null, ...SHOWCASE.map((entry) => h('div.lab-effect', { dataset: { type: entry.type } },
      h('div.lab-effect-text', null,
        h('div.lab-effect-name', null, entry.label, h('span.lab-effect-type', null, entry.type)),
        h('div.lab-effect-what', null, entry.what),
        h('div.lab-effect-look', null, 'Look for: ', entry.look),
        h('div.lab-effect-card', null, `${(db.get(entry.cardId) || {}).name || entry.cardId} ${'+'.repeat(entry.stage)} - ${entry.strong ? 'strong' : 'weak'} opponents`)),
      button('Show', { size: 'sm', className: 'lab-effect-show', onClick: () => show(entry) }))));

    function fight(seed) {
      if (!lab.own.some(Boolean)) { ctx.ui.toast('Put at least one card in your row', { icon: 'cards' }); return; }
      const s = seed == null ? (Date.now() >>> 0) : seed;
      let out;
      try {
        out = runLabFight(ctx.deps, { own: lab.own, opp: lab.opp, hp: lab.hp, seed: s });
      } catch (err) {
        console.error(err);
        ctx.ui.toast(err && err.message ? err.message : 'The fight could not be built');
        return;
      }
      const { battle, summary } = out;
      const type = lab.showcase;
      lab.last = { seed: s, winner: battle.result.winner, rounds: summary.rounds, attackerHp: summary.attackerHp, defenderHp: summary.defenderHp, lines: summary.lines, type, fired: type ? effectFires(battle.events, type) : null };
      ctx.sfx('ui_button_attack');
      ctx.go('battle', {
        ...battle,
        attacker: { name: 'You' },
        defender: { name: 'Lab opponent' },
        mode: 'lab', playerSide: 'attacker', theme: 'sunset',
        before: [], levelUps: [], cardLevelUps: [], rewards: null,
        onDone: () => ctx.back('lab'),
      });
    }

    function refresh() {
      const d = def();
      cardSel.value = lab.cardId || '';
      stageSel.value = String(lab.stage);
      stageSel.disabled = !d;
      levelIn.value = String(lab.level);
      levelIn.max = d ? String(capFor(d, lab.stage)) : '';
      levelIn.disabled = !d;
      if (d) {
        const v = ctx.view.defView(d, lab.stage, lab.level);
        abilityEl.textContent = v.abilityText || 'No ability.';
        abilityEl.classList.toggle('none', !v.abilityText);
      } else {
        abilityEl.textContent = 'Pick a card to test.';
        abilityEl.classList.add('none');
      }
      strongBtn.textContent = `Opponents: ${lab.strong ? 'strong' : 'weak'}`;
      hpIn.value = String(lab.hp);
      for (const side of ['own', 'opp']) {
        lab[side].forEach((slot, i) => {
          const e = slotEditors[side][i];
          e.sel.value = slot ? slot.cardId : '';
          e.st.value = String(slot ? slot.stage : 0);
          e.st.disabled = !slot;
          e.lv.value = slot ? String(slot.level) : '';
          e.lv.disabled = !slot;
          e.lv.max = slot ? String(capFor(db.get(slot.cardId), slot.stage)) : '';
          e.el.classList.toggle('test', Boolean(slot && side === 'own' && slot.cardId === lab.cardId && i === 2));
          e.el.classList.toggle('empty', !slot);
        });
      }
      while (logEl.firstChild) logEl.removeChild(logEl.firstChild);
      if (lab.last) {
        const L = lab.last;
        logEl.append(
          h('div.lab-log-head', null, `Last fight: ${L.winner === 'attacker' ? 'you won' : L.winner === 'defender' ? 'the opponent won' : 'draw'} after ${L.rounds} round${L.rounds === 1 ? '' : 's'} - you ${L.attackerHp} HP, opponent ${L.defenderHp} HP (seed ${L.seed})`),
          L.type ? h('div.lab-log-effect', { class: L.fired == null && 'missed' }, L.fired == null ? `Showcase: ${L.type} did not show in this fight` : `Showcase: ${L.type} fired in round ${L.fired}`) : null,
          h('ol.lab-log-lines', null, ...L.lines.map((line) => h('li', null, line))));
        againBtn.disabled = false;
      } else {
        logEl.appendChild(h('div.lab-log-head.none', null, 'No fight yet.'));
        againBtn.disabled = true;
      }
    }

    body.append(
      h('div.panel.lab-panel.lab-pick', null,
        h('div.lab-title', null, 'Card Lab'),
        h('div.lab-hint', null, 'Pick a card: it is placed in the middle of your row between two plain allies, with five plain attackers opposite. Change any slot, then Fight!'),
        h('div.lab-pick-line', null, cardSel, stageSel, levelIn),
        abilityEl,
        h('div.lab-buttons', null, autoBtn, strongBtn, h('label.lab-hp-label', null, 'Player HP ', hpIn))),
      h('div.panel.lab-panel', null, h('div.lab-row-title', null, 'Opponent row'), oppRow),
      h('div.panel.lab-panel', null, h('div.lab-row-title', null, 'Your row'), ownRow),
      h('div.lab-fight-line', null, fightBtn, againBtn),
      h('div.panel.lab-panel', null, logEl),
      h('div.panel.lab-panel', null, h('div.lab-row-title', null, `Effect showcase - every effect a card can have (${SHOWCASE.length})`), h('div.lab-hint', null, 'Show sets the rows up for that effect and starts the fight (fixed seed, so it plays the same every time).'), showcaseEl));
    refresh();
  },
};

export const { render } = screen;
