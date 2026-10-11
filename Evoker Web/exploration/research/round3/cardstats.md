# Round 3: card stats above level 1, Dungeon Casino, League

Method: PvP battle screens show, on every card, **level (star), attack, HP and ability value** (battle card header: red = ATK, star = level, green heart = HP, anvil/gold icon = ability value).
fukfukara's 16 Random-PvP clips (1280x720, zoomed right-hand panel) therefore give 10 cards each at full resolution; I cropped each header, identified the card by art-matching
against `assets/cards` (plus stat sanity check against `data/cards.json`) and the fusion stage by the level cap / card art. Our numbers come from running `src/core/stats.js` itself.
Evidence frames: `frames/cardstats/`. Evoker Br clips are only 360p, so I used them for the League and Casino screens, not for stat reading (earlier rows from lategame.md kept).
Clips used: fukfukara 0SZci005_70, DDnHiiz_H2Y, ETvekCRx110, FaSZMsK4U8M, Gu9UW8IitQo, OqdVwFKKG5E, UJSujS9CBz4, UPQO7qEr48A, VyM6jqoY0UU, ZhhTFcxtW6Y, firjqPYp5GY, kcR99GnJFsQ, nxnOC8gnN7s, tbZPlNdt8Ao, x-j-j-NYSXM, zkT8ByEtKsg (all @ 0:00-0:02, the deck is on screen from the first frame); Evoker Br RGizuAsD8jc, 0FHHEDEqb1I ("GamePlay", level-40 Brazilian account), XUAoaKBJQ_Q.

## 1. Discrepancies (most important first)

### 1.1 Within-stage stat growth is NOT geometric; it is a slightly convex power curve (HIGH confidence, fixes up to 34 %)
All card values at the **level cap** match our `data/cards.json` exactly (see 2.1, 30+ readings, ratio 1.000), so the wiki cap checkpoints and the stage-start rule `base x 1.15^stage` are right.
The error is the interpolation in between. Our `computeRaw` uses `start * (cap/start)^t`, t = (L-1)/(cap-1). Observed mid-level values are **always above** that (+1 % to +12 %, +52 % for Bone Dragon L5)
and slightly **below** a straight line. A power curve fits all of them:

    value(L) = start + (capValue - start) * ((L-1)/(cap-1))^1.1        start = base * 1.15^stage

(`^1.1` read: p fitted per point is 1.07-1.19, rms-optimal p = 1.10.) Fit over 21 independent HP/ATK/ability points (10 cards, rarities Uncommon-Ultimate, stages 0-4):
**ours (geometric): rms 8.3 %, max 34 %; p = 1.0 (linear): rms 2.3 %, max 8.7 %; p = 1.10: rms 0.29 %, max 0.6 %**; p = 1.15: 0.95 %.
Same exponent for ATK, HP and ability value (ability tracks HP exactly, e.g. Tulzakk L10: 2885/1924/961, ratio to our values 0.998 on all three).
Every stage start of the form `base x 1.15^stage` is also confirmed (the stage-3 and stage-4 points would miss by >5 % otherwise).

Proposed change: replace `const raw = start * (capValue / start) ** t` with `start + (capValue - start) * t ** 1.1` (for base 0 stats keep the existing linear 0 -> cap rule; percentages unchanged).
Rows (ratio = observed / formula; "old" = current code, "new" = proposed). Stage was read from card art, the level cap of the stage is the second number:

