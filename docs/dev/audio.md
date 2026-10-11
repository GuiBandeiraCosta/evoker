# Audio, fonts and original texts

The original client's sounds, typefaces and strings (recovered from the 1.7.4 APK, see
`docs/design/apk-assets.md`) are wired into the web recreation by three small pieces:
`src/ui/audio.js` (the player and the event map), `css/fonts.css` (the `@font-face` rules) and
the title / character screens (intro lore, name prompt, volume sliders).

## 1. Fonts

`css/fonts.css` is linked first in `index.html` (the Google Fonts link is gone; the game is offline):

| Family | Weight | File | Client style |
|---|---|---|---|
| `Proxima Nova` | 300 | `assets/orig/fonts/proximanova-light.ttf` | `STANDARD` (all UI text) |
| `Proxima Nova` | 600 | `assets/orig/fonts/proximanova-sbold.ttf` | `BOLD` |
| `CG Times` | 700 | `assets/orig/fonts/07713_CGTimesBold.ttf` | `THIN` (ornamental titles) |
| `Roboto` | 700 | `assets/orig/fonts/Roboto-Bold.ttf` | `GOOGLEBOLD` |

`css/tokens.css` maps them to `--font-ui` / `--font-title`. Only two Proxima cuts exist, so requests for
weights 400 and 500 fall back to Light and 700+ to Semibold. The two Proxima files are `<link rel="preload">`ed.

## 2. The audio module (`src/ui/audio.js`)

```js
import { createAudio, NAMES } from './ui/audio.js';
const audio = createAudio({ base: '/assets/orig/sfx/', getSettings: () => state.settings });
audio.unlock();                       // first pointerdown / keydown starts the music the autoplay policy blocked
audio.preload(['ui_button_circular']);
audio.sfx('ui_button_attack');        // original file name
audio.sfx('victory', { volume: 0.8, rate: 1.1 });   // or an event alias from NAMES
audio.music('atmo_menu');             // loops, crossfades from the previous track
audio.music('music_bossannounce', { loop: false });
audio.music('music_buybooster', { loop: false, next: 'atmo_menu' });
audio.music(null);                    // fade out
audio.setVolumes(0.5, 1, true);       // live (sliders); audio.refresh() returns to the settings
audio.stopAll();
audio.state();                        // { unlocked, music, pending, playing, pooled, missing, volumes }
```

