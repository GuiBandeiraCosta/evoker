'use strict';
/**
 * The data pipeline and the data files: data/cards.json built by tools/build-cards.js (shape, slugs, stats,
 * overrides), data/quests.json (100 main nodes, 8 portals × 25, card ids, bosses, bands, rewards), data/names.json
 * and the fixture catalog of tests/fixtures-game.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCardsDb, slugify } from '../src/core/cards-db.js';
import { RARITIES, RARITY_ORDER, TRIBES, SETS, DIRECTIONS, MAX_STAGE } from '../src/core/constants.js';
import * as Q from '../src/game/quests.js';
import {
  buildCards, serialize, parseDirs, normalizeSet, normalizeRarity, normalizeTribe, artNames, parseStatCell, PATHS,
} from '../tools/build-cards.js';
import { FIXTURE_CARDS } from './fixtures-game/cards.js';
import { ROOT, QUESTS, db, mainNode, portal, within } from './fixtures/real.js';

const raw = JSON.parse(await readFile(PATHS.output, 'utf8'));
const overrides = JSON.parse(await readFile(PATHS.overrides, 'utf8'));
const cards = db.all();

describe('cards.json shape', () => {
  test('version 1 with 195 cards (200 minus the removed casino set) and unique slug ids', () => {
    assert.equal(raw.version, 1);
    assert.equal(cards.length, 195);
    const ids = new Set(cards.map((c) => c.id));
    assert.equal(ids.size, 195);
    for (const c of cards) assert.equal(c.id, slugify(c.name), c.name);
    const sorted = cards.map((c) => c.id).slice().sort();
    assert.deepEqual(cards.map((c) => c.id), sorted, 'cards are sorted by id');
  });

  test('slug rule examples', () => {
    assert.equal(slugify("Will-o'-the-Wisp"), 'will-o-the-wisp');
    assert.equal(slugify('Bone dragon'), 'bone-dragon');
    assert.equal(slugify('Guruk the Destroyer'), 'guruk-the-destroyer');
    assert.equal(slugify('Dungeon Casinò'), 'dungeon-casino');
    assert.ok(db.has('will-o-the-wisp') && db.has('bone-dragon') && db.has('guruk-the-destroyer'));
  });

  test('tribe and rarity counts match the brief', () => {
    const tribes = {};
    const rarities = {};
    for (const c of cards) {
      assert.ok(TRIBES[c.tribe], `${c.id} tribe ${c.tribe}`);
      assert.ok(RARITIES[c.rarity], `${c.id} rarity ${c.rarity}`);
      tribes[c.tribe] = (tribes[c.tribe] || 0) + 1;
      rarities[c.rarity] = (rarities[c.rarity] || 0) + 1;
    }
    assert.deepEqual(tribes, { dwarf: 48, elf: 48, orc: 48, neutral: 51 });
    assert.deepEqual(rarities, { common: 4, standard: 16, uncommon: 51, rare: 48, heroic: 35, legendary: 33, ultimate: 8 });
    assert.equal(db.get('siren').rarity, 'uncommon', 'wiki says "Very Common"; videos show an Uncommon frame and caps');
  });

  test('every card has a positive integer mana within its rarity range (trainers cost 1)', () => {
    for (const c of cards) {
      assert.ok(Number.isInteger(c.mana) && c.mana > 0, `${c.id} mana ${c.mana}`);
      if (c.trainer || c.id === 'siren') continue;
      const [lo, hi] = RARITIES[c.rarity].manaRange;
      assert.ok(c.mana >= lo && c.mana <= hi, `${c.id} (${c.rarity}) mana ${c.mana} outside ${lo}-${hi}`);
    }
    assert.equal(db.get('lightning-spirit').mana, 23);
    for (const id of ['lich-king', 'crystal-ghost', 'blood-dragon']) {
      assert.equal(db.get(id).mana, 1);
      assert.equal(db.get(id).trainer, true);
    }
  });

  test('dirs are a valid canonical subset; no-attack cards have attack 0', () => {
    for (const c of cards) {
      assert.ok(Array.isArray(c.dirs), c.id);
      assert.deepEqual(c.dirs, DIRECTIONS.filter((d) => c.dirs.includes(d)), `${c.id} dirs not canonical`);
      assert.equal(new Set(c.dirs).size, c.dirs.length, `${c.id} duplicate dirs`);
      if (c.dirs.length === 0) assert.equal(c.base.attack, 0, `${c.id} has no dirs but attack`);
    }
    assert.deepEqual(db.get('bloodsoaked-totem').dirs, ['ownLeft', 'ownRight']);
    assert.deepEqual(db.get('minotaur').dirs, ['direct', 'ownLeft']);
    assert.deepEqual(db.get('grimnack').dirs, ['right']);
    assert.deepEqual(db.get('cursed-stag').dirs, ['direct']);
    assert.deepEqual(db.get('raptorial-fungus').dirs, []);
    assert.deepEqual(db.get('lightning-spirit').dirs, []);
    assert.deepEqual(db.get('thief-of-time').dirs, ['direct']);
  });

  test('base stats are present for every card', () => {
    for (const c of cards) {
      assert.ok(Number.isInteger(c.base.attack) && c.base.attack >= 0, `${c.id} attack`);
      assert.ok(Number.isInteger(c.base.hp) && c.base.hp > 0, `${c.id} hp`);
      assert.ok(c.base.ability === null || typeof c.base.ability === 'number', `${c.id} ability`);
      if (/_+/.test(c.sourceText) && !c.evolving) assert.equal(typeof c.base.ability, 'number', `${c.id} needs an ability value`);
    }
    assert.deepEqual(db.get('isegrimm-stormgaze').base, { attack: 360, hp: 960, ability: 360 });
    assert.equal(db.get('thief-of-time').base.attack, 1, 'Thief of Time attacks for a flat 1 like Scrapmaster');
    assert.deepEqual(db.get('thief-of-time').flat, ['attack']);
    assert.deepEqual(db.get('scrapmaster').flat, ['attack']);
    assert.deepEqual(db.get('bone-dragon').growth.attack, [100, 200, 300, 400, 500]);
    assert.deepEqual(db.get('dwarf-king').base, { attack: 800, hp: 2400, ability: 1600 });
  });

  test('caps are the rarity table unless overridden; growth arrays have 5 entries', () => {
    for (const c of cards) {
      assert.equal(c.caps.length, MAX_STAGE + 1, c.id);
      for (let s = 1; s <= MAX_STAGE; s += 1) assert.ok(c.caps[s] > c.caps[s - 1], `${c.id} caps not ascending`);
      if (overrides[c.id] && overrides[c.id].caps) assert.deepEqual(c.caps, overrides[c.id].caps, c.id);
      else assert.deepEqual(c.caps, RARITIES[c.rarity].caps, c.id);
      for (const stat of ['attack', 'hp', 'ability']) {
        assert.equal(c.growth[stat].length, MAX_STAGE + 1, `${c.id} growth.${stat}`);
        for (const v of c.growth[stat]) assert.ok(v === null || typeof v === 'number', `${c.id} growth.${stat}`);
        if (c.base[stat] === null) assert.ok(c.growth[stat].every((v) => v === null), `${c.id} growth without base`);
      }
    }
    for (const r of RARITY_ORDER) assert.equal(RARITIES[r].caps.length, 5);
    assert.deepEqual(RARITIES.common.caps, [9, 10, 11, 12, 13]);
    assert.deepEqual(RARITIES.ultimate.caps, [15, 27, 39, 51, 63]);
  });

  test('evolving cards are flagged and carry a byStage ability when defined', () => {
    const evolving = cards.filter((c) => c.evolving).map((c) => c.id);
    assert.deepEqual(evolving, ['army-of-ghosts', 'bog-yeti', 'magmamancer', 'mountain-yeti', 'sand-yeti']);
    for (const id of evolving) {
      const c = db.get(id);
      if (c.ability !== null) {
        assert.ok(Array.isArray(c.ability.byStage), `${id} ability.byStage`);
        assert.equal(c.ability.byStage.length, 5, `${id} needs 5 stage abilities`);
      }
    }
  });

  test('percent abilities are flagged', () => {
    assert.deepEqual(cards.filter((c) => c.abilityIsPercent).map((c) => c.id).sort(), ['dark-mage', 'djinn', 'medusa']);
    assert.equal(db.get('djinn').base.ability, 6);
    assert.equal(db.get('dark-mage').base.ability, 15);
  });

  test('sets are valid; combined portal field yields a primary set plus sets[]', () => {
    for (const c of cards) {
      assert.ok(SETS.some((s) => s.id === c.set), `${c.id} set ${c.set}`);
      if (c.sets) {
        assert.equal(c.sets[0], c.set);
        for (const s of c.sets) assert.ok(SETS.some((d) => d.id === s), `${c.id} extra set ${s}`);
      }
    }
    assert.equal(db.get('army-of-ghosts').set, 'dawn-of-eternity');
    assert.equal(db.get('army-of-ghosts').sets, undefined, 'the casino re-run of Army of Ghosts is gone with the casino set');
    assert.equal(db.get('dark-mage').set, 'dying-dreams');
    assert.equal(db.get('lich-king').set, 'unique-events');
    assert.equal(db.get('dwarf-king').set, 'main');
    assert.equal(db.bySet('the-dark-beyond').length, 9);
    assert.equal(db.bySet('main').length, 120);
    // Portal set cards whose wiki infobox lacks the portal field are placed by override.
    for (const id of ['goblin-mob', 'blood-fairy']) assert.equal(db.get(id).set, 'desert-twilight', id);
    for (const id of ['sky-guardian', 'baby-dragon']) assert.equal(db.get(id).set, 'dragon-hunt', id);
    for (const id of ['gasher', 'bog-yeti']) assert.equal(db.get(id).set, 'dread-empress', id);
    for (const id of ['war-pangolin', 'stonemason', 'crystal-breeder']) assert.equal(db.get(id).set, 'dwarven-rage', id);
  });

  test('art map: stage 0 always present, keys within 0..4, files exist when assets/cards is present', async () => {
    let artFiles = null;
    try { artFiles = await readdir(PATHS.artDir); } catch { /* no art folder: convention only */ }
    for (const c of cards) {
      assert.ok(typeof c.art['0'] === 'string' && c.art['0'].length > 0, `${c.id} has no stage-0 art`);
      for (const key of Object.keys(c.art)) {
        assert.ok(/^[0-4]$/.test(key), `${c.id} art key ${key}`);
        assert.match(c.art[key], /\.(jpe?g|png)$/i, `${c.id} art ${key}`);
        if (artFiles) assert.ok(artFiles.includes(c.art[key]), `${c.id} art ${key} (${c.art[key]}) is not in assets/cards`);
      }
    }
    assert.equal(db.get('dwarf-king').art['2'], 'Dwarf_King++.jpg');
  });

  test('artNames follows the wiki convention without a file list and uses real files with one', () => {
    const conv = artNames('Dwarf King');
    for (let s = 0; s <= MAX_STAGE; s += 1) assert.equal(conv[String(s)], `Dwarf_King${'+'.repeat(s)}.jpg`);
    const real = artNames('Army of Ghosts', ['Army_of_Ghosts.jpg', 'Army_of_Ghosts++.png', 'Other.jpg']);
    assert.deepEqual(real, { 0: 'Army_of_Ghosts.jpg', 2: 'Army_of_Ghosts++.png' });
    const wisp = artNames("Will-o'-the-Wisp", ['Will-o-the-Wisp.jpg', 'Will-o-the-Wisp+.jpg']);
    assert.deepEqual(wisp, { 0: 'Will-o-the-Wisp.jpg', 1: 'Will-o-the-Wisp+.jpg' });
    const later = artNames('Wizard Apprentice', ['Wizard_Apprentice+.png', 'Wizard_Apprentice++.png']);
    assert.deepEqual(later, { 0: 'Wizard_Apprentice+.png', 1: 'Wizard_Apprentice+.png', 2: 'Wizard_Apprentice++.png' });
    assert.deepEqual(artNames('Nobody', ['Other.jpg']), { 0: 'Nobody.jpg' });
  });

  test('ability field is null or an object; sourceText kept for every card', () => {
    for (const c of cards) {
      assert.ok(c.ability === null || typeof c.ability === 'object', c.id);
      assert.equal(typeof c.sourceText, 'string', c.id);
      assert.ok(!/^["“]/.test(c.sourceText), `${c.id} sourceText still quoted`);
      assert.ok(Array.isArray(c.categories), c.id);
    }
  });

  test('every override has a reason and targets an existing card', () => {
    for (const [id, patch] of Object.entries(overrides)) {
      if (id.startsWith('$')) continue;
      assert.ok(db.has(id), `override ${id} matches no card`);
      assert.ok(typeof patch.reason === 'string' && patch.reason.length > 10, `override ${id} needs a reason`);
    }
  });
});

