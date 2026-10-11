'use strict';

/**
 * Stub battle engine: `buildSide` mirrors src/engine/battle-state.js (calls options.computeStats) and
 * `simulateBattle` returns the winner chosen by the test ('attacker' | 'defender' | 'draw' or a function).
 * @param {{winner?: string|((cfg: object) => string)}} [opts]
 * @returns {{simulateBattle: Function, buildSide: Function, calls: object[]}}
 */
export function makeEngine(opts = {}) {
  const calls = [];
  const engine = {
    calls,
    winner: opts.winner || 'attacker',
    buildSide(playerLike, cardsBySlot, options = {}) {
      const cards = [];
      for (let i = 0; i < 5; i++) {
        const inst = (cardsBySlot || [])[i];
        if (!inst) { cards.push(null); continue; }
        const def = options.cardsDb.get(inst.cardId);
        if (!def) throw new Error('fixture engine: unknown card ' + inst.cardId);
        const st = options.computeStats({ cardDef: def, stage: inst.stage, level: inst.level, evolveQuality: inst.evolveQuality == null ? 1 : inst.evolveQuality });
        cards.push({ instanceId: inst.uid || def.id, cardId: def.id, name: def.name, tribe: def.tribe, rarity: def.rarity, mana: def.mana, stage: inst.stage, level: inst.level, attack: st.attack, maxHp: st.hp, hp: st.hp, abilityValue: st.ability || 0, dirs: def.dirs.slice(), ability: def.ability, status: {} });
      }
      const maxHp = Math.round(Number(playerLike.maxHp || playerLike.hp || 1500));
      return { player: { name: String(playerLike.name || 'Player'), hp: maxHp, maxHp, baseMaxHp: maxHp, tribeBonus: false }, cards };
    },
    simulateBattle(cfg) {
      calls.push(cfg);
      const winner = typeof engine.winner === 'function' ? engine.winner(cfg) : engine.winner;
      const attackerHp = winner === 'attacker' ? cfg.attacker.player.maxHp : 0;
      const defenderHp = winner === 'defender' ? cfg.defender.player.maxHp : 0;
      const result = { winner, rounds: 3, attackerHp, defenderHp, deaths: 0 };
      return { events: [{ t: 'battleStart' }, { t: 'battleEnd', ...result }], result };
    },
  };
  return engine;
}
