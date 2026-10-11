# Round 3 — binding decisions for the implementation

Evidence: the reports next to this file (tutorial, playthroughs, playthroughs-2, screens, lategame, cardstats,
social, clients) and their frames in `frames/<topic>/`. **Target era: the final client 1.7.4 (2016–2018).** When
videos of different eras disagree, the 1.7.x evidence wins (ZJWEYHQsVWU is a Dec-2017 1.7.4 recording; Benito
wqzda6-2fs4, Enrique kMjtrZjKl8g/B5XcZAjS_ow are 1.7.0).

**Order of authority:** (1) the 1.7.4 client code in `exploration/apk/lua/` (disassembled Lua; read with the
dumps there or `exploration/apk/tools/lua51dump.py`) and its strings in `exploration/apk/data/loca_en.json`; (2) 1.7.x
videos; (3) older videos; (4) the wiki; (5) our earlier assumptions. Client UI behaviour (tutorial steps, level-up
dialog, booster grid, league list, unlock popups) is in the Lua — port it like the engine was ported, and use
the English strings from loca_en.json verbatim (the video transcriptions are in other languages or approximate).
Numbers the server sent (costs, rewards, stats) come from the videos.

Already done (main session): stat growth curve `start + (cap − start)·t^1.1` (stats.js, GROWTH_EXPONENT);
Siren → Uncommon caps 11/15/19/23/27; Tamer cap values derived from its L7 wiki row.

## D1. First session and tutorial (phase 2)
- Port the 1.7.4 tutorial (`game.tutorial.*`, `ui.components.comp_tutorial_popup`, `comp_tutorialmini_popup`,
  `comp_click_tutorial`) as far as the client contains it; fill the server-side parts from tutorial.md (Benito
  1.7.0 flow): scripted opening fight vs **Worm Shaman** (unwinnable), burning-tower moment, then quest 1.
- No name prompt at start: the name is asked on first Arena entry (`comp_name_popup`).
- Starter state: Envoy + Master Brewer (verify card ids/stage in tutorial.md), 200 gold, 0 gems.
- Quest 1: Worm Shaman with 2 Throat-Cutters; first boss fight is a forced loss with Envoy alone; then the hand
  cursor teaches dragging Master Brewer into the deck; reward is the Throat-Cutter soul card.
- Guide = the ranger (quest screen); the Worm Shaman speaks in fights. Remove "Morden" and our invented lines from
  the tutorial; use the original lines (loca_en.json, tutorial.md §guide lines).
- Unlocks with `view_unlocked_feature_popup`: 3rd card slot after quest-2 boss; fusion at player level 2 (guided
  first fusion, 400 gold); Arena at level 4; training ~level 5; **League at level 6**.
- Level-up dialog (`comp_levelup`, `comp_levelup_attribute`): "Level up! / Reached level N", rewards column,
  "Points: x/12" with +/- for HP (+30/pt), stamina (+1/pt), mana (+1/pt), Proceed. Points are spent there.
- Quest-tab landing: the event/banner feed before the map (daily reward strip, events with d:hh:mm:ss
  countdowns, current portal, shop banners) — screens.md §login hub, lategame.md §4.
- Tapping a map node has no popup: fade through "Loading..." into the quest.

## D2. Economy and progression numbers (phase 1, agent "economy")
- Stamina per tap rises with quest number: Q1 2, Q2 3, Q12–14 5, Q97 7 (fit a monotone step curve through
  these; keep portal quests on their wiki values). Quest 1 = 5 minions; Q12–14 = 11 taps.
- Gold per tap is flat per quest (Q1 6/minion + 10 at the end; Q12–14 30/tap) with an occasional bonus burst
  (~4–5× the tap value, ~1 in 10 taps), shown as "Perfect!" + floating number. Replace our 55 % chance roll.
