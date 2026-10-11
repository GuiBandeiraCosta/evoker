import Foundation
import AVFoundation
import EvokerCore

/// AVFoundation port of `createAudio()` (src/ui/audio.js): a pool of `AVAudioPlayer` per effect stem (at most 8
/// effects at once, the oldest is choked, the same file is not retriggered within 60 ms), one music player with loop
/// and a 0.5 s crossfade on change, the client's mix levels (`GAIN`), and the save's `sound` / `musicVolume` /
/// `fxVolume`. The audio session is ambient so the player's own music keeps playing (the web cannot; iOS should).
/// Names are file stems of `GameAssets/sfx` or the event aliases of `AudioNames`. All work happens on the main
/// thread (calls from other threads are forwarded).
final class AudioPlayer: NSObject, AudioPlaying, AVAudioPlayerDelegate {
    /// Original mix levels (audioassets.lua, audio.js `GAIN`): everything else plays at 1.
    static let gain: [String: Float] = [
        "music_intro": 0.5,
        "music_introvideo_part1": 0.6,
        "music_introvideo_part1end": 0.6,
        "music_introvideo_part2": 0.6,
        "music_buybooster": 0.5,
        "music_fight_cue1": 0.4,
        "music_fight_cue2": 0.4,
        "atmo_fight": 0.8,
        "atmo_ambient_cue1": 0.4,
        "atmo_ambient_cue2": 0.4,
        "atmo_ambient_cue3": 0.4,
        "atmo_ambient_cue4": 0.4,
        "ui_button_attack": 1,
    ]
    /// Crossfade on a music change (the web uses 700 ms; the iOS app 0.5 s as specified).
    static let crossfade: TimeInterval = 0.5
    static let maxConcurrent = 8
    static let minRepeat: TimeInterval = 0.06

    private struct Volumes {
        var on: Bool
        var music: Float
        var fx: Float
    }

    private final class MusicTrack {
        let stem: String
        let player: AVAudioPlayer
        var factor: Float
        var next: String?
        var ending = false
        var fadeEndsAt: TimeInterval = 0

        init(stem: String, player: AVAudioPlayer, factor: Float, next: String?) {
            self.stem = stem
            self.player = player
            self.factor = factor
            self.next = next
        }
    }

    private struct Playing {
        let player: AVAudioPlayer
        let stem: String
        let at: TimeInterval
    }

    private let assets: AssetCatalog
    private var volumes = Volumes(on: true, music: 0.7, fx: 1)
    private var pools: [String: [AVAudioPlayer]] = [:]
    private var playing: [Playing] = []
    private var lastPlay: [String: TimeInterval] = [:]
    private var missing: Set<String> = []
    private var music: MusicTrack?
    private var fadingOut: [AVAudioPlayer] = []
    private var suspended = false
    private var sessionConfigured = false

    init(assets: AssetCatalog = BundleAssetCatalog.shared) {
        self.assets = assets
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification,
                                               object: AVAudioSession.sharedInstance())
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: AudioPlaying

    func sfx(_ name: String) {
        onMain { self.playEffect(name, factor: 1, rate: 1) }
    }

    func music(_ name: String?) {
        onMain { self.switchMusic(name, loop: true, next: nil, fade: AudioPlayer.crossfade) }
    }

    func apply(_ settings: Settings) {
        onMain {
            self.volumes = Volumes(on: settings.sound,
                                   music: AudioPlayer.clamp(settings.musicVolume),
                                   fx: AudioPlayer.clamp(settings.fxVolume))
            self.applyMusicVolume()
        }
    }

    func suspend() {
        onMain {
            self.suspended = true
            self.music?.player.pause()
            for entry in self.playing { entry.player.stop() }
            self.playing.removeAll()
            for player in self.fadingOut { player.stop() }
            self.fadingOut.removeAll()
        }
    }