describe('build pipeline', () => {
  test('data/cards.json is exactly what the build produces (idempotent, not stale)', async () => {
    const catalog = JSON.parse(await readFile(PATHS.catalog, 'utf8'));
    let abilities = null;
    try { abilities = JSON.parse(await readFile(PATHS.abilities, 'utf8')); } catch { /* optional */ }
    let artFiles = null;
    try { artFiles = (await readdir(PATHS.artDir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort(); } catch { /* optional */ }
    const built = buildCards({ catalog, overrides, abilities, artFiles });
    assert.equal(serialize(built), serialize({ version: raw.version, cards: raw.cards }));
    assert.equal(serialize(buildCards({ catalog, overrides, abilities, artFiles })), serialize(built));
  });

  test('build fails loudly when a card lacks mana, attack or hp after overrides', () => {
    const entry = {
      name: 'Test Card', race: 'Elf', rarity: 'Rare', mana: null, attack_dirs: 'direct', ability_text: '', portal: '',
      categories: [], levels: { 1: { lvl: 1, atk: 100, life: 100, abil: null } },
    };
    assert.throws(() => buildCards({ catalog: [entry] }), /mana missing/);
    assert.throws(() => buildCards({ catalog: [{ ...entry, mana: 12, levels: { 1: { lvl: 1, atk: null, life: 100, abil: null } } }] }), /base attack missing/);
    assert.throws(() => buildCards({ catalog: [{ ...entry, mana: 12, levels: { 1: { lvl: 1, atk: 100, life: null, abil: null } } }] }), /base hp missing/);
    assert.throws(() => buildCards({ catalog: [{ ...entry, mana: 12, ability_text: 'Heals ____ points.' }] }), /ability text has a value blank/);
    const ok = buildCards({ catalog: [{ ...entry, mana: 12 }] });
    assert.equal(ok.cards[0].id, 'test-card');
    assert.equal(ok.cards[0].ability, null);
    assert.equal(ok.cards[0].rarity, 'rare');
  });

  test('overrides must have a reason, known fields and a matching card', () => {
    const entry = {
      name: 'Test Card', race: 'Orc', rarity: 'Very Common', mana: 1, attack_dirs: 'none', ability_text: '', portal: '',
      categories: [], levels: { 1: { lvl: 1, atk: null, life: 100, abil: null } },
    };
    assert.throws(() => buildCards({ catalog: [entry], overrides: { 'test-card': { mana: 2 } } }), /reason/);
    assert.throws(() => buildCards({ catalog: [entry], overrides: { 'test-card': { reason: 'x', bogus: 1 } } }), /unknown field/);
    assert.throws(() => buildCards({ catalog: [entry], overrides: { nobody: { reason: 'x', mana: 2 } } }), /matches no card/);
    const built = buildCards({ catalog: [entry], overrides: { 'test-card': { reason: 'test', mana: 2, base: { attack: 5 }, dirs: ['left', 'right'] } } });
    assert.equal(built.cards[0].rarity, 'common');
    assert.equal(built.cards[0].mana, 2);
    assert.deepEqual(built.cards[0].base, { attack: 5, hp: 100, ability: null });
    assert.deepEqual(built.cards[0].dirs, ['left', 'right']);
  });

  test('abilities are attached by id and missing ones give null', () => {
    const entry = {
      name: 'Healer Test', race: 'Dwarf', rarity: 'Uncommon', mana: 6, attack_dirs: 'none', ability_text: '"Heals ____ points."', portal: 'The Dark Beyond',
      categories: ['Healer'], levels: { 1: { lvl: 1, atk: null, life: 100, abil: 50 } },
    };
    const abilities = { 'healer-test': { text: 'Heals {v} points.', effects: [{ type: 'heal', target: 'self', amount: 'value' }] } };
    const built = buildCards({ catalog: [entry], abilities });
    assert.deepEqual(built.cards[0].ability, abilities['healer-test']);
    assert.equal(built.cards[0].sourceText, 'Heals ____ points.');
    assert.equal(built.cards[0].set, 'the-dark-beyond');
    assert.equal(buildCards({ catalog: [entry], abilities: {} }).cards[0].ability, null);
  });

  test('parseDirs handles every wiki spelling', () => {
    assert.deepEqual(parseDirs('1 direction (direct)'), ['direct']);
    assert.deepEqual(parseDirs('1 directions (direct)'), ['direct']);
    assert.deepEqual(parseDirs('left, direct, right'), ['left', 'direct', 'right']);
    assert.deepEqual(parseDirs('3 directions (Left, Front, Right)'), ['left', 'direct', 'right']);
    assert.deepEqual(parseDirs('2 directions (left, right)'), ['left', 'right']);
    assert.deepEqual(parseDirs('two directions (left, right)'), ['left', 'right']);
    assert.deepEqual(parseDirs('direct, right'), ['direct', 'right']);
    assert.deepEqual(parseDirs('1 direction (right)'), ['right']);
    assert.deepEqual(parseDirs('Front'), ['direct']);
    assert.deepEqual(parseDirs('1 Direction (Front)'), ['direct']);
    assert.deepEqual(parseDirs('Direct'), ['direct']);
    assert.deepEqual(parseDirs('left neighbor, right neighbor'), ['ownLeft', 'ownRight']);
    assert.deepEqual(parseDirs('direct, left neighbor'), ['direct', 'ownLeft']);
    assert.deepEqual(parseDirs('none'), []);
    assert.deepEqual(parseDirs('-'), []);
    assert.deepEqual(parseDirs('Monster'), []);
    assert.deepEqual(parseDirs(null), []);
    assert.throws(() => parseDirs('sideways'), /unrecognised/);
  });

  test('normalisers', () => {
    assert.deepEqual(normalizeSet(''), { set: 'main' });
    assert.deepEqual(normalizeSet(null), { set: 'main' });
    assert.deepEqual(normalizeSet('Dawn of Eternity and Dungeon Casinò'), { set: 'dawn-of-eternity' }, 'the removed casino set is dropped');
    assert.deepEqual(normalizeSet('Casino Dungeon'), { set: 'main' });
    assert.deepEqual(normalizeSet('dying dreams'), { set: 'dying-dreams' });
    assert.deepEqual(normalizeSet('Unique Events'), { set: 'unique-events' });
    assert.throws(() => normalizeSet('Atlantis'), /unknown portal/);
    assert.equal(normalizeRarity('Very Common'), 'common');
    assert.equal(normalizeRarity('Heroïc'), 'heroic');
    assert.equal(normalizeRarity('Ultimate'), 'ultimate');
    assert.equal(normalizeRarity('Mythic'), null);
    assert.equal(normalizeTribe('Dwarf'), 'dwarf');
    assert.equal(normalizeTribe('Goblin'), null);
    assert.deepEqual(artNames('Arch Angel'), {
      0: 'Arch_Angel.jpg', 1: 'Arch_Angel+.jpg', 2: 'Arch_Angel++.jpg', 3: 'Arch_Angel+++.jpg', 4: 'Arch_Angel++++.jpg',
    });
    assert.deepEqual(parseStatCell('6%'), { value: 6, percent: true });
    assert.deepEqual(parseStatCell(1234), { value: 1234, percent: false });
    assert.equal(parseStatCell('-'), null);
    assert.equal(parseStatCell('sorry'), null);
    assert.equal(parseStatCell(null), null);
  });
});

describe('cards-db', () => {
  test('lookups', () => {
    assert.equal(db.size, 195);
    assert.equal(db.get('dwarf-king').name, 'Dwarf King');
    assert.equal(db.get('nope'), undefined);
    assert.equal(db.byRarity('ultimate').length, 8);
    assert.equal(db.byTribe('neutral').length, 51);
    assert.notEqual(db.all(), db.all(), 'all() returns a fresh array');
  });

  test('search is case- and accent-insensitive and matches all tokens', () => {
    assert.deepEqual(db.search('DWARF king').map((c) => c.id), ['dwarf-king']);
    assert.ok(db.search('neighbors heals').every((c) => /neighbor/i.test(c.sourceText) && /heal/i.test(c.sourceText)));
    assert.ok(db.search('wisp').some((c) => c.id === 'will-o-the-wisp'));
    assert.ok(db.search('legendary dwarf').every((c) => c.rarity === 'legendary' && c.tribe === 'dwarf'));
    assert.equal(db.search('').length, 195);
    assert.deepEqual(db.search('zzzz'), []);
  });

  test('cards are frozen and the db rejects duplicates', () => {
    const king = db.get('dwarf-king');
    assert.throws(() => { king.mana = 1; }, TypeError);
    assert.throws(() => { king.base.attack = 1; }, TypeError);
    assert.throws(() => createCardsDb({ cards: [{ id: 'a' }, { id: 'a' }] }), /duplicate/);
    assert.throws(() => createCardsDb({}), TypeError);
    const small = createCardsDb({ version: 1, cards: [{ id: 'x', name: 'X', rarity: 'rare', tribe: 'orc', set: 'main', mana: 12, base: {} }] });
    assert.equal(small.size, 1);
    assert.equal(small.get('x').name, 'X');
  });
});

describe('data files (quests.json, names.json, fixture catalog)', () => {
  test('data/quests.json: 100 main nodes, 8 portals × 25, valid card ids, wiki bosses and fixed typos', () => {
    const data = JSON.parse(readFileSync(join(ROOT, 'data', 'quests.json'), 'utf8'));
    const catalog = JSON.parse(readFileSync(join(ROOT, 'exploration', 'research', 'wiki-card-catalog.json'), 'utf8'));
    const ids = new Set(catalog.map((c) => slugify(c.name)));
    assert.equal(data.main.nodes.length, 100);
    assert.equal(data.portals.length, 8);
    assert.equal(data.sections.length, 6);
    data.main.nodes.forEach((n, i) => {
      assert.equal(n.n, i + 1);
      assert.ok(n.section >= 1 && n.section <= 6);
      if (n.boss) assert.ok(ids.has(n.boss), 'unknown boss ' + n.boss);
      if (!n.bossName) assert.equal(n.bossHp, 1500 + 90 * n.n);
      assert.ok(n.staminaPerTap >= 2 && n.staminaPerTap <= 7);
      assert.ok(n.figures >= 4);
      assert.equal(n.stamina, n.figures * n.staminaPerTap);
      assert.ok(Array.isArray(n.band.rarities) && n.band.levels.length === 2);
    });
    const main = (q) => data.main.nodes[q - 1];
    // Quests 1–5: the tutorial bosses of the 1.7.x videos (tutorial.md §3 item 14).
    assert.deepEqual([1, 2, 3, 4, 5].map((q) => main(q).boss), ['throat-cutter', 'bone-breaker', 'lurking-goblin', 'flinger', 'worm-shaman']);
    assert.equal(main(1).staminaPerTap, 2);
    assert.equal(main(1).figures, 5);
    assert.equal(main(12).staminaPerTap * main(12).figures, 55);
    assert.equal(main(12).goldPerFigure, 30);
    assert.equal(main(97).staminaPerTap, 7);
    assert.deepEqual([6, 7, 8, 9, 10].map((q) => main(q).boss), ['blood-spitter', 'club-swinger', 'tribe-avenger', 'ugluk-maggot-eater', 'succubus']);
    assert.equal(main(11).boss, null);
    assert.equal(main(33).boss, 'tunnel-digger');
    assert.equal(main(36).boss, 'succubus');
    assert.equal(main(46).boss, 'ogre');
    assert.equal(main(50).boss, 'assault-drummer');
    assert.equal(main(51).boss, 'giant-lizard');
    assert.equal(main(52).boss, 'moon-prophetess');
    assert.equal(main(62).boss, 'anvil-guard');
    assert.equal(main(66).boss, 'gunner');
    assert.equal(main(39).bossStage, 1);
    assert.equal(main(83).bossStage, 3);
    assert.equal(main(100).boss, 'imperial-dragon');
    assert.equal(main(100).bossStage, 2);
    assert.equal(main(100).wikiStamina, 175);
    assert.equal(main(43).estimated, true);
    assert.equal(main(31).pieceRarity, 'heroic');
    assert.equal(main(71).pieceRarity, 'legendary');
    assert.equal(main(30).pieceRarity, null);
    assert.deepEqual([main(10).token, main(31).token, main(71).token], ['neophyte', 'summoner', 'archmage']);
    assert.equal(data.main.cards.length, 17);
    assert.equal(data.main.gemReward, 31700);
    const expectedPortals = ['the-dark-beyond', 'dawn-of-eternity', 'desert-twilight', 'divine-peace', 'dragon-hunt', 'dread-empress', 'dwarven-rage', 'dying-dreams'];
    assert.deepEqual(data.portals.map((p) => p.id), expectedPortals);
    for (const p of data.portals) {
      assert.equal(p.nodes.length, 25);
      assert.equal(p.cards.length, 8);
      for (const c of p.cards) assert.ok(ids.has(c), 'unknown set card ' + c);
      assert.ok(p.gemReward >= 4000 && p.gemReward <= 5600);
      assert.ok(p.tokens.low.name && p.tokens.high.name);
      p.nodes.forEach((n, i) => {
        assert.equal(n.n, i + 1);
        assert.ok(ids.has(n.boss), 'unknown boss ' + n.boss);
        assert.ok(n.bossHp > 1000);
        assert.ok(n.staminaPerFigure === undefined);
        assert.ok(n.staminaPerTap >= 3 && n.staminaPerTap <= 17);
        assert.ok(n.goldPerFigure >= 15 && n.goldPerFigure <= 97);
        assert.ok(['low', 'high'].includes(n.token));
        assert.ok(['rare', 'heroic', 'legendary'].includes(n.pieceRarity));
        if (n.estimated) assert.ok(n.estimatedFields.length > 0);
      });
      assert.equal(p.nodes[24].highTokenFirstWin, true);
    }
    const tdb = data.portals[0];
    assert.deepEqual(tdb.cards, ['bone-oracle', 'totem-carver', 'airborne-parasite', 'fungus-lord', 'magmamancer', 'loremaster', 'dwarven-sage', 'wilderness-shaper']);
    assert.equal(tdb.gemReward, 4600);
    assert.equal(tdb.nodes[0].boss, 'airborne-parasite');
    assert.equal(tdb.nodes[0].bossHp, 3965);
    assert.equal(tdb.nodes[24].bossHp, 10465);
    assert.equal(tdb.nodes[24].staminaPerTap, 17);
    assert.equal(tdb.nodes[24].goldPerFigure, 97);
    assert.equal(tdb.nodes[0].estimated, undefined);
    assert.ok(data.portals[1].nodes[0].estimated);
  });

  test('data/names.json: 120 unique names and 12 avatar card ids', () => {
    const names = JSON.parse(readFileSync(join(ROOT, 'data', 'names.json'), 'utf8'));
    const catalog = JSON.parse(readFileSync(join(ROOT, 'exploration', 'research', 'wiki-card-catalog.json'), 'utf8'));
    const ids = new Set(catalog.map((c) => slugify(c.name)));
    assert.equal(names.names.length, 120);
    assert.equal(new Set(names.names).size, 120);
    assert.equal(names.avatars.length, 12);
    for (const a of names.avatars) assert.ok(ids.has(a), 'unknown avatar ' + a);
  });

  test('fixture catalog has 21 cards with unique ids', () => {
    assert.equal(FIXTURE_CARDS.length, 21);
    assert.equal(new Set(FIXTURE_CARDS.map((c) => c.id)).size, 21);
  });
});

// ================================================================= §4 Quest map

describe('§4 quest data (data/quests.json)', () => {
  test('main quest: 100 nodes, 6 sections', () => {
    assert.equal(QUESTS.main.nodes.length, 100);
    assert.equal(QUESTS.sections.length, 6);
    QUESTS.main.nodes.forEach((q, i) => assert.equal(q.n, i + 1));
    for (const sec of QUESTS.sections) {
      for (let n = sec.from; n <= sec.to; n++) assert.equal(mainNode(n).section, sec.index);
    }
  });

  // DECISIONS D2: Q1 2, Q2 3, Q12–14 5, Q97 7 (tutorial.md §1.4–1.5, playthroughs-2.md §1.2, playthroughs.md §1.2).
  test('stamina per tap by band: 2 (Q1), 3 (Q2–5), 4 (Q6–10), 5 (Q11–30), 6 (Q31–70), 7 (Q71–100); stamina = figures × per tap', () => {
    for (const q of QUESTS.main.nodes) {
      const n = q.n;
      const spt = n === 1 ? 2 : n <= 5 ? 3 : n <= 10 ? 4 : n <= 30 ? 5 : n <= 70 ? 6 : 7;
      assert.equal(q.staminaPerTap, spt, 'Q' + n);
      assert.equal(q.stamina, q.figures * q.staminaPerTap, 'Q' + n);
      assert.ok(q.figures >= 4, 'Q' + n + ' figures');
      if (q.wikiStamina == null) assert.ok(q.figures <= 20, 'Q' + n + ' estimated figures must be 8–20');
    }
    assert.equal(mainNode(1).stamina, 10); assert.equal(mainNode(1).figures, 5);
    assert.equal(mainNode(2).stamina, 18); assert.equal(mainNode(4).figures, 7);
    assert.equal(mainNode(6).stamina, 28); assert.equal(mainNode(10).stamina, 48);
    for (const n of [12, 13, 14]) assert.equal(mainNode(n).figures, 11, 'Q12–14 are 11 taps');
    assert.equal(mainNode(97).figures, 23);
  });

  // Gold per tap: Q1 6 (+10 at the end), Q12–14 30 (playthroughs-2.md §1.1), ~18 early, ~36 at Q97.
  test('main gold per tap by band (6 / 18 / 24 / 30 / 33 / 36); boss HP = 1500 + 90 × quest except the tutorial bosses', () => {
    for (const q of QUESTS.main.nodes) {
      const n = q.n;
      const gold = n === 1 ? 6 : n <= 5 ? 18 : n <= 10 ? 24 : n <= 30 ? 30 : n <= 70 ? 33 : 36;
      assert.equal(q.goldPerFigure, gold, 'Q' + n + ' gold');
      if (!q.bossName) assert.equal(q.bossHp, 1500 + 90 * n, 'Q' + n + ' hp');
    }
    // the 1.7.0 tutorial bosses (tutorial-v2.md §10 item 8)
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => mainNode(n).bossHp), [250, 800, 800, 800, 1300, 1060, 1060, 1160, 1400, 1260]);
    assert.equal(mainNode(1).endGold, 10);
  });

  test('§4.3 quality bands of the main quest', () => {
    const bands = [
      [1, 10, ['common', 'standard'], [1, 3], [0, 0]],
      [11, 30, ['standard', 'uncommon'], [2, 8], [0, 0]],
      [31, 60, ['uncommon', 'rare'], [5, 14], [0, 0]],
      [61, 90, ['rare', 'heroic'], [10, 26], [1, 2]],
      [91, 100, ['heroic', 'legendary'], [20, 34], [2, 2]],
    ];
    for (const [from, to, rarities, levels, stages] of bands) {
      for (let n = from; n <= to; n++) {
        assert.deepEqual(mainNode(n).band.rarities, rarities, 'Q' + n);
        assert.deepEqual(mainNode(n).band.levels, levels, 'Q' + n);
        assert.deepEqual(mainNode(n).band.stages, stages, 'Q' + n);
      }
    }
    assert.deepEqual(Q.MAIN_BANDS, [[1, 10], [11, 30], [31, 60], [61, 90], [91, 100]]);
    assert.deepEqual(Q.PORTAL_BANDS, [[1, 8], [9, 17], [18, 25]]);
  });

  test('main boss tokens (Neophyte ≤30, Summoner 31–70, Archmage 71–100) and piece rarities (none <31, Heroic 31–70, Legendary 71+)', () => {
    for (const q of QUESTS.main.nodes) {
      assert.equal(q.token, q.n <= 30 ? 'neophyte' : q.n <= 70 ? 'summoner' : 'archmage', 'Q' + q.n);
      assert.equal(q.pieceRarity, q.n < 31 ? null : q.n < 71 ? 'heroic' : 'legendary', 'Q' + q.n);
    }
  });

  test('fixed main bosses exist in the catalog (Q1 Throat-Cutter, Q33 Tunnel Digger … Q100 Imperial Dragon++)', () => {
    assert.equal(mainNode(1).boss, 'throat-cutter');
    assert.equal(mainNode(33).boss, 'tunnel-digger');
    assert.equal(mainNode(100).boss, 'imperial-dragon');
    assert.equal(mainNode(100).bossStage, 2);
    for (let n = 33; n <= 100; n++) assert.ok(mainNode(n).boss && db.get(mainNode(n).boss), 'Q' + n + ' boss');
    for (const q of QUESTS.main.nodes) if (q.boss) assert.ok(!db.get(q.boss).trainer, 'trainer boss Q' + q.n);
  });

  test('portals: the 8 portals in rotation order, 25 nodes each, 7-day rotation', () => {
    assert.deepEqual(QUESTS.portals.map((p) => p.id), [
      'the-dark-beyond', 'dawn-of-eternity', 'desert-twilight', 'divine-peace', 'dragon-hunt',
      'dread-empress', 'dwarven-rage', 'dying-dreams',
    ]);
    assert.equal(QUESTS.portalRotationDays, 7);
    for (const p of QUESTS.portals) {
      assert.equal(p.nodes.length, 25, p.id);
      p.nodes.forEach((q, i) => assert.equal(q.n, i + 1));
      assert.ok(p.tokens.low.name && p.tokens.high.name, p.id + ' tokens');
      assert.equal(p.tokens.low.gems, undefined, 'no gem price on the low token (its pack costs 250 gems per pick)');
      assert.equal(p.tokens.high.gems, 1000);
    }
  });

  test('portal nodes: bands 1–8 / 9–17 / 18–25, stamina per tap 6→17, gold 34→97, HP ≈ 3,965 + 260 × node, boss list', () => {
    for (const p of QUESTS.portals) {
      for (const q of p.nodes) {
        const b = q.n <= 8 ? [['uncommon', 'rare'], [8, 18], [0, 0]] : q.n <= 17 ? [['rare', 'heroic'], [14, 30], [1, 1]] : [['heroic', 'legendary'], [24, 44], [2, 2]];
        assert.deepEqual(q.band.rarities, b[0], `${p.id} ${q.n}`);
        assert.deepEqual(q.band.levels, b[1], `${p.id} ${q.n}`);
        assert.deepEqual(q.band.stages, b[2], `${p.id} ${q.n}`);
        assert.ok(q.boss && db.get(q.boss) && !db.get(q.boss).trainer, `${p.id} ${q.n} boss`);
        assert.equal(q.stamina, q.figures * q.staminaPerTap);
        assert.ok(q.staminaPerTap >= 3 && q.staminaPerTap <= 17, `${p.id} ${q.n} spt`);
        assert.ok(q.goldPerFigure >= 15 && q.goldPerFigure <= 97, `${p.id} ${q.n} gold`);
        assert.ok(['low', 'high'].includes(q.token));
        assert.equal(q.highTokenFirstWin, q.n === 25, `${p.id} ${q.n} high token on node 25 only`);
        assert.ok(['rare', 'heroic', 'legendary'].includes(q.pieceRarity));
        assert.equal(q.bossCards, 4);
      }
      const hp = p.nodes.map((q) => q.bossHp);
      for (let i = 1; i < hp.length; i++) assert.ok(hp[i] >= hp[i - 1], p.id + ' boss hp rises');
      // piece quality rises Rare → Heroic → Legendary (the wiki tables wobble inside the middle band, never
      // across the outer ones: no Legendary piece in nodes 1–8, no Rare piece in nodes 18–25) and tokens go low → high
      assert.equal(p.nodes[0].pieceRarity, 'rare');
      assert.equal(p.nodes[24].pieceRarity, 'legendary');
      for (const q of p.nodes) {
        if (q.n >= 18) assert.notEqual(q.pieceRarity, 'rare', p.id + ' ' + q.n);
        if (q.n <= 8) assert.notEqual(q.pieceRarity, 'legendary', p.id + ' ' + q.n);
      }
      assert.equal(p.nodes[0].token, 'low'); assert.equal(p.nodes[24].token, 'high');
      for (let i = 1; i < 25; i++) assert.ok(!(p.nodes[i - 1].token === 'high' && p.nodes[i].token === 'low' && p.nodes[i + 1] && p.nodes[i + 1].token === 'low'), p.id + ' tokens never fall back to low for good');
    }
    // the wiki-documented curve of The Dark Beyond
    const tdb = portal(0);
    assert.equal(tdb.nodes[0].staminaPerTap, 6); assert.equal(tdb.nodes[24].staminaPerTap, 17);
    assert.equal(tdb.nodes[0].goldPerFigure, 34); assert.equal(tdb.nodes[24].goldPerFigure, 97);
    assert.equal(tdb.nodes[0].bossHp, 3965);
    // wiki values drift up to +260 above the linear "≈ 3,965 + 260 × node" estimate of the design
    for (const q of tdb.nodes) assert.ok(within(q.bossHp, 3965 + 260 * (q.n - 1), 300), tdb.id + ' hp ' + q.n + ' = ' + q.bossHp);
    assert.ok(tdb.nodes[24].bossHp >= 10000 && tdb.nodes[24].bossHp <= 10500);
  });

  test('set collections: main 17 cards / 31,700 gems; portals 8 cards / 4,000–5,600 gems; cards exist and are not trainers', () => {
    assert.equal(QUESTS.main.cards.length, 17);
    assert.equal(QUESTS.main.gemReward, 31700);
    assert.equal(new Set(QUESTS.main.cards).size, 17);
    for (const id of QUESTS.main.cards) assert.ok(db.get(id) && !db.get(id).trainer, id);
    const wikiRewards = { 'the-dark-beyond': 4600, 'dawn-of-eternity': 5600, 'desert-twilight': 4000, 'divine-peace': 4000, 'dragon-hunt': 5000, 'dread-empress': 4500, 'dwarven-rage': 4000, 'dying-dreams': 5300 };
    for (const p of QUESTS.portals) {
      assert.ok(p.gemReward >= 4000 && p.gemReward <= 5600, p.id + ' reward');
      if (wikiRewards[p.id]) assert.equal(p.gemReward, wikiRewards[p.id], p.id);
      assert.equal(p.cards.length, 8, p.id + ' set size');
      assert.equal(new Set(p.cards).size, p.cards.length);
      for (const id of p.cards) assert.ok(db.get(id) && !db.get(id).trainer, p.id + ' ' + id);
    }
  });
});

