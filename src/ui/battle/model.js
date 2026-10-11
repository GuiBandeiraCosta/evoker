'use strict';
/**
 * The battle board model of the playback (pure, no DOM): built from the battleStart snapshot and advanced
 * event by event, exactly as the engine reported it. finalState() is what "Skip fight" jumps to.
 */

/**
 * The board model derived from the battleStart snapshot.
 * @param {object[]} events
 * @returns {object} model `{ round, winner, ended, attacker: {player, cards}, defender: {...}, deaths }`
 */
export function initialModel(events) {
  const start = (events || []).find((e) => e.t === 'battleStart');
  const side = (s) => {
    const p = (s && s.player) || {};
    const cards = [];
    for (let i = 0; i < 5; i++) {
      const c = s && s.cards ? s.cards[i] : null;
      cards.push(c ? { cardId: c.cardId, name: c.name, tribe: c.tribe || 'neutral', hp: c.hp, maxHp: c.maxHp, attack: c.attack, baseAttack: c.attack, dead: false } : null);
    }
    return { player: { name: p.name || '', hp: Number(p.hp) || 0, maxHp: Number(p.maxHp) || Number(p.hp) || 1 }, cards };
  };
  return {
    round: 0, winner: null, ended: false, rounds: 0,
    attacker: side(start && start.attacker),
    defender: side(start && start.defender),
    deaths: { attacker: 0, defender: 0 },
  };
}

/**
 * Apply one event to the model (mutates and returns it).
 * @param {object} model
 * @param {object} ev
 * @returns {object}
 */
export function reduceEvent(model, ev) {
  if (!ev || !model) return model;
  const side = model[ev.side];
  const card = side && Number.isInteger(ev.slot) ? side.cards[ev.slot] : null;
  switch (ev.t) {
    case 'roundStart':
      model.round = ev.round;
      // per-round attack boosts end with the round (the engine resets attack to origAttack at round start)
      for (const s of [model.attacker, model.defender]) for (const c of s.cards) if (c && Number.isFinite(c.baseAttack)) c.attack = c.baseAttack;
      break;
    case 'buff':
      if (ev.stat === 'attack' && card) {
        card.attack = Math.max(0, card.attack + ev.delta);
        if (ev.permanent) card.baseAttack = Math.max(0, (Number.isFinite(card.baseAttack) ? card.baseAttack : card.attack - ev.delta) + ev.delta);
      }
      if (ev.stat === 'maxHp') {
        if (ev.slot === null || ev.slot === undefined) {
          if (side) { side.player.maxHp = Math.max(1, side.player.maxHp + ev.delta); side.player.hp = Math.min(side.player.maxHp, side.player.hp + ev.delta); }
        } else if (card) { card.maxHp = Math.max(1, card.maxHp + ev.delta); card.hp += ev.delta; }
      }
      break;
    case 'damage':
    case 'heal':
      if (ev.slot === null || ev.slot === undefined) { if (side) side.player.hp = ev.hp; } else if (card) card.hp = ev.hp;
      break;
    case 'swap':
      if (card) { card.attack = ev.attack; card.baseAttack = ev.attack; card.hp = ev.hp; card.maxHp = ev.maxHp; }
      break;
    case 'death':
      if (card) { card.dead = true; if (side) model.deaths[ev.side]++; }
      break;
    case 'revive':
      if (card) { card.dead = false; card.hp = ev.hp; if (Number.isFinite(ev.attack)) { card.attack = ev.attack; card.baseAttack = ev.attack; } if (card.hp > card.maxHp) card.maxHp = card.hp; }
      break;
    case 'roundEnd':
      model.attacker.player.hp = ev.attackerHp; model.defender.player.hp = ev.defenderHp; model.round = ev.round;
      break;
    case 'battleEnd':
      model.winner = ev.winner; model.rounds = ev.rounds; model.ended = true;
      model.attacker.player.hp = ev.attackerHp; model.defender.player.hp = ev.defenderHp;
      break;
    default: break;
  }
  return model;
}

/**
 * The board after every event: what "Skip fight" jumps to.
 * @param {object[]} events
 * @returns {object} model (see initialModel)
 */
export function finalState(events) {
  const model = initialModel(events);
  for (const ev of events || []) reduceEvent(model, ev);
  return model;
}