    func resume() {
        onMain {
            self.suspended = false
            self.configureSession()
            if let track = self.music, !track.ending {
                track.player.play()
                // a track started while suspended never ran its fade-in: ramp to the target now
                track.player.setVolume(self.musicTarget(track), fadeDuration: 0.25)
                track.fadeEndsAt = self.now + 0.25
            }
        }
    }

    // MARK: Additions (audio.js options)

    /// Play an effect with a per-call volume factor and playback rate (`sfx(name, {volume, rate})`).
    func sfx(_ name: String, volume factor: Float, rate: Float = 1) {
        onMain { self.playEffect(name, factor: factor, rate: rate) }
    }

    /// Switch the music: `loop` false plays the track once and then starts `next` (the shop: `music_buybooster`
    /// then `atmo_menu`); `fade` is the crossfade length. The same track requested again keeps playing.
    func music(_ name: String?, loop: Bool, next: String? = nil, fade: TimeInterval = AudioPlayer.crossfade) {
        onMain { self.switchMusic(name, loop: loop, next: next, fade: fade) }
    }

    /// Stop the music at once and every playing effect (`stopAll`).
    func stopAll() {
        onMain {
            if let track = self.music {
                self.music = nil
                track.player.stop()
            }
            for player in self.fadingOut { player.stop() }
            self.fadingOut.removeAll()
            for entry in self.playing { entry.player.stop() }
            self.playing.removeAll()
        }
    }

    /// Live volumes while the Settings sliders are dragged (`setVolumes`); `apply(_:)` with the saved settings takes
    /// over again on release.
    func setVolumes(music: Double? = nil, fx: Double? = nil, on: Bool? = nil) {
        onMain {
            if let m = music { self.volumes.music = AudioPlayer.clamp(m) }
            if let f = fx { self.volumes.fx = AudioPlayer.clamp(f) }
            if let o = on { self.volumes.on = o }
            self.applyMusicVolume()
        }
    }

    /// Create one pooled player per name so the first play has no delay (`preload`).
    func preload(_ names: [String]) {
        onMain {
            for name in names {
                guard let stem = AudioNames.resolve(name), !self.missing.contains(stem), self.pools[stem] == nil else { continue }
                if let player = self.makePlayer(stem) {
                    self.pools[stem] = [player]
                } else {
                    self.missing.insert(stem)
                }
            }
        }
    }

    /// The stem of the music that is playing (debugging, tests).
    var currentMusic: String? {
        music?.stem
    }

    // MARK: Effects

    private func playEffect(_ name: String, factor: Float, rate: Float) {
        guard let stem = AudioNames.resolve(name), !missing.contains(stem) else { return }
        let level = effectiveVolume(channel: .fx, stem: stem, factor: factor)
        guard level > 0, !suspended else { return }
        let t = now
        if let last = lastPlay[stem], t - last < AudioPlayer.minRepeat { return }
        lastPlay[stem] = t
        configureSession()
        playing.removeAll { !$0.player.isPlaying }
        var player = pools[stem]?.first { !$0.isPlaying }
        if player == nil, playing.count >= AudioPlayer.maxConcurrent, let oldest = playing.first {
            // cap reached: choke the oldest effect (a same-file play then reuses its player)
            oldest.player.stop()
            playing.removeFirst()
            player = pools[stem]?.first { !$0.isPlaying }
        }
        if player == nil {
            guard let made = makePlayer(stem) else {
                missing.insert(stem)
                return
            }
            pools[stem, default: []].append(made)
            player = made
        }
        guard let p = player else { return }
        p.volume = level
        p.rate = rate > 0 ? rate : 1
        p.numberOfLoops = 0
        p.currentTime = 0
        playing.removeAll { $0.player === p }
        playing.append(Playing(player: p, stem: stem, at: t))
        p.play()
    }

    private func makePlayer(_ stem: String) -> AVAudioPlayer? {
        guard let url = assets.soundURL(stem) else { return nil }
        guard let player = try? AVAudioPlayer(contentsOf: url) else { return nil }
        player.enableRate = true
        player.prepareToPlay()
        return player
    }