- **Sound effects** use one `HTMLAudioElement` pool per file: an element is created per concurrent play,
  reused after `ended`, and never more than `maxConcurrent` (8) effects play at once (the oldest is
  choked, like the client's `allowChoke`). The same file is not retriggered within 60 ms, so a screen's
  explicit `ctx.sfx('tap')` next to the delegated button sound does not double.
- **Music** is one element with a 700 ms crossfade (`fade` option). `loop` defaults to true; a one-shot
  can name a `next` track (and a `gap` in ms). The same track requested again is a no-op.
- **Volumes**: `settings.sound` (master), `settings.musicVolume`, `settings.fxVolume` (0..1, defaults
  on / 0.7 / 1) are read through `getSettings()` on every play; `GAIN` carries the client's mix levels
  (`music_intro` 0.5, intro parts 0.6, ambient cues and fight music 0.4, `music_buybooster` 0.5).
  With the master off the music keeps running at volume 0, so switching it on is instant.
- **Missing files** fire the element's `error` event, are remembered and never requested again; only
  names that resolve to one of the 201 known files are requested at all (no 404s in the smoke test).
- **Autoplay**: a `play()` rejected before the first gesture is remembered as `pending`; `unlock()`
  replays it inside the first `pointerdown` / `keydown` / `touchstart` handler.

### Event map (`NAMES`)

`ctx.sfx(name)` accepts an original file name (`ui_button_attack`) or an alias. Arrays are variants (one is
picked at random). `tests/audio.test.js` checks that every alias points to an existing file and that every
file in `assets/orig/sfx` is reachable. The main aliases:

| Event | Sound |
|---|---|
| `button`, `tap`, `nav` | `ui_button_circular` (the client's default button sound) |
| `tab`, `toggle` | `ui_button_switch` |
| `map` | `ui_button_map` |
| `card`, `cardShow`, `cardClose` | `ui_button_card`, `ui_button_card_showup`, `ui_button_card_close` |
| `confirm`, `start` / `attack` | `ui_button_start` / `ui_button_attack` |
| `cardTake`, `cardPlace`, `cardRemove`, `deckFinished`, `slotSelect`, `tick` | `ui_decksetup_*` |
| `potion` / `unlock` / `slotUnlock` | `ui_use_potion` / `ui_unlock` / `ui_slot_unlock_anim` |
| `levelUp` (player) / `cardLevelUp` / `cardXp` | `quest_reward_levelup` / `ui_card_level_up` / `ui_card_xpgain1,2,4` |
| `train`, `trainStart`, `trainSkip`, `fuse` | `card_enhancenew_pt2d`, `ui_decksetup_card_enhance_pt0`, `card_enhancenew_skip2`, `card_evolvenew_pt2` |
| `assemble`, `assembled` / `fanfare` | `card_assemble`, `card_assemblenew_pt2b` |
| `questStart`, `questVictory`, `enemyShow`, `enemyDestroy*` | `quest_start`, `quest_victory`, `quest_enemy_showup_01-04`, `quest_enemy_destroy_*` (per tribe) |
| `reward`, `rewardGold`, `rewardCard`, `rewardGem` / `gems`, `rewardPotion`, `rewardToken`, `rewardShine` | `quest_reward_*` |
| `open` / `shopOpen`, `buy`, `buyGold`, `buyPotions`, `buyTokens`, `buyCard`, `buyBig`, `sell` | `shop_open`, `shop_buy_*` (`sell` = `shop_buy_gold`) |
| `boosterOpen`, `flip`, `take`, `shuffle`, `reroll` | `booster_open`, `shop_draw_card`, `shop_card_collect`, `shop_shuffle_cards1-3` |
| `victory`, `defeat`, `nextRound`, `death`, `heal`, `healAffect`, `curse`, `curseAffect`, `invulnerable`, `raiseAttack`, `resurrect`, `reflect`, `bonus`, `fightRewardCard`, `transition` | `fight_*`, `metallic_transition` |
| `attacker{Arcane,Blood,Claws,Curse,Holy,Poison,StrongHit,Sword,Whirlwind}` | `anim_attack_attacker_*` (wind-up) |
| `missile`, `missile{Fire,Flash,Ice,Shadow,Shot}` | `anim_attack_missile_*` (projectile) |
| `hit`, `hit{Arcane,Blood,Claws,Curse,Fire,Flash,Holy,HpBar,Ice,Poison,Shadow,Shot,StrongHit,Whirlwind}` | `anim_attack_target_*` (impact) |
| `musicTitle`, `musicIntro1`, `musicIntro1End`, `musicIntro2`, `musicBoss`, `musicShop`, `musicFight` | `music_*` |
| `atmoMenu`, `atmoMap`, `atmoFight`, `atmoQuest` | `atmo_menu`, `atmo_map_far`, `atmo_fight`, `atmo_ambient_cue1-4` |

### Wiring in `src/app.js`

- `ctx.sfx(name, opts)`, `ctx.music(name, opts)` and `ctx.audio` on every screen context.
- One delegated `click` listener on the stage (capture phase) plays the standard taps so screens need no
  code: `.nav-btn` -> `ui_button_circular`, `.qm-node` -> `ui_button_map`, `.card.interactive` ->
  `ui_button_card`, `.tab` / `.toggle` / `.speed-btn` -> `ui_button_switch`, `.dialog-close` ->
  `ui_button_card_close`, any other `.btn` / HUD button -> `ui_button_circular`. `.attack-btn` is left to
  the pre-battle screen (`ctx.sfx('attack')`); an element with `data-sfx="name"` plays that sound instead
  and `data-sfx="none"` is silent (`soundForClick`).
- Screen music (`screenMusic`, applied on every `router.onChange`; `goTop` waits for its final screen):

  | Screen | Music |
  |---|---|
  | `title` | `music_intro` (loop); the new-game intro plays `music_introvideo_part1`, the `part1end` sting and `part2` |
  | `quest-map` | `atmo_map_far` |
  | `quest` | one of `atmo_ambient_cue1-4`, chosen per quest (stable for a line + number) |
  | `boss-intro` | `music_bossannounce` once; the battle screen then sets `music_fight_cue1/2` |
  | `arena`, `league`, `cards`, `card-detail`, `collections`, `character` | `atmo_menu` |
  | `shop` | `music_buybooster` once, then `atmo_menu` |
  | `battle`, `prebattle`, `booster-open`, `help` | unchanged (the screen decides) |

- Popups: `ctx.ui.dialog.alert` with a title ending in "Unlocked!" plays `ui_unlock`; the player level-up dialog
  (`ctx.ui.showLevelUp`) plays `quest_reward_levelup` itself, a card's level-up in the post-battle overlay
  `ui_card_level_up`.
- Potions: a store subscription compares saves (`diffSounds`): a potion count that drops, or gems spent
  while a bar refills, plays `ui_use_potion` whichever screen did it. The same subscription calls
  `audio.refresh()` so settings changes reach the playing music.

## 3. Settings

`state.settings` gained `musicVolume` and `fxVolume` (0..1; `defaultState` 0.7 / 1, `sound` now defaults
to true). `migrate` fills them for older saves and turns `sound` on for saves written before the audio
existed (their `sound: false` was the old "no audio ships" default, not a choice). The Character screen's
Settings tab shows the master toggle and two 0-100 sliders ("Music volume", "FX Volume", the client's
labels); dragging applies live through `ctx.audio.setVolumes`, releasing persists through the store.
The helpers (`normalizeVolumes`, `sliderToVolume`, `volumeToSlider`, `clampVolume`) live in
`src/ui/screens/settings-view.js`; `normalizeSettings` keeps its four-field shape. A partial save migrates to
`sound: true, musicVolume: 0.7, fxVolume: 1` (the "save round-trip" test of `tests/game-state.test.js` §10).

## 4. Original texts

- Title intro (new game only): the three lore lines from `exploration/apk/data/loca_en.json` ("Once, demons and
  dragons ruled this world." / "But the eldest Gods intervened and forced them to swear an oath for 1,000
  years…" / "But dark omens have foretold that the time when the oath will be broken…"; the dump cuts the
  long values at 70 characters, the endings follow `docs/design/apk-assets.md`), typed over the key art
  with "Tap to continue", three step dots, the Evoker figure (`assets/orig/ui/evoker.png`) on the last
  step and the client's "Skip intro" button. A tap finishes the line, the next tap advances, Enter / Space
  do the same, Escape skips, and a finished line advances by itself after 5.5 s.
- Name dialog: the client's prompt "Before you enter the arena, Evoker, please tell me how the heralds
  shall name you:".
- Settings: "Music volume" and "FX Volume".

## 5. Testing

`node --test tests/audio.test.js` covers the pure parts with a fake `Audio` class and fake timers: the
NAMES map against the files on disk, name resolution, the volume math, pool limits and reuse, the repeat
guard, missing files, crossfades, one-shots with follow-ups, the autoplay unlock, the screen table, the
click delegation, the save diff, the Settings helpers, the migration and the intro strings against the
loca file.

Headless Edge has no audio output, but the module still runs: after `document.body.dataset.ready`,
`evoker.audio.state()` reports `music: 'music_intro'` (or `pending: 'music_intro'` before the first
input event), and the browser console must show no errors or 404s. The smoke / QA scripts count a 404
as a failure, which is why unknown names are never requested.

## 6. Open points

None. (The CG Times font that Chromium's OTS sanitizer rejected is served as the repaired
`assets/orig/fonts/07713_CGTimesBold.fixed.ttf`; the intro / name-prompt flow, the test list and the slider styles
noted here before are done.)
