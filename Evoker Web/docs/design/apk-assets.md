# Original assets recovered from the 1.7.4 client

Everything below was extracted from the signed, verified `exploration/apk/evoker-1.7.4.apk` (flaregames, 2016).
Use these instead of the CSS approximations and cropped screenshots wherever they exist.

## Folders

| Path | Content |
|---|---|
| `assets/orig/ui/` | 645 UI sprites cut from the game's sprite sheets, named as the client named them (list below). All PNG with alpha. |
| `assets/orig/sfx/` | 201 MP3 sound effects and music loops (names below). |
| `assets/orig/fonts/` | `proximanova-light.ttf`, `proximanova-sbold.ttf` (all UI text), `07713_CGTimesBold.ttf` (ornamental headers), `Roboto-Bold.ttf`. |
| `assets/orig/animations/` | 37 keyframe animations (tween lists; `startTime`, `duration`, `tweens[{id, timestamp, params{time, alpha, xScale, yScale, x, y, rotation}}]`) for rewards, boosters, level-up, fusion. |
| `assets/orig/prepackaged/` | 719 images with hashed names (`_index.json` maps hash → file): 372 map tiles (256×256), 17 minion cut-outs (245×383 PNG, transparent), 15 boss portraits (274×404 PNG), 12 framed card thumbnails (217×307), misc. See `exploration/tools/classify-prepackaged.py` output `exploration/apk/data/prepackaged-map.json` once it exists. |
| `exploration/apk/data/sheets.json` | frame rectangles per sprite sheet (source of the cuts). |
| `exploration/apk/data/imagedata.json` | the client's logical asset paths (e.g. `assets/gfx/hud/menubar/icon_home_active.png`) → sheet/frame, which tells which sprite belongs to which screen. |
| `exploration/apk/data/colors.json` | the client's named colours (see palette). |
| `exploration/apk/data/loca_en.json` | 190 English UI strings (tutorial lines, popups, intro lore). |
| `exploration/apk/lua/*.txt` | disassembled client modules (layouts in `ui.layouts.iphone.*` give exact positions/sizes of every element at 320×480 iPhone logical units: multiply by 2.25 for the 720-wide stage). |

## Palette (from `ev_styles`)

xp `#ffd556`, stamina `#ff832f`, mana `#24d8ff`, health `#39b432`, playerGold `#d2a154`, rating `#c1d353`,
bronze `#d47a42`, silver `#e3e3e3`, gold `#ffcf35`; rarity text colours: common `#c8c7c7`, standard `#f3f3f3`,
uncommon `#91dc52`, rare `#7ab0f2`, heroic `#c059bf`, legendary `#fdfab1`, ultimate `#ff0000`; headlines
`#e6e6e6`, beige `#f4d59f`, tutorialGold `#fffd72`, enhanceYellow `#ffc553`, evolveBlue `#73beed`, sellGreen
`#71d703`, bossNameColor `#faaa32`, brightOrange `#ff8014`, darkblue `#1f2f3c`, green `#378f0b`, yellow `#fed00f`.

Fonts: `STANDARD` = Proxima Nova Light, `BOLD` = Proxima Nova Semibold, `THIN` = CG Times Bold (used for the
large ornamental titles), `GOOGLEBOLD` = Roboto Bold.

## Sprites by purpose (file names in `assets/orig/ui/`)