    // MARK: Music

    private func switchMusic(_ name: String?, loop: Bool, next: String?, fade: TimeInterval) {
        let stem = name.flatMap { AudioNames.resolve($0) }
        if name != nil && stem == nil { return }
        if let stem = stem, let track = music, track.stem == stem, !track.ending {
            track.player.numberOfLoops = loop ? -1 : 0
            track.next = next
            applyMusicVolume()
            return
        }
        if let track = music {
            music = nil
            fadeOut(track, over: fade)
        }
        guard let stem = stem, !missing.contains(stem) else { return }
        guard let player = makePlayer(stem) else {
            missing.insert(stem)
            return
        }
        configureSession()
        player.delegate = self
        player.numberOfLoops = loop ? -1 : 0
        let track = MusicTrack(stem: stem, player: player, factor: 1, next: next)
        music = track
        let target = musicTarget(track)
        if fade > 0 {
            player.volume = 0
            if !suspended { player.play() }
            player.setVolume(target, fadeDuration: fade)
            track.fadeEndsAt = now + fade
        } else {
            player.volume = target
            if !suspended { player.play() }
        }
    }

    private func fadeOut(_ track: MusicTrack, over fade: TimeInterval) {
        track.ending = true
        track.player.delegate = nil
        let player = track.player
        if fade <= 0 || !player.isPlaying {
            player.stop()
            return
        }
        fadingOut.append(player)
        player.setVolume(0, fadeDuration: fade)
        DispatchQueue.main.asyncAfter(deadline: .now() + fade + 0.05) { [weak self] in
            player.stop()
            self?.fadingOut.removeAll { $0 === player }
        }
    }

    private func applyMusicVolume() {
        guard let track = music, !track.ending, now >= track.fadeEndsAt else { return }
        track.player.volume = musicTarget(track)
    }

    private func musicTarget(_ track: MusicTrack) -> Float {
        effectiveVolume(channel: .music, stem: track.stem, factor: track.factor)
    }

    private enum Channel { case music, fx }

    /// Master off → 0; else channel volume x per-file gain x per-call factor, clamped to 0…1 (`effectiveVolume`).
    private func effectiveVolume(channel: Channel, stem: String, factor: Float) -> Float {
        guard volumes.on else { return 0 }
        let base = channel == .music ? volumes.music : volumes.fx
        let gain = AudioPlayer.gain[stem] ?? 1
        let f = factor.isFinite ? factor : 1
        return max(0, min(1, base * gain * f))
    }

    // MARK: AVAudioPlayerDelegate (one-shot music → next track)

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onMain {
            guard let track = self.music, track.player === player, player.numberOfLoops == 0 else { return }
            self.music = nil
            if let next = track.next {
                self.switchMusic(next, loop: true, next: nil, fade: 0.8)
            }
        }
    }

    // MARK: Session

    private func configureSession() {
        if sessionConfigured { return }
        sessionConfigured = true
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("AudioPlayer: audio session: %@", String(describing: error))
        }
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        onMain {
            switch type {
            case .began:
                break
            case .ended:
                let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume), !self.suspended, let track = self.music, !track.ending {
                    track.player.play()
                }
            @unknown default:
                break
            }
        }
    }

    // MARK: Helpers

    private var now: TimeInterval {
        ProcessInfo.processInfo.systemUptime
    }

    private func onMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    private static func clamp(_ v: Double) -> Float {
        guard v.isFinite else { return 0 }
        return Float(max(0, min(1, v)))
    }
}