| Card (rarity) | +stage, level | observed ATK / HP / ability | old (ours) | new | ratio old / new | source |
|---|---|---|---|---|---|---|
| Moon Dragon (Leg) | +0, L7/14 | 1195 / 1196 / - | 1174 | 1199 | 1.018 / 0.997 | 0SZci005_70 @0:01, 4 other clips |
| Moon Dragon (Leg) | +2, L24/34 | 3132 / 3133 | 2793 | 3110 | 1.121 / 1.007 | 0SZci005_70 |
| Tulzakk Bone Grinder (Leg) | +0, L10/14 | 2885 / 1924 / 961 | 2890/1926/963 | 2892/1928/964 | 0.998 / 0.997 | DDnHiiz_H2Y |
| Siren (Unc, see 1.2) | +0, L7/11 | 0 / 651 | 586 | 651 | 1.111 / 1.000 | x-j-j-NYSXM |
| Siren | +0, L9/11 | 0 / 780 | 733 | 782 | 1.064 / 0.998 | nxnOC8gnN7s |
| Bone Dragon (Ult) | +0, L5/15 | 100 / 550 / 3116 | 100/362/3200 | 100/551/3192 | HP 1.519 / 0.998 | 0SZci005_70 (same card as lategame.md) |
| Swarmkeeper (Her) | +1, L16/21 | 2389 / 1792 | 2314/1736 | 2378/1783 | 1.032 / 1.005 | ZhhTFcxtW6Y |
| Swarmkeeper | +1, L19/21 | 2599 / 1951 | 2566/1925 | 2599/1950 | 1.013 / 1.000 | ZhhTFcxtW6Y |
| Swarmkeeper | +4, L39/45 | 6646 / 4985 | 6243/4683 | 6624/4969 | 1.065 / 1.003 | UJSujS9CBz4 |
| Keeper of the Treasure (Leg) | +1, L20/24 | 2441 / 4884 | 2422/4846 | 2445/4891 | 1.008 / 0.998 | ZhhTFcxtW6Y |
| Hurricane Dancer (Her) | +3, L33/37 | 6325 / 3451 | 6147/3354 | 6345/3462 | 1.029 / 0.997 | tbZPlNdt8Ao |
| Scorpion Rider (Leg) | +3, L39/44 | 7864 / (HP not legible) | 7634 | 7907 | 1.030 / 0.995 | FaSZMsK4U8M |
| Mammoth Citadel (Leg) | +3, L34/44 | 5697 / 6837 / 3418 | 5512/6615/3307 | 5701/6842/3420 | 1.034 / 0.999 | Evoker Br Q-fyeJuiWWw (lategame.md) |
| Mammoth Citadel | +3, L40/44 | 6212 / 7455 / 3726 | 6141/7370/3684 | 6238/7486/3742 | 1.012 / 0.996 | same |
| Raptorial Fungus (Leg) | +3, L43/44 | 0 / 5720 / 8438 | 5701 / 8355 | 5727 / 8455 | 1.003 / 0.999 | Evoker Br xrUdFb1GJqo (lategame.md) |

Outliers (not growth-shape problems): Lightning Spirit +1 L17/24 observed 2959/1478 = 0.963 x new (an imperfect fusion, i.e. evolve bonus < 1) and Bone Dragon **ability** 3116 at L5 (new 3192, old 3200); the ability grows much more slowly than HP on this card (+16 over base at L5 of 15, base 3100 -> cap 3464), p ~ 2.5. Only card where ability and HP disagree; low priority.
Boss card check: **Goblin Thieves++** as a Dungeon Casino boss shows L18 = 1151/1151 and L19/19 = 1198/1199. Under the new model both equal 0.848 x our value (constant factor!); under the old model the factor would drift 0.865 -> 0.847. So that boss card is "fused with bonus ~0.85" and the p=1.1 curve explains the L18/L19 ratio (0.9608) exactly (old: 0.940).

### 1.2 Siren is an Uncommon with caps 11/15/19/23/27, not "Common" with 11/15/19/24/29 (HIGH)
Siren's frame is **green (Uncommon)** in every clip, and its level caps are the Uncommon table: seen "Siren +2 L19" HP 2010, "Siren +3 L23" HP 2734 (= our stage-3 cap value, so L23 is the max), "Siren +4 L27" (frame `siren_L27_L23.jpg`).
`data/cards.json` has `rarity: "common"`, `caps: [11,15,19,24,29]` - the only card in the file whose caps differ from its rarity table. Fix: rarity uncommon (mana 10 fits Uncommon 6-10), caps [11,15,19,23,27]; growth checkpoints (916 / 1407 / 2010 / 2734 / 3593) stay.
Sell/sacrifice/fusion costs then follow Uncommon (fusion 900/3600/8100/14400).

### 1.3 Thief of Time attack shows **0**, ours 1 (medium)
Opponent/own Thief of Time cards display ATK 0 (e.g. L51 17903 HP / 3581 ability; L63 25541 / 5109, ETvekCRx110 bottom row, nxnOC8gnN7s). `data/cards.json` base attack is 1 (the Scrapmaster-style placeholder). HP/ability match exactly. If a Thief with attack 1 is used in directional/"raise attack" code paths it behaves differently from the original.

