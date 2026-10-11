import Foundation
import EvokerCore

/// Battle playback assets (port of `src/ui/battle/assets.js`): the sprites the client blended additively, the
/// original sound names (file stems of `GameAssets/sfx`) per effect and per tribe, and the seeded variant picker.
enum BattleSounds {
    /// Attack sounds of a tribe: wind-up, projectile, impact (TRIBE_SOUNDS).
    struct TribeSet {
        let windup: [String]
        let missile: [String]
        let impact: [String]
    }

    /// `variants(stem, n, padded)`: "<stem>01" … "<stem>0n" (or "<stem>1" … unpadded).
    static func variants(_ stem: String, _ n: Int, padded: Bool = true) -> [String] {
        (1...max(1, n)).map { i in padded ? "\(stem)\(i < 10 ? "0" : "")\(i)" : "\(stem)\(i)" }
    }

    static let tribeSounds: [Tribe: TribeSet] = [
        .orc: TribeSet(windup: variants("anim_attack_attacker_blood_", 3), missile: variants("anim_attack_missile_shadow_", 3), impact: variants("anim_attack_target_blood_", 3)),
        .elf: TribeSet(windup: variants("anim_attack_attacker_arcane_", 3), missile: variants("anim_attack_missile_flash_", 3), impact: variants("anim_attack_target_arcane_", 2)),
        .dwarf: TribeSet(windup: ["anim_attack_attacker_stronghit_01"], missile: variants("anim_attack_missile_shot_", 3), impact: variants("anim_attack_target_stronghit_", 3)),
        .neutral: TribeSet(windup: variants("anim_attack_attacker_sword_", 2), missile: variants("anim_attack_missile_fire_", 3), impact: variants("anim_attack_target_fire_", 2)),
    ]

    /// Attack sound set of a tribe (unknown tribes sound neutral) — `tribeSounds(tribe)`.
    static func tribeSet(_ tribe: Tribe?) -> TribeSet {
        tribeSounds[tribe ?? .neutral] ?? tribeSounds[.neutral]!
    }

    /// The other battle sounds (SOUNDS), each a list of interchangeable variants.
    enum Key: Hashable {
        case playerHit, bolt, abilityImpact, poison, kill, heal, healAffect, death, reflect, invulnerable, revive,
             raiseAttack, curse, curseAffect, nextRound, victory, defeat, bonus, rewardCard
    }

    static let sounds: [Key: [String]] = [
        .playerHit: variants("anim_attack_target_hpbar_", 3),
        .bolt: variants("anim_attack_missile_flash_", 3),
        .abilityImpact: variants("anim_attack_target_flash_", 2),
        .poison: variants("anim_attack_target_poison_", 2),
        .kill: variants("anim_attack_target_claws_", 2),
        .heal: variants("fight_card_heal_", 3, padded: false),
        .healAffect: variants("fight_card_heal_affect_", 3, padded: false),
        .death: ["fight_card_death_1", "fight_card_death_2", "fight_card_death_5"],
        .reflect: variants("fight_shot_reflect", 3, padded: false),
        .invulnerable: ["fight_invulnerability"],
        .revive: ["fight_resurrect"],
        .raiseAttack: ["fight_raiseattack"],
        .curse: ["fight_curse"],
        .curseAffect: ["fight_curse_affect"],
        .nextRound: ["fight_nextround"],
        .victory: ["fight_victory_msx"],
        .defeat: ["fight_defeat_msx"],
        .bonus: ["fight_bonus"],
        .rewardCard: ["fight_reward_card"],
    ]

    static func list(_ key: Key) -> [String] { sounds[key] ?? [] }

    /// Sounds of the battle screen itself (battle.js / battle-result.js).
    static let lightning = "lightning_short"
    static let switchClick = "ui_button_switch"
    static let buttonClick = "ui_button_circular"
    static let startClick = "ui_button_start"
    static let cardClose = "ui_button_card_close"
    static let cardLevelUp = "ui_card_level_up"
    static let cardXpGain = ["ui_card_xpgain1", "ui_card_xpgain2", "ui_card_xpgain4"]

    /// Fight music cue for a mode: cue2 in the arena (PvP), cue1 on quests (battle.js `musicFor`).
    static func music(for mode: FightMode) -> String {
        BattlePresentation.isPvpMode(mode) ? "music_fight_cue2" : "music_fight_cue1"
    }
}

/// Sprites the client blended additively (painted on black): drawn with `SKBlendMode.add` (ADDITIVE_SPRITES).
enum BattleSprites {
    static let additive: Set<String> = [
        "blast", "blast2", "fire1", "fire2", "invulnerable_effec_02", "invulnerable_effec_03", "invulnerable_effec_04",
        "stun_effect08", "spell", "Spell_Circle2", "Spell_Circle4", "Spell_Circle5", "fx_glow", "white_glow", "dust", "sparks",
    ]

    /// `isAdditive(name)`.
    static func isAdditive(_ name: String) -> Bool { additive.contains(name) }

    /// Original tribe emblems (card.js TRIBE_SPRITES).
    static func tribeEmblem(_ tribe: Tribe) -> String {
        switch tribe {
        case .dwarf: return "hud_dwarficon01"
        case .elf: return "hud_elficon01"
        case .orc: return "hud_orcicon01"
        case .neutral: return "hud_neutralicon01"
        }
    }

    /// Frame sprite of a rarity (`cardframe_<rarity>`).
    static func cardFrame(_ rarity: Rarity) -> String { "cardframe_\(rarity.rawValue)" }
}

/// The sound channel of one fight (battle-player.js `sfx` / `play`): the original names go to `AudioPlaying.sfx`,
/// the `_01/_02/_03` variants are cycled by a counter seeded with the battle seed so a replay sounds the same
/// every time (`createPicker`, ported as `Seeds.VariantPicker`).
final class BattleSoundChannel {
    private let picker: Seeds.VariantPicker
    private weak var audio: AudioPlaying?
    /// Set when the fight is skipped or the screen left: nothing plays any more.
    var muted = false

    init(seed: UInt32, audio: AudioPlaying?) {
        self.picker = Seeds.VariantPicker(seed: seed)
        self.audio = audio
    }

    /// Pick one entry of a list with the fight's seeded counter (also used for sprite variants).
    func pick<T>(_ list: [T]) -> T? { picker.pick(list) }

    /// Play one of the variants of a list.
    func play(_ list: [String]) {
        guard !muted, let name = picker.pick(list), !name.isEmpty else { return }
        audio?.sfx(name)
    }

    func play(_ key: BattleSounds.Key) { play(BattleSounds.list(key)) }

    /// Play a single named sound (no variant counter consumed).
    func play(name: String) {
        guard !muted, !name.isEmpty else { return }
        audio?.sfx(name)
    }

    /// Per-step de-duplication of a sound group (battle-player.js `onceFactory`).
    final class Once {
        private var seen = Set<String>()
        private let channel: BattleSoundChannel
        init(_ channel: BattleSoundChannel) { self.channel = channel }
        func play(_ key: String, _ list: [String]) {
            if seen.contains(key) { return }
            seen.insert(key)
            channel.play(list)
        }
    }

    func once() -> Once { Once(self) }
}