/// The event aliases of audio.js `NAMES` ("tap", "victory", "hit", "musicFight"…) → original file stems. Lists are
/// interchangeable variants, one is picked at random (UI-only randomness). `resolve` also accepts a file stem (with
/// or without ".mp3"); whether it exists is the catalog's business.
enum AudioNames {
    static let aliases: [String: [String]] = [
        // UI: buttons, navigation (the client's default button sound is ui_button_circular)
        "button": ["ui_button_circular"],
        "tap": ["ui_button_circular"],
        "nav": ["ui_button_circular"],
        "tab": ["ui_button_switch"],
        "toggle": ["ui_button_switch"],
        "map": ["ui_button_map"],
        "card": ["ui_button_card"],
        "cardShow": ["ui_button_card_showup"],
        "cardClose": ["ui_button_card_close"],
        "confirm": ["ui_button_start"],
        "start": ["ui_button_start"],
        "attack": ["ui_button_attack"],
        "deckSelect": ["ui_button_deckselect_click"],
        "deckSwipe": ["ui_button_deckselect_swipe"],
        "tick": ["ui_decksetup_slotselect"],
        // deck editing (drag and drop on the pre-battle and Deck screens)
        "cardTake": ["ui_decksetup_card_take"],
        "cardPlace": ["ui_decksetup_card_place"],
        "cardRemove": ["ui_decksetup_card_remove"],
        "deckFinished": ["ui_decksetup_card_place_deckfinished"],
        "slotSelect": ["ui_decksetup_slotselect"],
        // player, cards, unlocks
        "potion": ["ui_use_potion"],
        "unlock": ["ui_unlock"],
        "slotUnlock": ["ui_slot_unlock_anim"],
        "levelUp": ["quest_reward_levelup"],
        "cardLevelUp": ["ui_card_level_up"],
        "cardXp": ["ui_card_xpgain1", "ui_card_xpgain2", "ui_card_xpgain4"],
        "albumShine": ["ui_album_shine_01", "ui_album_shine_02", "ui_album_shine_03"],
        "trainStart": ["ui_decksetup_card_enhance_pt0"],
        "train": ["card_enhancenew_pt2d"],
        "trainSkip": ["card_enhancenew_skip2"],
        "fuse": ["card_evolvenew_pt2"],
        "assemble": ["card_assemble"],
        "assembled": ["card_assemblenew_pt2b"],
        "fanfare": ["card_assemblenew_pt2b"],
        "gremlin": ["fight_curse"],
        // quest
        "questStart": ["quest_start"],
        "questVictory": ["quest_victory"],
        "enemyShow": ["quest_enemy_showup_01", "quest_enemy_showup_02", "quest_enemy_showup_03", "quest_enemy_showup_04"],
        "enemyDestroy": ["quest_enemy_destroy_02", "quest_enemy_destroy_03", "quest_enemy_destroy_04", "quest_enemy_destroy_07"],
        "enemyDestroyDemon": ["quest_enemy_destroy_demon_01", "quest_enemy_destroy_demon_02", "quest_enemy_destroy_demon_04", "quest_enemy_destroy_demon_05"],
        "enemyDestroyDragon": ["quest_enemy_destroy_dragon_01", "quest_enemy_destroy_dragon_03", "quest_enemy_destroy_dragon_04"],
        "enemyDestroyDwarf": ["quest_enemy_destroy_dwarf_01", "quest_enemy_destroy_dwarf_02", "quest_enemy_destroy_dwarf_03", "quest_enemy_destroy_dwarf_05"],
        "enemyDestroyElf": ["quest_enemy_destroy_elf_01", "quest_enemy_destroy_elf_02", "quest_enemy_destroy_elf_04", "quest_enemy_destroy_elf_05", "quest_enemy_destroy_elf_06"],
        "enemyDestroyGhost": ["quest_enemy_destroy_ghostlight_02", "quest_enemy_destroy_ghostlight_03", "quest_enemy_destroy_ghostlight_04", "quest_enemy_destroy_ghostlight_05"],
        "enemyDestroyOrc": ["quest_enemy_destroy_orc_01", "quest_enemy_destroy_orc_02", "quest_enemy_destroy_orc_03", "quest_enemy_destroy_orc_04"],
        "enemyDestroySkeleton": ["quest_enemy_destroy_skeletor_01", "quest_enemy_destroy_skeletor_02", "quest_enemy_destroy_skeletor_03"],
        "reward": ["quest_reward_collect"],
        "rewardGold": ["quest_reward_gold"],
        "rewardCard": ["quest_reward_card"],
        "rewardCardAutosell": ["quest_reward_card_autosell"],
        "rewardGem": ["quest_reward_gem"],
        "gems": ["quest_reward_gem"],
        "rewardPotion": ["quest_reward_potion"],
        "rewardToken": ["quest_reward_token"],
        "rewardShine": ["quest_reward_shine"],
        "levelUpGold": ["levelup_reward_gold"],
        // shop, boosters, selling
        "open": ["shop_open"],
        "shopOpen": ["shop_open"],
        "buy": ["shop_buy_gems"],
        "buyGold": ["shop_buy_gold"],
        "buyGems": ["shop_buy_gems"],
        "buyPotions": ["shop_buy_potions"],
        "buyTokens": ["shop_buy_tokens"],
        "buyCard": ["shop_buy_card"],
        "buyBig": ["shop_buy_big"],
        "buyStart": ["shop_buy_start"],
        "sell": ["shop_buy_gold"],
        "boosterOpen": ["booster_open"],
        "flip": ["shop_draw_card"],
        "take": ["shop_card_collect"],
        "shuffle": ["shop_shuffle_cards1", "shop_shuffle_cards2", "shop_shuffle_cards3"],
        "reroll": ["shop_shuffle_cards1"],
        // battle (the battle scene also plays the attack families directly by file name)
        "victory": ["fight_victory_msx"],
        "defeat": ["fight_defeat_msx"],
        "nextRound": ["fight_nextround"],
        "death": ["fight_card_death_1", "fight_card_death_2", "fight_card_death_5"],
        "heal": ["fight_card_heal_1", "fight_card_heal_2", "fight_card_heal_3"],
        "healAffect": ["fight_card_heal_affect_1", "fight_card_heal_affect_2", "fight_card_heal_affect_3"],
        "curse": ["fight_curse"],
        "curseAffect": ["fight_curse_affect"],
        "invulnerable": ["fight_invulnerability"],
        "raiseAttack": ["fight_raiseattack"],
        "resurrect": ["fight_resurrect"],
        "reflect": ["fight_shot_reflect1", "fight_shot_reflect2", "fight_shot_reflect3"],
        "bonus": ["fight_bonus"],
        "fightRewardCard": ["fight_reward_card"],
        "lightningLong": ["lightning_long"],
        "lightningShort": ["lightning_short"],
        "transition": ["metallic_transition"],
        "attackerArcane": ["anim_attack_attacker_arcane_01", "anim_attack_attacker_arcane_02", "anim_attack_attacker_arcane_03"],
        "attackerBlood": ["anim_attack_attacker_blood_01", "anim_attack_attacker_blood_02", "anim_attack_attacker_blood_03"],
        "attackerClaws": ["anim_attack_attacker_claws_01", "anim_attack_attacker_claws_02"],
        "attackerCurse": ["anim_attack_attacker_curse_01", "anim_attack_attacker_curse_02", "anim_attack_attacker_curse_03"],
        "attackerHoly": ["anim_attack_attacker_holy_01"],
        "attackerPoison": ["anim_attack_attacker_poison_01", "anim_attack_attacker_poison_02"],
        "attackerStrongHit": ["anim_attack_attacker_stronghit_01"],
        "attackerSword": ["anim_attack_attacker_sword_01", "anim_attack_attacker_sword_02"],
        "attackerWhirlwind": ["anim_attack_attacker_whirlwind_01"],
        "missile": ["anim_attack_missile_01", "anim_attack_missile_02", "anim_attack_missile_03"],
        "missileFire": ["anim_attack_missile_fire_01", "anim_attack_missile_fire_02", "anim_attack_missile_fire_03"],
        "missileFlash": ["anim_attack_missile_flash_01", "anim_attack_missile_flash_02", "anim_attack_missile_flash_03"],
        "missileIce": ["anim_attack_missile_ice_01", "anim_attack_missile_ice_02", "anim_attack_missile_ice_03"],
        "missileShadow": ["anim_attack_missile_shadow_01", "anim_attack_missile_shadow_02", "anim_attack_missile_shadow_03"],
        "missileShot": ["anim_attack_missile_shot_01", "anim_attack_missile_shot_02", "anim_attack_missile_shot_03"],
        "hit": ["anim_attack_target_01", "anim_attack_target_02", "anim_attack_target_03"],
        "hitArcane": ["anim_attack_target_arcane_01", "anim_attack_target_arcane_02"],
        "hitBlood": ["anim_attack_target_blood_01", "anim_attack_target_blood_02", "anim_attack_target_blood_03"],
        "hitClaws": ["anim_attack_target_claws_01", "anim_attack_target_claws_02"],
        "hitCurse": ["anim_attack_target_curse_01", "anim_attack_target_curse_02", "anim_attack_target_curse_03"],
        "hitFire": ["anim_attack_target_fire_01", "anim_attack_target_fire_02"],
        "hitFlash": ["anim_attack_target_flash_01", "anim_attack_target_flash_02"],
        "hitHoly": ["anim_attack_target_holy_01"],
        "hitHpBar": ["anim_attack_target_hpbar_01", "anim_attack_target_hpbar_02", "anim_attack_target_hpbar_03"],
        "hitIce": ["anim_attack_target_ice_01", "anim_attack_target_ice_02"],
        "hitPoison": ["anim_attack_target_poison_01", "anim_attack_target_poison_02"],
        "hitShadow": ["anim_attack_target_shadow_01"],
        "hitShot": ["anim_attack_target_shot_01", "anim_attack_target_shot_02"],
        "hitStrongHit": ["anim_attack_target_stronghit_01", "anim_attack_target_stronghit_02", "anim_attack_target_stronghit_03"],
        "hitWhirlwind": ["anim_attack_target_whirlwind_01"],
        // music and ambience
        "musicTitle": ["music_intro"],
        "musicIntro1": ["music_introvideo_part1"],
        "musicIntro1End": ["music_introvideo_part1end"],
        "musicIntro2": ["music_introvideo_part2"],
        "musicBoss": ["music_bossannounce"],
        "musicShop": ["music_buybooster"],
        "musicFight": ["music_fight_cue1", "music_fight_cue2"],
        "atmoMenu": ["atmo_menu"],
        "atmoMap": ["atmo_map_far"],
        "atmoFight": ["atmo_fight"],
        "atmoQuest": ["atmo_ambient_cue1", "atmo_ambient_cue2", "atmo_ambient_cue3", "atmo_ambient_cue4"],
        "silence": ["silence"],
    ]

    /// Every file stem reachable through an alias (the content of GameAssets/sfx).
    static let files: Set<String> = Set(aliases.values.joined())

    /// An alias → one of its variants (random); a file stem (with or without ".mp3") → the stem; "" → nil.
    static func resolve(_ name: String) -> String? {
        if name.isEmpty { return nil }
        if let variants = aliases[name], !variants.isEmpty {
            return variants[Int.random(in: 0..<variants.count)]
        }
        if name.lowercased().hasSuffix(".mp3") { return String(name.dropLast(4)) }
        return name
    }

    /// The ambience cue of a quest screen (audio.js `screenMusic('quest')`: a stable pick of atmo_ambient_cue1-4
    /// from the line id and the quest number).
    static func questAmbience(line: String, quest: Int) -> String {
        var hash: UInt32 = 0
        for unit in line.utf16 {
            hash = hash &* 31 &+ UInt32(unit)
        }
        let cues = aliases["atmoQuest"] ?? ["atmo_ambient_cue1"]
        let n = UInt32(max(1, quest))
        return cues[Int((hash &+ (n - 1)) % UInt32(cues.count))]
    }
}