- **Top bar / HUD**: `topbar_bg.png`, `resourcebar_frame.png`, `resourcebar_fill_active.png`, `resourcebar_fill_inactive.png`, `resourcebar_glow.png`, `resourcebar_locked.png`, `resourcebg_big.png`, `resourcebg_overlay.png`, `moneybar_frame.png`, `moneybar_fill*.png`, `moneybar_glow.png`, `hud_stamicon01.png` (stamina), `hud_manaicon01.png`, `hud_healthicon01/02.png`, `hud_experienceicon01.png` (star), `hud_coinsicon01.png`, `hud_gemicon01.png`, `hud_gemiconsingle.png`, `hud_backbutton01.png`, `hud_backbutton01_locked.png`, `backbutton_frame.png`, `backbutton_fill*.png`, `back_icon_active/inactive.png`, `help_icon_active/inactive.png`, `info_icon.png`, `infobutton_frame/fill*.png`, `plus_icon_*.png`, `plus_icon_shop_*.png`, `minus_icon_*.png`, `extendmenu_arrow_*.png`, `hud_progressbar_3slice*.png`, `hud_progressbarblue01-03.png`, `hud_progressbargreen02.png`, `hud_progressbarred01/02.png`, `hud_progressbarviolet02/03.png`, `hud_progressbaryellow01.png`, `hud_progressbar_pinocle01.png`.
- **Bottom nav**: `hud_bottombg01.png`, `menubar_button_frame.png`, `menubar_button_fill_active.png`, `menubar_button_fill_inactive.png`, `menubar_button_locked.png`, `menubar_button_shop.png`, `hud_bottombutton01/02/03_*.png`, icons `icon_liga_{active,glow,grey}.png` (league), `icon_pvp_*` (arena), `icon_map_*` (quest map), `icon_deckedit_*` (cards), `icon_shop_*`, `icon_profile_*`, `icon_home_*`, `icon_album_*`, `icon_options_*`, `badge.png`, `lock_small.png`, `lock_big.png`, `lock_01..14.png` (unlock animation).
- **Buttons / panels**: `button_default_frame.png` + `button_default_fill.png` / `_fill_inactive` / `_green_fill` / `_danger_fill`, `button_special_frame/fill/icon.png`, `hud_bigbutton03/04_*.png`, `hud_quadbutton_02_*.png`, `hud_smallbutton_frame/fill.png`, `attackbutton01.png`, `attackbuttonornament01.png` (the flaming Attack! bar), `hud_nineframe01-08.png` (+`_alpha`) and `ironframe_01-09.png`, `small_white_1-8.png`, `small_yellow_1-8.png`, `glowgold/glowblue/glowred_nineframe01-08.png` (9-slice popup frames: 01 top-left … 09 bottom-right), `popup_bg.jpg`, `popup_fill.png`, `popup_header_grey.jpg`, `header_framer_big/small.png`, `panel_3_bg.jpg`, `panel_4_bg.jpg`, `panel_5_*.png`, `seperator_big/small/thin.png`, `ornament01/02.png`, `ornament_left/right/top.png`, `tab_background.jpg`, `slider_bg.png`, `slider_button.png`, `close_icon.png`, `refresh.png`, `button_refresh_frame.png`, `hud_tapindicator01.png`, `hud_tapfeedback01.png`, `tutorial_arrowhead01.png`, `tutorial_arrowline01.png`.
- **Cards**: `cardframe.png` (compact frame), `cardslot.png`, `cardslot01.png`, `cardslot_simple.png`, `cardslotlocked.png`, `cardslotskull.png`, `cardslot_question01_thumb.png`, `cardslot{dwarf,elf,ork,neutral}_thumb.png`, `card_arrow01.png` (buff arrow), `card_arrowred01.png` (attack), `card_arrowblue01.png`, `cardstatsoverlay.png`, `cardstatsoverlay_small.png`, `cardindeck.png`, `carddetail_top_{common,standard,uncommon,rare,heroic,legendary,ultimate}.png` and `carddetail_bottom_*.png` (the detail screen plates per rarity), `hud_dwarficon01.png`, `hud_elficon01.png`, `hud_orcicon01.png`, `hud_neutralicon01.png` (tribe emblems), `hud_specialskill01/02.png` (ability icon), `card_piece_overlay_thumb.png`, `cardpiece_icon.png`, pieces `piece2_*`, `piece4_*`, `piece6_*`, `piece10_*` (`_b` = empty, `_gold` = complete, `_merge`), `boxpiece_1-5.png`, `glowingcard*.png`, `newcardglow.png`, `newcardsheen01.png`, `flipcard.png`, `burnedcard.png`, `smallcards1/2.png`, `card1-4.png`, `card_01-03.png` (intro).
- **Battle**: `arena.jpg` (the PvP arena backdrop), `fight_cardbackground01.jpg`, `hud_player01.png` / `hud_player02.png` (portrait frames), `hud_victory.png`, `hud_defeat.png`, `hud_drawd.png`, `beam.png`, `attack_explosion.png/.jpg`, `hud_explosion01-03.png`, `impact_wave.png`, `shockwave01.png`, `blast.jpg`, `blast2.jpg`, `fire1/2.jpg`, `flash1.png`, `lightining.png`, `lens_flare.png`, `energy_sphere.png`, `invulnerable_effec_02-04.jpg`, `stun_effect08.jpg`, `spell.png`, `Spell_Circle2/4/5.jpg`, `fx_glow*.png`, `fx_anim01-04.png` (fusion), `fx_alldieskull01.png`, `fx_boss_light.png`, `white_glow.jpg`, `dust.jpg`, `sparks.jpg`, `big_glow.png`, `golden_oval.png`, `attacked_icon.png`, `defended_icon.png`, `pvpguard.png`.
- **Quest map / quest**: `map_cloud01-03.png`, `fx_glow_map.png`, `village_normal_bg.jpg`, `village_burned_bg.jpg`, `village_normal_birds.png`, `village_normal_eb1/2.png`, `parks.png`, `planks1/2.png`, `shaman_01-03.png`, `shaman_portrait.jpg` (the tutorial guide), `quest_money.png`, `reward_*` (`reward_gold.png`, `reward_gems.png`, `reward_manapotion.png`, `reward_staminapotions.png`, `reward_token_1-3.png`, `reward_cardslots.png`, `reward_frame*.png`, `reward_glow*`), `goldrain.jpg`, `gem_glint.png`, `potion1/2.jpg`, `potion_mana1/2.png`, `potion_stamina1/2.png`, `token_small/medium/big.png`, `levelup_arrow_icon.png`, `hud_levelup*.png`, `unlock_cardslot.png`, `unlock_fuse.png`, `unlock_pvp.png`, `unlock_train.png`.
- **Arena / league / shop / album**: `pvp_bg_green/orange/red.png` (opponent rows by difficulty), `pvp_playerinfo_bg.jpg`, `pvp_points.png`, `ligaboard_top_bg.png`, `ligaboard_player_bg.png`, `ligaboard_player_bg_gold.png`, `liga_timer_bg.png`, `league_not_available.jpg`, `cardshop_background_01.jpg`, `cardshop_promobanner.png`, `shop_coins01/03/04.png`, `shop_gems01/02/05.png`, `shop_special01.png`, `shop_cardpull01/02.png`, `box_front/back.png`, `broken1-5.jpg`, `discount_bg/line.png`, `eventbanner_cardboost02.png`, `prom_1-8.png`, `promo_button_*`, `album_set_frame.png`, `albumglow_00-02.jpg`, `albumreward_bg.png`, `addcard_icon.png`, `deck_full.png`, `deckedit_on/off.png`, `enhance_on/off.png`, `fusion_on/off.png`, `hud_enhance*.png`, `hud_evolve*.png`, `hud_evolution*.png`, `fuse_background.jpg`, `minideck.jpg`, `increasemana.png`, `getcardpiece_icon*.png`, `checker_icon_*`, `player_icon_*`, `default_player.jpg`, `rating_guy.jpg`, `exit_popup_picture.jpg`, `intro_load.jpg`, `evoker.png` (logo), `loading.png`, `no_connection.png`.