test('every card whose text names a side (left / right / neighbors) is encoded with that side (2026-10-12: directions are the card\u0027s own; enemy cards face the player)', () => {
  const cardsJson = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8'));
  const all = Array.isArray(cardsJson) ? cardsJson : (cardsJson.cards || Object.values(cardsJson));
  const named = [];
  const bad = [];
  for (const card of all) {
    const ab = card.ability;
    if (!ab || !ab.buffs) continue;
    const text = String(ab.text || '').toLowerCase();
    const hasL = /\bleft\b/.test(text), hasR = /\bright\b/.test(text), neigh = /neighbo/.test(text);
    if (!hasL && !hasR && !neigh) continue;
    named.push(card.id);
    const dirs = new Set(ab.buffs.flatMap((b) => b.directions || []));
    const symmetric = ab.buffs.some((b) => b.type === 'stun_pattern') || (dirs.has('left') && dirs.has('right')) || (dirs.has('frontLeft') && dirs.has('frontRight'));
    const okL = !hasL || dirs.has('left') || dirs.has('frontLeft');
    const okR = !hasR || dirs.has('right') || dirs.has('frontRight');
    const okN = !(neigh && !hasL && !hasR) || symmetric;
    if (!(okL && okR && okN)) bad.push(`${card.id}: "${ab.text}" -> ${[...dirs].join(',')}`);
  }
  assert.ok(named.length >= 35, `${named.length} cards name a side`);
  assert.deepEqual(bad, [], 'text and directions agree');
});