- Level-up rewards: gold = 50 × new level; gems at some levels (L2 5, L7 50 — extrapolate sparingly, e.g. every
  5th level); potions at L3 (stamina) and L5 (mana). Level-up refills stamina and mana. 12 points per level,
  +30 HP / +1 stamina / +1 mana per point.
- Training cost depends on the sacrificed cards (observed table in playthroughs-2.md); check the client's
  enhance-config defaults in `exploration/research/round3/clients.json` first. Each training gives one level only if the
  XP says so — keep XP-based levelling, adjust the cost formula to the observations.
- Fusion: 400 gold at low levels (keep scaling above if we had it, anchored at 400).
- Gem costs: stamina potion 40 gems (restores to full), complete a card piece 20 gems, "recalculate rival" 10 gems.
- Regen: stamina and mana +1 per 60 s, no countdown text.
- Card inventory cap 100 (red when exceeded; exceeding allowed from booster/rewards but blocks… follow the
  client's behaviour if the Lua shows it).
- Player level cap 200. Starter state per D1.
- Unlock levels as constants: arena 4, training 5, league 6, fusion 2.
- Last quest of a portal pays 1000 gold.

## D3. League (phase 1, agent "league")
- Three tiers only: Bronze, Silver, Gold (no Platinum). ~50 players per league; ties share a rank; prizes to
  rank 29 (table in cardstats.md §6 / social.md). Top 3 promote, the rest fall back to Bronze (check
  `game.leaguemanager` for the real rule). +150 points per win; points also from Arena and Pieces fights;
  "double PvP points" days. A league runs with a d:hh:mm:ss countdown; enter popup `comp_league_enter_popup`
  ("BRONZE LEAGUE", "Your rank"), finish popup `comp_league_finish_popup`, info screen with rules + rewards.
- The "Mana needed 81 / 250" line is most likely the deck's mana requirement, not a fight cost — check the Lua.

## D4. Shop and booster (phase 1, agent "shop")
- Booster opening = 3×3 grid of nine face-down cards (`comp_closedbooster`, `comp_openedbooster`,
  `game.boostermanager2`): each pick costs 1 token; with no tokens left each remaining back shows a gem price
  (250 / 975 / 1000 depending on pack; take from the client or the videos). Top bar: back, gems, tokens, reset.
  "Card added to set: X n/8" plate for set cards; at the end "Do you want to open a new booster?".
- Shop: framed pack banners with "Look inside", countdowns and token counts; rarity squares ("May contain"), no
  odds percentages. Gem packs: 500 / 1000 / 3500 / 10000 (+heroic card +25 potions) at 4.99 / 9.99 / … / 49.99
  (purchases stay fake / free in our offline game as before).
- Big booster ≈ 1 Legendary, 3 Heroic, 5 Rare (medium confidence).

## D5. Battle presentation (phase 1, agent "battle")
- Pacing: ~1.5 s per attack, ~1 s for a round with one attacker; 5v5 fights 25–35 s. Default speed must match
  this; keep our speed button (convenience) but 1× = original.
- Boss intro: gold "Boss Fight N" banner (or "Showdown!") around the card in a rune circle, auto-advances; no
  Continue button, no "Boss HP" line.
- Pre-battle: no HP bars; bottom nav visible. After Attack: "Loading..." strip, then the tribe-bonus moment
  (glowing tribe icon, "TRIBE BONUS", HP number counts up by exactly 20 %), then "ROUND 1".
- Damage numbers red, bold, glowing over the target; a hero hit flashes a red strip over the HP bar; HP text red
  when low.
- Post-battle: Victory/Defeat banner → coin burst or glowing card → "★ Level n" card XP bars
  (`comp_levelup_card`) → level-up dialogs. No text "Rewards" table. Use `comp_fight_finish_popup` as reference.
- Skip fight first appears at the quest-3 boss.

## Not changed (deliberately)
- Sets: the original had 26; we keep our 10 (no data for the rest).
- Thief of Time ATK stays 1 (videos show 0; build rule; 1 damage).
- Older UI eras (2014 round buttons, wizard NPC) are ignored.