Nine-slice frames: `hud_nineframe01..08` go top-left, top, top-right, left, centre, right, bottom-left, bottom,
bottom-right (01..09 for the `ironframe` set). Use `border-image` or nine CSS backgrounds.

## Sounds (`assets/orig/sfx/`)

Music/ambience: `music_intro`, `music_fight_cue1/2`, `music_bossannounce`, `music_buybooster`, `atmo_menu`,
`atmo_map_far`, `atmo_fight`, `atmo_ambient_cue1-4`, `music_introvideo_part1/part1end/part2`.
UI: `ui_button_attack`, `ui_button_card`, `ui_button_card_close`, `ui_button_card_showup`, `ui_button_circular`,
`ui_button_map`, `ui_button_start`, `ui_button_switch`, `ui_button_deckselect_click/swipe`, `ui_decksetup_card_place`,
`ui_decksetup_card_place_deckfinished`, `ui_decksetup_card_remove`, `ui_decksetup_card_take`, `ui_decksetup_slotselect`,
`ui_card_level_up`, `ui_card_xpgain1/2/4`, `ui_slot_unlock_anim`, `ui_unlock`, `ui_use_potion`, `ui_album_shine_01-03`.
Battle: `anim_attack_attacker_{arcane,blood,claws,curse,holy,poison,stronghit,sword,whirlwind}_NN` (attacker
wind-up), `anim_attack_missile_{fire,flash,ice,shadow,shot}_NN` and `anim_attack_missile_NN` (projectile),
`anim_attack_target_{arcane,blood,claws,curse,fire,flash,holy,hpbar,ice,poison,shadow,shot,stronghit,whirlwind}_NN`
(impact), `fight_card_death_1/2/5`, `fight_card_heal_1-3`, `fight_card_heal_affect_1-3`, `fight_curse`,
`fight_curse_affect`, `fight_invulnerability`, `fight_nextround`, `fight_raiseattack`, `fight_resurrect`,
`fight_shot_reflect1-3`, `fight_bonus`, `fight_victory_msx`, `fight_defeat_msx`, `fight_reward_card`,
`lightning_long/short`, `metallic_transition`.
Quest/rewards/shop: `quest_start`, `quest_enemy_showup_01-04`, `quest_enemy_destroy_NN` and per tribe
`_elf/_orc/_dwarf/_demon/_dragon/_ghostlight/_skeletor`, `quest_victory`, `quest_reward_{card,card_autosell,collect,gem,gold,levelup,potion,shine,token}`,
`levelup_reward_gold`, `shop_open`, `shop_buy_{big,card,gems,gold,potions,start,tokens}`, `shop_card_collect`,
`shop_draw_card`, `shop_shuffle_cards1-3`, `booster_open`, `card_assemble`, `card_assemblenew_pt2b`,
`card_enhancenew_pt2d`, `card_enhancenew_skip2`, `card_evolvenew_pt2`, `silence`.

## Strings (`exploration/apk/data/loca_en.json`)

Keys are the English source text; values the final English text. Notable: the intro lore ("Once, demons and
dragons ruled this world." / "But the eldest Gods intervened and forced them to swear an oath for 1,000 years…" /
"But dark omens have foretold that the time when the oath will be broken…"), unlock popups ("Arena Unlocked!",
"Card Training Unlocked!", "Card Fusing Unlocked!", "Card Slot Unlocked!", "Leagues Unlocked!"), potion dialog
("Your Stamina is too low. Would you like to use one of your Stamina potions?"), "Mana needed: #manaCosts# / #maxMana#",
"Level #level# / #maxLevel#", "Combine two identical cards to power up.", "Do you really want to sell the following
card: #name#", "Searching for opponents...", "Join League", "PRIZES", "Fights Won", "Best card", "Change name".
