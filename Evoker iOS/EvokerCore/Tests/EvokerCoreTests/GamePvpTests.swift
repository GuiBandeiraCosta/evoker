import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/game-pvp.test.js`: the simulated players, the Arena, card pieces and replays, on the fixture
/// catalog and against game-design §5 on the real data.
final class GamePvpTests: XCTestCase {
    // MARK: fixture catalog

    func testSimulatedPoolFixture() {
        let f = Fx.fresh()
        let base = Fx.richFixture(f.state)
        let p1 = OpponentOps.generatePool(base, deps: f.deps, now: Fx.T0)
        let p2 = OpponentOps.generatePool(base, deps: f.deps, now: Fx.T0)
        XCTAssertEqual(p1.sim.players.count, 60)
        XCTAssertEqual(Set(p1.sim.players.map { $0.id }).count, 60)
        XCTAssertEqual(p1.sim.players, p2.sim.players)
        XCTAssertEqual(p1.sim.day, "2026-10-07")
        for sim in p1.sim.players {
            XCTAssertTrue(sim.level >= 7 && sim.level <= 15, "level \(sim.level)")
            XCTAssertFalse(sim.name.isEmpty)
            XCTAssertTrue(sim.avatar >= 0 && sim.avatar < 12)
            let cards = sim.deck.compactMap { $0 }
            XCTAssertTrue(cards.count >= 3 && cards.count <= 5)
            let mana = cards.reduce(0) { $0 + f.deps.db.get($1.cardId)!.mana }
            XCTAssertLessThanOrEqual(mana, sim.manaMax)
            XCTAssertEqual(sim.hpMax, OpponentOps.simStats(level: sim.level).hpMax)
            for c in cards { XCTAssertLessThanOrEqual(c.level, f.deps.stats.capFor(f.deps.db.get(c.cardId)!, stage: c.stage)) }
        }
        let low = OpponentOps.buildSimDeck(rng: Mulberry32(1), deps: f.deps, level: 1, power: 1)
        XCTAssertNil(low[0])
        XCTAssertNil(low[4])
        XCTAssertTrue(low[1...3].allSatisfy { $0 != nil && [Rarity.common, .standard].contains(f.deps.db.get($0!.cardId)!.rarity) })
        let strong = OpponentOps.buildSimDeck(rng: Mulberry32(1), deps: f.deps, level: 100, power: 1)
        XCTAssertTrue(strong.compactMap { $0 }.allSatisfy { $0.stage == 3 && [Rarity.heroic, .legendary].contains(f.deps.db.get($0.cardId)!.rarity) })
    }

    func testPoolRefreshOncePerDay() {
        let f = Fx.fresh()
        let p = OpponentOps.ensurePool(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0)
        XCTAssertTrue(p.refreshed)
        let same = OpponentOps.ensurePool(p.state, deps: f.deps, now: Fx.T0 + 60 * Fx.MIN)
        XCTAssertFalse(same.refreshed)
        XCTAssertEqual(same.state, p.state)
        let jumped = Fx.withPlayer(p.state) { $0.level = 40 }
        let next = OpponentOps.ensurePool(jumped, deps: f.deps, now: Fx.T0 + Fx.DAY)
        XCTAssertTrue(next.refreshed)
        XCTAssertEqual(next.state.sim.day, "2026-10-08")
        XCTAssertTrue(next.state.sim.players.allSatisfy { $0.level >= 35 })
        XCTAssertTrue(next.state.sim.players.contains { $0.level >= 39 })
        let noJump = OpponentOps.ensurePool(p.state, deps: f.deps, now: Fx.T0 + Fx.DAY).state
        let total: (GameState) -> Int = { $0.sim.players.reduce(0) { $0 + $1.level } }
        XCTAssertGreaterThan(total(noJump), total(p.state))
        XCTAssertLessThanOrEqual(total(noJump) - total(p.state), 60)
    }

    func testArenaOffersFixture() {
        let f = Fx.fresh()
        let r = ArenaOps.ensureOffers(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0)
        XCTAssertEqual(r.info.offers.count, 3)
        XCTAssertEqual(r.info.offers.map { $0.difficulty }, [.easy, .normal, .hard])
        XCTAssertEqual(r.info.offers.map { $0.power }, [0.7, 1, 1.3])
        XCTAssertTrue(r.info.offers[0].level >= 8 && r.info.offers[0].level <= 10)
        XCTAssertTrue(r.info.offers[1].level >= 9 && r.info.offers[1].level <= 11)
        XCTAssertTrue(r.info.offers[2].level >= 11 && r.info.offers[2].level <= 13)
        XCTAssertEqual(r.info.rerollAt, Fx.T0 + ArenaOps.offerRotationMs)
        XCTAssertEqual(ArenaOps.ensureOffers(r.state, deps: f.deps, now: Fx.T0 + 1000).state, r.state)
        let later = ArenaOps.ensureOffers(r.state, deps: f.deps, now: Fx.T0 + ArenaOps.offerRotationMs + 1)
        XCTAssertNotEqual(later.state, r.state)
    }

    func testArenaFightFixture() throws {
        let f = Fx.fresh(winner: .attacker)
        let s = ArenaOps.ensureOffers(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0).state
        let cost = StateOps.deckMana(s, deps: f.deps)
        XCTAssertEqual(PvpOps.canFightPvp(s, deps: f.deps).mana, cost)
        let broke = Fx.withPlayer(s) { $0.mana = cost - 1 }
        XCTAssertEqual(PvpOps.canFightPvp(broke, deps: f.deps), CanFight(ok: false, reason: "Not enough mana", mana: cost, needsPotion: true))
        assertThrows(try ArenaOps.fightArena(broke, deps: f.deps, now: Fx.T0, offerIndex: 1, event: nil), "mana")
        let offer = s.sim.arena.offers[1]
        let sim = OpponentOps.getSim(s, simId: offer.simId)!
        let enemyMana = sim.deck.compactMap { $0 }.reduce(0) { $0 + f.deps.db.get($1.cardId)!.mana }
        let r = try ArenaOps.fightArena(s, deps: f.deps, now: Fx.T0, offerIndex: 1, event: nil)
        XCTAssertTrue(r.info.won)
        XCTAssertEqual(r.info.rewards.gold, enemyMana * 6 * 2)
        XCTAssertEqual(r.info.rewards.tournamentPoints, 10)
        XCTAssertEqual(r.state.player.mana, 200 - cost)
        XCTAssertEqual(r.state.player.tournamentPoints, 10)
        XCTAssertEqual(r.state.player.battlesWon, 1)
        XCTAssertEqual(r.state.replays.count, 1)
        XCTAssertEqual(r.state.replays[0].mode, "arena")
        XCTAssertEqual(r.state.replays[0].defender.name, sim.name)
        XCTAssertEqual(r.info.rewards.cardXp, PlayerOps.cardFightXp(enemyDeckMana: enemyMana, won: true, infiniteWisdom: false))
        XCTAssertNotEqual(r.state.sim.arena.offers[1].simId + String(r.state.sim.arena.rerollAt), offer.simId + String(s.sim.arena.rerollAt))
        f.engine.winner = .defender
        let loss = try ArenaOps.fightArena(s, deps: f.deps, now: Fx.T0, offerIndex: 2, event: nil)
        XCTAssertFalse(loss.info.won)
        XCTAssertEqual(loss.info.rewards.tournamentPoints, 0)
        XCTAssertEqual(loss.state.player.battlesWon, 0)
        let hard = f.engine.calls.last!
        XCTAssertEqual(hard.defender.player.maxHp, JSMath.roundInt(Double(OpponentOps.getSim(s, simId: s.sim.arena.offers[2].simId)!.hpMax) * 1.3))
        XCTAssertEqual(hard.attacker.player.maxHp, 1500)
    }

    func testPiecesHuntsFixture() throws {
        let f = Fx.fresh()
        let state = Fx.richFixture(f.state)
        XCTAssertEqual(PieceOps.piecesTotal(deps: f.deps, cardId: "arch-angel"), 2)
        XCTAssertEqual(PieceOps.piecesTotal(deps: f.deps, cardId: "dwarf-king"), 10)
        let r1 = try PieceOps.addPiece(state, deps: f.deps, now: Fx.T0, cardId: "arch-angel")
        XCTAssertFalse(r1.info.completed)
        XCTAssertEqual(r1.state.pieces[0].owned, 1)
        XCTAssertNotNil(r1.state.pieces[0].holderId)
        XCTAssertNotNil(OpponentOps.getSim(r1.state, simId: r1.state.pieces[0].holderId!))
        let r2 = try PieceOps.addPiece(r1.state, deps: f.deps, now: Fx.T0, cardId: "arch-angel")
        XCTAssertTrue(r2.info.completed)
        XCTAssertEqual(r2.state.pieces.count, 0)
        XCTAssertEqual(r2.state.cards.first { $0.uid == r2.info.uid }!.cardId, "arch-angel")
        var s = r2.state
        for id in ["dwarf-king", "imperial-dragon", "rat-eater", "armorer", "phoenix", "guruk-the-destroyer", "sister-elenia", "airborne-parasite"] {
            s = try PieceOps.addPiece(s, deps: f.deps, now: Fx.T0, cardId: id).state
        }
        XCTAssertEqual(s.pieces.count, PieceOps.maxHunts)
        let full = try PieceOps.addPiece(s, deps: f.deps, now: Fx.T0, cardId: "basilisk")
        XCTAssertTrue(full.info.full)
        XCTAssertEqual(full.state.pieces.count, 8)
    }

    func testPieceFightsFixture() throws {
        var f = Fx.fresh(winner: .attacker)
        f.state = try PieceOps.addPiece(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0, cardId: "rat-eater").state
        f.state.pieces[0].owned = 3
        f.engine.winner = .defender
        let loss = try PieceOps.fightHolder(f.state, deps: f.deps, now: Fx.T0, index: 0, event: nil)
        XCTAssertFalse(loss.info.won)
        XCTAssertEqual(loss.state.pieces[0].owned, 3)
        XCTAssertEqual(loss.state.player.mana, 200 - StateOps.deckMana(f.state, deps: f.deps))
        f.engine.winner = .attacker
        let win = try PieceOps.fightHolder(f.state, deps: f.deps, now: Fx.T0, index: 0, event: nil)
        XCTAssertTrue(win.info.won)
        XCTAssertTrue(win.info.completed)
        XCTAssertEqual(win.state.pieces.count, 0)
        XCTAssertEqual(win.state.cards.first { $0.uid == win.info.uid }!.cardId, "rat-eater")
        XCTAssertEqual(win.info.tournamentPoints, 10)
        XCTAssertEqual(win.state.player.battlesWon, 1)
    }

    func testPiecePricesFixture() throws {
        XCTAssertEqual(PieceOps.missingPrice(rarity: .uncommon, missing: 1, event: nil), 20)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .rare, missing: 3, event: nil), 140)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .heroic, missing: 5, event: nil), 1700)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .legendary, missing: 9, event: nil), 4000)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .legendary, missing: 4, event: .cardPieceDay), 400)
        let f = Fx.fresh()
        let state = try PieceOps.addPiece(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0, cardId: "armorer").state
        let r = try PieceOps.buyMissingPieces(state, deps: f.deps, now: Fx.T0, index: 0, event: nil)
        XCTAssertEqual(r.info.cost, 140)
        XCTAssertEqual(r.state.player.gems, 5000 - 140)
        XCTAssertEqual(r.state.pieces.count, 0)
        XCTAssertEqual(r.state.cards.first { $0.uid == r.info.uid }!.cardId, "armorer")
        let fp = try PieceOps.buyFirstPiece(r.state, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertEqual(fp.info.cost, 100)
        XCTAssertEqual(fp.state.pieces[0].cardId, fp.info.cardId)
        XCTAssertTrue([Rarity.rare, .heroic].contains(f.deps.db.get(fp.info.cardId)!.rarity))
        XCTAssertEqual(try PieceOps.buyFirstPiece(r.state, deps: f.deps, now: Fx.T0, event: .cardPieceDay).info.cost, 50)
    }

    func testDailyRaidsFixture() throws {
        let f = Fx.fresh()
        var state = Fx.richFixture(f.state)
        for id in ["dwarf-king", "imperial-dragon", "sister-elenia", "guruk-the-destroyer", "phoenix"] { state = try PieceOps.addPiece(state, deps: f.deps, now: Fx.T0, cardId: id).state }
        state.pieces = state.pieces.map { var h = $0; h.owned = 3; return h }
        XCTAssertEqual(PieceOps.dailyRaids(state, deps: f.deps, now: Fx.T0).stolen, [])
        var stolenTotal = 0
        var s = state
        for d in 1...40 {
            let r = PieceOps.dailyRaids(s, deps: f.deps, now: Fx.T0 + Int64(d) * Fx.DAY)
            stolenTotal += r.stolen.count
            XCTAssertEqual(PieceOps.dailyRaids(r.state, deps: f.deps, now: Fx.T0 + Int64(d) * Fx.DAY).stolen.count, 0)
            s = r.state
        }
        XCTAssertTrue(stolenTotal >= 8 && stolenTotal <= 15, "stolen \(stolenTotal)")
        XCTAssertEqual(s.notices.filter { $0.type == "raid" }.count, stolenTotal)
        XCTAssertTrue(s.pieces.allSatisfy { $0.owned >= 0 })
        var off = state
        off.settings.raids = false
        XCTAssertEqual(PieceOps.dailyRaids(off, deps: f.deps, now: Fx.T0 + Fx.DAY).stolen, [])
        XCTAssertEqual(PieceOps.dailyRaids(state, deps: f.deps, now: Fx.T0 + Fx.DAY).stolen, PieceOps.dailyRaids(state, deps: f.deps, now: Fx.T0 + Fx.DAY).stolen)
    }

    // MARK: §5 simulated players and arena (real data)

    func testPoolOfSixtyAroundThePlayer() {
        let d = Fx.deps().deps
        let s = Fx.rich(Fx.freshReal())
        let g = OpponentOps.ensurePool(s, deps: d, now: Fx.T0)
        XCTAssertTrue(g.refreshed)
        let players = g.state.sim.players
        XCTAssertEqual(players.count, 60)
        XCTAssertEqual(OpponentOps.poolSize, 60)
        XCTAssertEqual(Set(players.map { $0.id }).count, 60)
        XCTAssertEqual(g.state.sim.day, JSDate.utcDay(Fx.T0))
        for sim in players {
            XCTAssertTrue(sim.level >= 7 && sim.level <= 15, "level \(sim.level)")
            XCTAssertTrue(sim.avatar >= 0 && sim.avatar < 12)
            XCTAssertTrue(Fx.names.names.contains(sim.name))
            XCTAssertEqual(sim.deck.count, 5)
            let cards = sim.deck.compactMap { $0 }
            XCTAssertGreaterThanOrEqual(cards.count, 1)
            XCTAssertLessThanOrEqual(OpponentOps.simDeckMana(sim, deps: d), sim.manaMax, "deck within the sim max mana")
            for c in cards {
                let def = Fx.db.get(c.cardId)
                XCTAssertTrue(def != nil && !def!.isTrainer, "trainer in a sim deck")
                XCTAssertTrue(c.level >= 1 && c.level <= d.stats.capFor(def!, stage: c.stage))
            }
            if sim.level < 3 { XCTAssertNil(sim.deck[4]) }
            if sim.level < 5 { XCTAssertNil(sim.deck[0]) }
            XCTAssertEqual(OpponentOps.simStats(level: sim.level), SimStatsMax(hpMax: sim.hpMax, staminaMax: sim.staminaMax, manaMax: sim.manaMax))
        }
        XCTAssertFalse(OpponentOps.ensurePool(g.state, deps: d, now: Fx.T0 + 3 * 60 * Fx.MIN).refreshed, "same day: untouched")
        let next = OpponentOps.ensurePool(g.state, deps: d, now: Fx.T0 + Fx.DAY)
        XCTAssertTrue(next.refreshed)
        XCTAssertEqual(next.state.sim.day, JSDate.utcDay(Fx.T0 + Fx.DAY))
        XCTAssertEqual(next.state.sim.players.count, 60)
        let grew = zip(next.state.sim.players, players).filter { $0.level > $1.level }.count
        XCTAssertTrue(grew > 5 && grew < 35, "sims gain levels slowly: \(grew)")
        let far = Fx.withPlayer(g.state) { $0.level = 40 }
        let re = OpponentOps.ensurePool(far, deps: d, now: Fx.T0 + Fx.DAY)
        XCTAssertTrue(re.state.sim.players.allSatisfy { $0.level >= 39 && $0.level <= 43 })
    }

    func testArenaOffersRanges() {
        let d = Fx.deps().deps
        let s = Fx.rich(Fx.freshReal())
        let eo = ArenaOps.ensureOffers(s, deps: d, now: Fx.T0)
        XCTAssertEqual(eo.info.offers.count, 3)
        XCTAssertEqual(eo.info.offers.map { $0.difficulty }, [.easy, .normal, .hard])
        XCTAssertEqual(eo.info.offers.map { $0.color }, ["green", "yellow", "red"])
        XCTAssertEqual(eo.info.offers.map { $0.power }, [0.7, 1, 1.3])
        let ranges = [(-2, 0), (-1, 1), (1, 3)]
        for (i, o) in eo.info.offers.enumerated() {
            let sim = OpponentOps.getSim(eo.state, simId: o.simId)!
            XCTAssertTrue(sim.level - 10 >= ranges[i].0 && sim.level - 10 <= ranges[i].1, "\(o.difficulty) level \(sim.level)")
            XCTAssertEqual(o.level, sim.level)
            let info = ArenaOps.offerInfo(eo.state, deps: d, offerIndex: i)!
            XCTAssertEqual(info.level, sim.level)
            XCTAssertTrue(info.bestCard != nil && info.stamina == sim.staminaMax && info.mana == sim.manaMax && info.hp == sim.hpMax)
            XCTAssertEqual(info.quests, sim.questsDone); XCTAssertEqual(info.battlesWon, sim.battlesWon)
            XCTAssertEqual(info.difficulty, o.difficulty)
        }
        XCTAssertEqual(Set(eo.info.offers.map { $0.simId }).count, 3)
        XCTAssertEqual(eo.info.rerollAt, Fx.T0 + 30 * Fx.MIN)
        XCTAssertEqual(ArenaOps.offerRotationMs, 30 * Fx.MIN)
        let same = ArenaOps.ensureOffers(eo.state, deps: d, now: Fx.T0 + 29 * Fx.MIN)
        XCTAssertEqual(same.info.offers, eo.info.offers)
        let expired = ArenaOps.ensureOffers(eo.state, deps: d, now: Fx.T0 + 30 * Fx.MIN)
        XCTAssertEqual(expired.info.rerollAt, Fx.T0 + 60 * Fx.MIN)
    }

    func testArenaFightRewards() throws {
        func run(_ winner: Winner, _ event: DailyEventId?) throws -> (s: GameState, sim: SimPlayer, r: (state: GameState, info: ArenaResult), d: Deps, engine: FixtureEngine) {
            let dd = Fx.deps(winner)
            let s = ArenaOps.ensureOffers(Fx.rich(Fx.freshReal()), deps: dd.deps, now: Fx.T0).state
            let offer = s.sim.arena.offers[1]
            let sim = OpponentOps.getSim(s, simId: offer.simId)!
            let r = try ArenaOps.fightArena(s, deps: dd.deps, now: Fx.T0, offerIndex: 1, event: event)
            return (s, sim, r, dd.deps, dd.engine)
        }
        let w = try run(.attacker, nil)
        let enemyMana = OpponentOps.simDeckMana(w.sim, deps: w.d)
        XCTAssertTrue(w.r.info.won)
        XCTAssertEqual(w.r.state.player.mana, 300 - StateOps.deckMana(w.s, deps: w.d), "deck mana spent")
        XCTAssertEqual(w.r.info.rewards.gold, enemyMana * 6 * 2)
        XCTAssertEqual(w.r.state.player.gold, w.s.player.gold + enemyMana * 12)
        XCTAssertEqual(w.r.info.rewards.tournamentPoints, 10)
        XCTAssertEqual(w.r.state.player.tournamentPoints, 10)
        XCTAssertEqual(w.r.state.player.battlesWon, 1)
        XCTAssertEqual(w.r.info.rewards.cardXp, PlayerOps.cardFightXp(enemyDeckMana: enemyMana, won: true, infiniteWisdom: false))
        XCTAssertEqual(w.r.info.rewards.playerXp, PlayerOps.playerFightXp(opponentLevel: w.sim.level, won: true))
        XCTAssertEqual(w.r.state.player.xp, w.s.player.xp + w.r.info.rewards.playerXp)
        XCTAssertEqual(w.r.state.sim.arena.rerollAt, Fx.T0 + 30 * Fx.MIN, "offers rerolled after the fight")
        XCTAssertEqual(w.r.state.replays.count, 1)
        XCTAssertEqual(w.r.state.replays[0].mode, "arena")
        XCTAssertTrue(w.r.state.replays[0].won)
        XCTAssertEqual(w.r.info.opponent.name, w.sim.name)
        XCTAssertEqual(w.engine.calls[0].defender.player.maxHp, w.sim.hpMax, "normal difficulty: sim at full strength")
        let l = try run(.defender, nil)
        let lm = OpponentOps.simDeckMana(l.sim, deps: l.d)
        XCTAssertFalse(l.r.info.won)
        XCTAssertEqual(l.r.info.rewards.gold, lm * 6)
        XCTAssertEqual(l.r.info.rewards.tournamentPoints, 0)
        XCTAssertEqual(l.r.state.player.battlesWon, 0)
        XCTAssertEqual(l.r.state.player.mana, 300 - StateOps.deckMana(l.s, deps: l.d), "mana is lost on a loss too")
        XCTAssertEqual(l.r.info.rewards.playerXp, PlayerOps.playerFightXp(opponentLevel: l.sim.level, won: false))
        let g = try run(.attacker, .goldenDay)
        XCTAssertEqual(g.r.info.rewards.gold, JSMath.roundInt(Double(OpponentOps.simDeckMana(g.sim, deps: g.d) * 12) * 1.5))
        let wis = try run(.attacker, .infiniteWisdom)
        XCTAssertEqual(wis.r.info.rewards.cardXp, PlayerOps.cardFightXp(enemyDeckMana: OpponentOps.simDeckMana(wis.sim, deps: wis.d), won: true, infiniteWisdom: true))
        let dh = Fx.deps()
        let sh = ArenaOps.ensureOffers(Fx.rich(Fx.freshReal()), deps: dh.deps, now: Fx.T0).state
        let hard = try ArenaOps.fightArena(sh, deps: dh.deps, now: Fx.T0, offerIndex: 2, event: nil)
        let hardSim = OpponentOps.getSim(sh, simId: sh.sim.arena.offers[2].simId)!
        XCTAssertEqual(dh.engine.calls[0].defender.player.maxHp, JSMath.roundInt(Double(hardSim.hpMax) * 1.3))
        XCTAssertEqual(hard.info.rewards.playerXp, PlayerOps.playerFightXp(opponentLevel: JSMath.roundInt(Double(hardSim.level) * 1.3), won: true))
        let easy = try ArenaOps.fightArena(sh, deps: dh.deps, now: Fx.T0, offerIndex: 0, event: nil)
        let easySim = OpponentOps.getSim(sh, simId: sh.sim.arena.offers[0].simId)!
        XCTAssertEqual(dh.engine.calls[1].defender.player.maxHp, JSMath.roundInt(Double(easySim.hpMax) * 0.7))
        XCTAssertTrue(easy.info.won)
    }

    func testManaGate() throws {
        let d = Fx.deps().deps
        let s = ArenaOps.ensureOffers(Fx.rich(Fx.freshReal()), deps: d, now: Fx.T0).state
        let low = Fx.withPlayer(s) { $0.mana = StateOps.deckMana(s, deps: d) - 1 }
        let c = PvpOps.canFightPvp(low, deps: d)
        XCTAssertFalse(c.ok); XCTAssertTrue(c.needsPotion); XCTAssertEqual(c.mana, StateOps.deckMana(s, deps: d))
        assertThrows(try ArenaOps.fightArena(low, deps: d, now: Fx.T0, offerIndex: 0, event: nil), "mana")
        XCTAssertTrue(PvpOps.canFightPvp(Fx.withPlayer(s) { $0.mana = StateOps.deckMana(s, deps: d) }, deps: d).ok)
        assertThrows(try ArenaOps.fightArena(s, deps: d, now: Fx.T0, offerIndex: 3, event: nil), "No such opponent")
    }

    func testReplaysKeepTheLastTen() throws {
        let d = Fx.deps().deps
        var s = ArenaOps.ensureOffers(Fx.rich(Fx.freshReal()), deps: d, now: Fx.T0).state
        for i in 0..<12 { s = try ArenaOps.fightArena(s, deps: d, now: Fx.T0 + Int64(i) * Fx.MIN, offerIndex: 0, event: nil).state }
        XCTAssertEqual(s.replays.count, 10)
        XCTAssertEqual(PvpOps.maxReplays, 10)
        XCTAssertEqual(s.replays[0].at, Fx.T0 + 11 * Fx.MIN, "newest first")
        for r in s.replays {
            XCTAssertEqual(r.attacker.cards.count, 5)
            XCTAssertEqual(r.defender.cards.count, 5)
        }
    }

    // MARK: §5 pieces (real data)

    func testPiecesPerRarity() {
        XCTAssertEqual(PieceOps.maxHunts, 8)
        let d = Fx.deps().deps
        XCTAssertEqual(PieceOps.piecesTotal(deps: d, cardId: Fx.sample(.uncommon).id), 2)
        XCTAssertEqual(PieceOps.piecesTotal(deps: d, cardId: Fx.sample(.rare).id), 4)
        XCTAssertEqual(PieceOps.piecesTotal(deps: d, cardId: Fx.sample(.heroic).id), 6)
        XCTAssertEqual(PieceOps.piecesTotal(deps: d, cardId: Fx.sample(.legendary).id), 10)
        XCTAssertEqual(PieceOps.piecesTotal(deps: d, cardId: Fx.sample(.ultimate).id), 12)
    }

    func testGemPricesForMissingPieces() {
        let table: [Rarity: [Int]] = [.uncommon: [20], .rare: [30, 60, 140], .heroic: [170, 285, 625, 1100, 1700], .legendary: [125, 200, 450, 800, 1250, 1750, 2500, 3200, 4000]]
        for (r, prices) in table {
            for (i, price) in prices.enumerated() {
                XCTAssertEqual(PieceOps.missingPrice(rarity: r, missing: i + 1, event: nil), price, "\(r) \(i + 1)")
                XCTAssertEqual(PieceOps.missingPrice(rarity: r, missing: i + 1, event: .cardPieceDay), JSMath.ceilInt(Double(price) / 2), "\(r) \(i + 1) event")
            }
        }
        XCTAssertEqual(PieceOps.missingPrice(rarity: .rare, missing: 0, event: nil), 0)
        for r in [Rarity.uncommon, .rare, .heroic, .legendary, .ultimate] {
            XCTAssertEqual(Constants.piecePrices[r]!.count, Constants.rarity(r).pieces - 1, "\(r) prices cover every missing count")
            var m = 2
            while m < Constants.rarity(r).pieces { XCTAssertGreaterThan(PieceOps.missingPrice(rarity: r, missing: m, event: nil), PieceOps.missingPrice(rarity: r, missing: m - 1, event: nil)); m += 1 }
        }
        XCTAssertGreaterThan(PieceOps.missingPrice(rarity: .ultimate, missing: 11, event: nil), PieceOps.missingPrice(rarity: .legendary, missing: 9, event: nil))
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        s.pieces = [PieceHunt(cardId: Fx.sample(.heroic).id, owned: 2, total: 6, holderId: nil, raidDay: "")]
        XCTAssertEqual(PieceOps.huntBuyPrice(s, deps: d, index: 0, event: nil), 1100)
        XCTAssertEqual(PieceOps.huntBuyPrice(s, deps: d, index: 0, event: .cardPieceDay), 550)
    }

    func testFirstPieceOfAnEmptySlot() throws {
        let d = Fx.deps().deps
        var portalIds = Set<String>()
        for p in Fx.quests.portals { for id in p.cards { portalIds.insert(id) } }
        for seed in 1...30 {
            var s = Fx.rich(Fx.freshReal())
            s.seed = UInt32(seed)
            let r = try PieceOps.buyFirstPiece(s, deps: d, now: Fx.T0, event: nil)
            XCTAssertEqual(r.info.cost, 100)
            XCTAssertEqual(r.state.player.gems, s.player.gems - 100)
            XCTAssertEqual(r.info.index, 0)
            let def = Fx.db.get(r.info.cardId)!
            XCTAssertTrue([Rarity.rare, .heroic].contains(def.rarity), "\(def.rarity)")
            XCTAssertFalse(def.isTrainer)
            XCTAssertTrue(portalIds.contains(def.id), "set card \(def.id)")
            XCTAssertEqual(r.state.pieces[0].owned, 1)
            XCTAssertEqual(r.state.pieces[0].total, PieceOps.piecesTotal(deps: d, cardId: def.id))
            XCTAssertTrue(r.state.pieces[0].holderId != nil && OpponentOps.getSim(r.state, simId: r.state.pieces[0].holderId!) != nil, "a holder is assigned")
        }
        let ev = try PieceOps.buyFirstPiece(Fx.rich(Fx.freshReal()), deps: d, now: Fx.T0, event: .cardPieceDay)
        XCTAssertEqual(ev.info.cost, 50)
        XCTAssertEqual(Constants.firstPieceGems, 100); XCTAssertEqual(Constants.firstPieceGemsEvent, 50)
        var full = Fx.rich(Fx.freshReal())
        full.pieces = (0..<8).map { PieceHunt(cardId: "x\($0)", owned: 1, total: 4, holderId: nil, raidDay: "") }
        assertThrows(try PieceOps.buyFirstPiece(full, deps: d, now: Fx.T0, event: nil), "slots")
        assertThrows(try PieceOps.buyFirstPiece(Fx.withPlayer(Fx.freshReal()) { $0.gems = 99 }, deps: d, now: Fx.T0, event: nil), "gems")
    }

    func testBossPieceDropStartsAHunt() throws {
        let d = Fx.deps().deps
        let def = Fx.sample(.rare)
        let s = Fx.rich(Fx.freshReal())
        let r1 = try PieceOps.addPiece(s, deps: d, now: Fx.T0, cardId: def.id)
        XCTAssertFalse(r1.info.completed); XCTAssertFalse(r1.info.full); XCTAssertEqual(r1.info.index, 0)
        XCTAssertEqual([r1.state.pieces[0].cardId, String(r1.state.pieces[0].owned), String(r1.state.pieces[0].total)], [def.id, "1", "4"])
        var s3 = r1.state
        s3 = try PieceOps.addPiece(s3, deps: d, now: Fx.T0, cardId: def.id).state
        s3 = try PieceOps.addPiece(s3, deps: d, now: Fx.T0, cardId: def.id).state
        XCTAssertEqual(s3.pieces[0].owned, 3)
        var fullS = s3
        while fullS.cards.count < 80 { fullS = Fx.give(fullS, d, "envoy").0 }
        let done = try PieceOps.addPiece(fullS, deps: d, now: Fx.T0, cardId: def.id)
        XCTAssertTrue(done.info.completed)
        XCTAssertNotNil(done.info.uid)
        XCTAssertEqual(StateOps.getCard(done.state, uid: done.info.uid!)!.cardId, def.id)
        XCTAssertEqual(StateOps.getCard(done.state, uid: done.info.uid!)!.stage, 0)
        XCTAssertEqual(StateOps.getCard(done.state, uid: done.info.uid!)!.level, 1)
        XCTAssertEqual(done.state.cards.count, 81)
        XCTAssertEqual(done.state.pieces.count, 0, "the slot is freed")
        var eight = s
        let rares = Array(Fx.db.byRarity(.rare).filter { !$0.isTrainer }.prefix(9))
        for i in 0..<8 { eight = try PieceOps.addPiece(eight, deps: d, now: Fx.T0, cardId: rares[i].id).state }
        XCTAssertEqual(eight.pieces.count, 8)
        let ninth = try PieceOps.addPiece(eight, deps: d, now: Fx.T0, cardId: rares[8].id)
        XCTAssertTrue(ninth.info.full)
        XCTAssertEqual(ninth.state, eight)
        let ap = try RewardOps.applyReward(eight, deps: d, now: Fx.T0, reward: .piece(rares[8].id))
        XCTAssertEqual(ap.reward.full, true)
        XCTAssertTrue(RewardOps.describeReward(ap.reward, db: Fx.db).contains("full"))
    }

    func testPieceFightStealsAPiece() throws {
        let def = Fx.sample(.uncommon) // 2 pieces
        func setup(_ winner: Winner) throws -> (d: Deps, s: GameState) {
            let dd = Fx.deps(winner).deps
            let s = try PieceOps.addPiece(Fx.rich(Fx.freshReal()), deps: dd, now: Fx.T0, cardId: def.id).state
            return (dd, s)
        }
        let l = try setup(.defender)
        let holderBefore = l.s.pieces[0].holderId
        let lr = try PieceOps.fightHolder(l.s, deps: l.d, now: Fx.T0, index: 0, event: nil)
        XCTAssertFalse(lr.info.won)
        XCTAssertFalse(lr.info.completed)
        XCTAssertEqual(lr.state.pieces[0].owned, 1, "a loss costs no piece")
        XCTAssertEqual(lr.state.player.mana, 300 - StateOps.deckMana(l.s, deps: l.d))
        XCTAssertEqual(lr.state.player.gems, l.s.player.gems)
        XCTAssertNotEqual(lr.state.pieces[0].holderId, holderBefore, "new holder after the fight")
        XCTAssertEqual(lr.state.replays[0].mode, "pieces")
        let w = try setup(.attacker)
        let wr = try PieceOps.fightHolder(w.s, deps: w.d, now: Fx.T0, index: 0, event: nil)
        XCTAssertTrue(wr.info.won)
        XCTAssertTrue(wr.info.completed, "second of 2 pieces completes the card")
        XCTAssertEqual(StateOps.getCard(wr.state, uid: wr.info.uid!)!.cardId, def.id)
        XCTAssertEqual(wr.state.pieces.count, 0)
        XCTAssertNil(wr.info.hunt)
        let d4 = Fx.deps(.attacker).deps
        let s4 = try PieceOps.addPiece(Fx.rich(Fx.freshReal()), deps: d4, now: Fx.T0, cardId: Fx.sample(.rare).id).state
        let r4 = try PieceOps.fightHolder(s4, deps: d4, now: Fx.T0, index: 0, event: nil)
        XCTAssertFalse(r4.info.completed)
        XCTAssertEqual(r4.state.pieces[0].owned, 2)
        XCTAssertTrue(r4.info.hunt?.holderId != nil && OpponentOps.getSim(r4.state, simId: r4.info.hunt!.holderId!) != nil)
        let sk = try PieceOps.skipHolder(r4.state, deps: d4, now: Fx.T0, index: 0)
        XCTAssertEqual(sk.player.gems, r4.state.player.gems - 10)
        XCTAssertNotEqual(sk.pieces[0].holderId, r4.state.pieces[0].holderId)
        XCTAssertEqual(PieceOps.skipGems, 10)
        let hh = PieceOps.huntHolder(sk, deps: d4, now: Fx.T0, index: 0)
        XCTAssertEqual(hh.holder?.id, sk.pieces[0].holderId)
    }

    func testBuyingTheMissingPieces() throws {
        let d = Fx.deps().deps
        let def = Fx.sample(.heroic)
        var s = Fx.rich(Fx.freshReal())
        s.pieces = [PieceHunt(cardId: def.id, owned: 1, total: 6, holderId: nil, raidDay: "")]
        let r = try PieceOps.buyMissingPieces(s, deps: d, now: Fx.T0, index: 0, event: nil)
        XCTAssertEqual(r.info.cost, 1700)
        XCTAssertEqual(r.state.player.gems, s.player.gems - 1700)
        XCTAssertEqual(StateOps.getCard(r.state, uid: r.info.uid)!.cardId, def.id)
        XCTAssertEqual(r.state.pieces.count, 0)
        let ev = try PieceOps.buyMissingPieces(s, deps: d, now: Fx.T0, index: 0, event: .cardPieceDay)
        XCTAssertEqual(ev.info.cost, 850)
        assertThrows(try PieceOps.buyMissingPieces(Fx.withPlayer(s) { $0.gems = 1699 }, deps: d, now: Fx.T0, index: 0, event: nil), "gems")
    }

    func testSimulatedRaidsOncePerDay() {
        let d = Fx.deps().deps
        let base = Fx.freshReal()
        let yesterday = JSDate.utcDay(Fx.T0 - Fx.DAY)
        let hunts = [
            PieceHunt(cardId: Fx.sample(.rare).id, owned: 2, total: 4, holderId: nil, raidDay: yesterday),
            PieceHunt(cardId: Fx.sample(.heroic).id, owned: 0, total: 6, holderId: nil, raidDay: yesterday),
        ]
        var stolen = 0
        let N = 2000
        for seed in 1...N {
            var s = base
            s.seed = UInt32(seed)
            s.pieces = hunts
            let r = PieceOps.dailyRaids(s, deps: d, now: Fx.T0)
            XCTAssertEqual(r.state.pieces[1].owned, 0, "a hunt without pieces cannot lose one")
            XCTAssertEqual(r.state.pieces[0].raidDay, JSDate.utcDay(Fx.T0))
            if !r.stolen.isEmpty {
                stolen += 1
                XCTAssertEqual(r.stolen, [hunts[0].cardId])
                XCTAssertEqual(r.state.pieces[0].owned, 1)
                XCTAssertEqual(r.state.notices.last?.type, "raid")
                XCTAssertEqual(r.state.notices.last?["cardId"]?.stringValue, hunts[0].cardId)
            } else {
                XCTAssertEqual(r.state.pieces[0].owned, 2)
            }
            let again = PieceOps.dailyRaids(r.state, deps: d, now: Fx.T0 + 60 * Fx.MIN)
            XCTAssertEqual(again.state, r.state)
            XCTAssertEqual(again.stolen, [])
        }
        XCTAssertTrue(Fx.within(Double(stolen) / Double(N), 0.2, 0.03), "raid rate \(Double(stolen) / Double(N))")
        for seed in 1...50 {
            var off = base
            off.seed = UInt32(seed)
            off.settings.raids = false
            off.pieces = hunts
            let r = PieceOps.dailyRaids(off, deps: d, now: Fx.T0)
            XCTAssertEqual(r.state, off, "raids disabled: untouched")
            XCTAssertEqual(r.stolen, [])
        }
    }
}