### 1.4 Dungeon Casino set page lists 8 cards (we have 5) and the portal text (HIGH, see section 3)
### 1.5 League: full prize table, rules text, 150 points/win confirmed, ranking by points with ties (HIGH, see section 4)

## 2. Card stats table

### 2.1 Cards at their level cap (all match `data/cards.json`; ratio = observed / ours)
Lets us trust the wiki cap checkpoints. Read from PvP battle cards; one row per (card, stage, level):

| Card | +stage, level | ATK / HP / ability seen | ratio | source @ mm:ss |
|---|---|---|---|---|
| Voodoo Witch | +4, L63 | 0 / 14626 / 14625 | 1.000 | ETvekCRx110 @0:01 (and 6 other clips) |
| Voodoo Witch | +3, L51 | 0 / 10134 / 10134 | 1.000 | Gu9UW8IitQo @0:01 |
| Voodoo Witch | +1, L27 | 0 / 4556 / 4555 | 1.000 | OqdVwFKKG5E @0:01 |
| Wilderness Shaper | +4, L63 | 0 / 18335 / 9167 | 1.000 | VyM6jqoY0UU @0:01 |
| Wilderness Shaper | +4, L63 | 0 / 18204 / 9101 | 0.993 (bonus) | nxnOC8gnN7s @0:01 |
| Wilderness Shaper | +1, L27 | 0 / 5153 / 2576 | 0.971 (bonus) | DDnHiiz_H2Y @0:01 |
| Sentinel | +4, L63 | 12943 / 12944 / 3524 | 1.000 | UJSujS9CBz4 @0:01 |
| Thief of Time | +3, L51 | 0 / 17903 / 3581 | 1.000 | nxnOC8gnN7s |
| Thief of Time | +4, L63 | 0 / 25541 / 5109 | 1.000 | VyM6jqoY0UU |
| Thief of Time | +1, L27 (fukfukara's own) | 0 / 8360 / 1671 | 0.999 | all clips, bottom row |
| Thief of Time | +2, L39 (own) | 0 / 11928 / 2385 | 0.966 (bonus) | same |
| Lightning Spirit | +4, L54 | 0 / 12018 / 6009 | 1.000 | tbZPlNdt8Ao (opponent) |
| Lightning Spirit | +4, L54 (own x2) | 0 / 10559 / 5279 and 0 / 10269 / 5134 | 0.879 / 0.854 (bonus) | all clips, bottom row |
| Scorpion Rider | +3, L44 | 8616 / - | 1.000 | FaSZMsK4U8M |
| Scorpion Rider | +4, L54 | 11941 (and 11915 = 0.998) / - | 1.000 | Gu9UW8IitQo |
| Raptorial Fungus | +4, L54 / +3, L44 | 0 / 7835 / 12219 ; 0 / 5809 / 8617 | 1.000 | OqdVwFKKG5E, zkT8ByEtKsg |
| Colossus | +4, L54 | 11001 / 8556 | 1.000 | zkT8ByEtKsg |
| Bouncer | +4, L54 | 9146 / 13146 | 1.000 | zkT8ByEtKsg |
| Tomb Colossus | +4, L54 | 14658 / 8401 | 1.000 | firjqPYp5GY |
| Bone Dragon | +4, L63 | 500 / 20992 / 14063 | 1.000 | firjqPYp5GY |
| Mountain Yeti | +3, L51 | 14102 / - | 1.000 | Gu9UW8IitQo |
| Magmamancer | +4, L45 | 0 / 13299 / - | 0.983 (bonus) | zkT8ByEtKsg |
| Moon Dragon | +0, L14 | 1600 / 1600 | 1.000 | firjqPYp5GY |
| Siren / Gremlin / Gremlin+ / Lich King | L11 / L9 / L10 / L13 | 0/916 ; 0/749 ; 0/945 ; 0/651 | 1.000 | ETvekCRx110, VyM6jqoY0UU, ZhhTFcxtW6Y |
| Siren +2 / +3 | L19 / L23 | 0 / 2010 ; 0 / 2734 | 1.000 (cap = 19/23, see 1.2) | FaSZMsK4U8M |
| Hurricane Dancer?? / Ore Titan | see lategame.md | Ore Titan ++ L34/34: 5043/4128/1834 = 0.912 x ours on all three (bonus) | | Evoker Br XUAoaKBJQ_Q |

### 2.2 Evolve Bonus (what the numbers say)
All stats of one card scale by the same factor, so a card's factor is readable from any stat. Observed factors on max-level cards: 1.000 (most), 0.999, 0.993, 0.983, 0.971, 0.966, 0.912, 0.879, 0.854, plus the Casino boss 0.848.
So the bonus exists, applies uniformly to ATK/HP/ability, never exceeds 1.000, and in these samples is never below ~0.85 (our 0.75 floor is not contradicted, but nothing below 0.85 seen). The two Lightning Spirits in the same deck (0.879 vs 0.854) show it is per instance.
I could not find a screen that prints the bonus number itself (the card detail shows only the resulting stats). Our formula `0.75 + 0.25 x avg(level/cap)` is untested (inputs unknown).
Opponent AI cards in Random PvP are mostly bonus 1.000 (stage-4 cap decks), a few 0.97-0.99.

### 2.3 Ability texts
The six level-1 Evoker Br cards from lategame.md are already listed there; new verbatim (PT) strings: Goblin Thieves "Troca vida e ataque de uma carta aleatoria." (EN client text would be "Switch health and attack of a random card", our data has exactly that).

## 3. Dungeon Casino (Evoker Br RGizuAsD8jc "Parte 1: Goblin Thieves"; XUAoaKBJQ_Q @0:27 for the set page)
- Quest-tab banner: title "Dungeon Casino", subtitle (PT): **"O que acontece na masmorra, fica na masmorra..."** (what happens in the dungeon stays in the dungeon), "Portal closes in: 6:11:15:40" (the "closes in" is English even in the PT client) (`casino_goblin_thieves_text.jpg`).
- Map: 100 nodes ending in a rune circle at "100" (blue beam), same as other portals; quest timer 6:11:xx at the top of the map. Quest intro dialogue (PT): "E tao dificil encontrar ouro hoje em dia." / "Os anoes guardaram tudo no cassino deles." ("It is so hard to find gold nowadays." / "The dwarves kept everything in their casino.") and the ranger's "O que acha de irmos la dar uma olhada?!" ("What about going to take a look?").
- Boss fights are numbered "Bossfight 2", "Bossfight 4" (boss card in a rune circle); the boss is **Goblin Thieves** (Uncommon, ++, mana 10): L18 1151/1151 and L19 1198/1199; boss player HP 1450 (first), 2000 (Bossfight 2), 3500, 5250 (Bossfight 4). Ability text: "Troca vida e ataque de uma carta aleatoria." Rewards: a coin burst/gold, card pieces (a dwarf card, an elf card).
- Set page "Dungeon Casino (2/26)": **8 cards** (2x4), progress bar "7/8", reward **"Recompensa: 5000 gemas"** (padlocked until complete). Card order: Goblin Thieves (Unc, green frame), a rare ogre/troll, a rare waitress with a drinks tray, a heroic tavern-crowd card, a heroic crystal-ball woman (Wheel of Fortune), a legendary brawler (Bouncer), a legendary hooded gambler, and a locked red-frame Ultimate (Umbral Dragon) (`casino_set_page_2of26.jpg`).
  Ours has only 5 Casino cards (goblin-thieves, wheel-of-fortune, bouncer, wizard-apprentice, umbral-dragon): **missing 2 Rare + 1 Heroic** (the ogre, the waitress, the tavern card), and the hooded gambler vs Wizard Apprentice art needs checking (the `Wizard_Apprentice+.png` asset in `assets/cards` is actually a cursed-stag art, so the file naming of the casino PNGs is suspicious).
- Mechanics beyond the cards: nothing casino-specific was visible in the quests (they are ordinary 3-opponent quest taps with "PERFEITO" feedback); the casino identity is only the set + boss ability text. No tokens/roulette screen appeared in the clip. Other Casino card texts could not be seen (the clip only shows the boss).
- Set reward values on the same page carousel: Dwarven Rage (6/26) 4000 gems, Dawn 5600 (matches), so Casino = 5000.

## 4. League (Evoker Br/"GamePlay" 0FHHEDEqb1I, level 40 account, Brazilian client; frames `league_*.jpg`)
Screen: orange title "Liga de Bronze" with an **info "i" button** (opens rules), countdown below in `d:hh:mm:ss` (e.g. 0:17:09:10), rows = rank, avatar (or "?"), name, trophy-ring icon + points, **prize icons**, crossed-swords attack button (greyed if not attackable). Players with 0 points have rank "-" and an empty prize cell; ranks 30+ also have an empty prize cell. Ties share the rank number (two players with 750 are both 5th, three with 300 are all 17th; ranks then skip: 5,5,7; 17,17,17,20).
The list had 34 players with points plus ~15 with 0 (49+ rows). Own name highlighted. Points seen: 1759 / 1350 / 1050 (own) / 900 / 750 / 750 / 745 / 700 ... 363, 338, 332, 300 x3, 253, 198, 180, 153, 150 x3, 140, 104, 85, 74, 63, 59, 58 (names such as michaelushka, AaaJJJ, mandrake, soneka, Champ).
Own points 1050 -> **1200 -> 1350 after two wins (+150 each; confirms 150 per win)**; the opponents beaten had 58 and 0 points. Tapping a row opens a pre-battle screen (opponent name, his 5 cards as small tribe emblems, "Atacar!", own name, own deck, **"Mana necessario: 81 / 250"**; mana fell 250 -> 170 -> 89 over two attacks, i.e. ~81 each), then the normal PvP battle (orange arena, "RODADA n", "Pular luta"), then the card level screen ("Nivel 12 (MAX.)" ... with "Continuar") and back to the list.
**"REGRAS" (rules)** verbatim (PT): "Voce comeca na Liga de Bronze. Derrote outros jogadores para ganhar pontos! Apos cada torneio, os tres jogadores com mais pontos avancam para a proxima liga; os outros voltam a de Bronze. Quanto mais alta for a liga, melhores serao os premios!" (= start in Bronze; beat players for points; after each tournament the **top 3 advance** to the next league, the rest fall back to Bronze; higher league = better prizes.)
**"PREMIOS"** (rank: prize), "pocoes de vigor" = stamina potions:

| Rank | Gold league (Liga de Ouro) | Silver (Prata) | Bronze |
|---|---|---|---|
| 1 | 1 legendary card, 12 mana potions | 1 heroic card, 7 mana potions | 1 rare card, 5 mana potions |
| 2 | 1 legendary card | 1 heroic card | 1 rare card |
| 3 | 1 heroic card | 7 mana potions, 7 vigor potions | 5 mana potions, 5 vigor potions |
| 4 | 700 gems | 400 gems | 200 gems |
| 5-9 | 10 mana potions, 10 vigor potions | 5 mana, 5 vigor | 2 mana, 2 vigor |
| 10-19 | 10 mana potions | 5 mana potions | 2 mana potions |
| 20-29 | 200 gems | 100 gems | 25 gems |

Differences to our recreation (`evoker-research-brief.md` 5.3 / design table: 8 simulated players, 1st 200 gems, Bronze->Platinum): the real league has ~30-50 players, **three tiers only (Bronze/Silver/Gold)**, promotion for the **top 3**, prize bands up to rank 29, cards as prizes for the top 2-3, ties shown, tournament length at least 17.5 h left at the time of recording (timers 0:17:09:10 and 0:17:06:04), points +150 per win with no sign that already-beaten players are blocked. The row prize icons use: card (blue fan) x1, blue potion xN, orange potion xN, gem pile xN.
Not found: league duration (it is a "torneio"; the "TORNEIO x2" banner in lategame.md doubles PvP points), the Silver/Gold list screens (the account is in Bronze), the end-of-tournament result popup, the join dialog (screens.md has one: "Congratulations! Bronze League completed, Your rank: 32").

## 5. Looked for but not found / not done
- A card-detail or training screen printing "Evolve Bonus" as a number: none. Only the Turkish title of tbZPlNdt8Ao ("Evolve Bonus onemli") and the observed factors above.
- Leveled card faces in the other Evoker Br clips (360p, collection rows with tiny stats) were only sampled; the Q-fyeJuiWWw collection row shows `Nivel 15/27`-style rows with 4-digit stats but not legible enough to be trustworthy. Solution-nerd and FloW top-card clips are level 1 stage 0 only (already compared in lategame.md: all equal).
- Casino quest rewards numerically (gold amounts/tokens), Casino-card ability texts other than Goblin Thieves.
- Not examined: Benito booster/training videos for leveled cards (they show only "Level 54 (MAX)" lists).
