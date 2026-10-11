# Evoker (flaregames, 2013–2018) — Research Brief for the Web Recreation

Compiled 2026-10-07 from web research (archived store pages, the Evoker fan wiki, review sites,
the flaregames forum, YouTube video pages) and from ~60 original screenshots saved under
`exploration/research/reference/`. Confidence tags: **[H]** stated by an official or primary source,
**[M]** secondary source or consistent across screenshots, **[L]** inferred.

Supporting material in this folder:

- `reference/` – original screenshots (store listings, in-game screens, card details), logo, icon, key art.
- `wiki/` – text dump of all 260 pages of the Evoker fan wiki (evoker.fandom.com), one file per page.
- `wiki-card-catalog.json` – the 200-card catalog parsed from the wiki (stats per fusion stage, ability text, categories).
- `web-research-findings.txt` – raw findings from the research agents with source URLs.

---

## 1. Identity

| Item | Fact |
|---|---|
| Title | **Evoker** — store names over time: *Evoker – A Magic Fantasy Game* (2013–14), *Evoker – A Magic Trading Card Game (TCG)* (iOS), *Evoker: Magic Card Game (TCG)* (Google Play) [H] |
| Developer / publisher | flaregames GmbH, Karlsruhe, Germany (also Royal Revolt 2, Throne Wars, Nonstop Knight) [H] |
| Platforms | iOS (App Store id 637436624), Android (package `com.flaregames.craftedevil`), Windows Phone [H] |
| Timeline | Soft launch May–July 2013; official launch ("left stealth mode") 10 Dec 2013; last client 1.7.4 (May 2016); shutdown announced 23 Jul 2018; servers closed 22 Aug 2018 [H] |
| Genre | Free-to-play fantasy collectible card battler with **5-card line-ups that auto-fight** (no hand, no draw step) [H] |
| Orientation | Portrait (phone/tablet) [H] |
| Lore | The player is an Evoker (summoner) fighting the evil Lord **Morden**. Tribes: Elves, Orcs, Dwarves, plus Neutrals (dragons, elementals, demons, golems). World names: Xulotl (orc), Uma re'ena (elf), Domank Hrun (dwarf). A red-haired ranger girl is the tutorial guide. [M] |
| Store copy (v1.7) | "Join thousands of REAL players in this epic trading card game full of magic and fantasy. Summon powerful creatures. Fight hundreds of glorious adventures." Bullets: hone your Summoner skills in solo quests; level your character and choose which skills to boost; collect creatures from the elves, orcs and dwarves and reinforce them with dragons, elementals and demons; grow your creatures' strength through battle experience; make them more powerful through clever combinations (fusion); challenge other players and rob them of their treasure. [H] |
| Ruled out | *Magic Evoker* (2026, Evoker Studios, Brazil — an unofficial homage), *Evokers* (Burger Games tabletop), WoW/Minecraft/D&D "evoker". |

---

## 2. Battle rules

### 2.1 Setup [H]
- Each side fields up to **5 cards in 5 slots** (fewer allowed). Player row at the bottom, opponent row at the top; slot *i* faces slot *i*.
- In the early game only the middle slots are usable; outer slots are padlocked and unlock with player level (observed: level 2 = slots 2–4, level 3 = slots 2–5, level 5 = all five). [M]
- No hand, no draw, no in-battle resources. Placement (which card in which slot) is the only decision. The player presses **Attack!** and the fight auto-resolves. A **Skip fight** button jumps to the result.
- Player health is a **character stat** (1500 at level 1), not derived from cards.

### 2.2 Round structure (max 20 rounds) [H/M]
Official text (Game Basics): each round has a **Main Phase** (start-of-round effects: buffs, stuns, dazes), a **Battle Phase** (all attacks resolve automatically in order; a creature at or below 0 life *still attacks this round*), and a **Clean-up Phase** (post-combat effects such as healing; creatures at or below 0 health leave the battlefield). Some abilities (counters, death effects) have priority before/after other effects.

Player-documented fine ordering (wiki *Combat* page) [M]:
1. **Suspension** – all suspend/suppress effects fire simultaneously (a suppressed card loses its abilities for the round but still attacks). Because this happens first, a suspend can never be prevented by another suspend.
2. **Pre-attack** – daze, attack/HP increase or decrease, strengthen, indestructible. Order irrelevant.
3. **Attack** – attacker's cards act left→right, then defender's cards right→left. Damage is applied immediately to targets, but nobody dies until phase 7, so every living card gets its attack in.
4. **Creature heal**
5. **Player heal**
6. **Death triggers** (abilities that fire "if X dies"), possibly chaining.
7. **Creature deaths** – cards at ≤0 HP are removed unless revived (Phoenix, Gargoyle, Moon Dragon...).
8. **End-of-combat check**.

### 2.3 Attacking [H]
- A card's red arrows show its attack directions: **direct** (the slot opposite), **left** and/or **right** (the diagonal opposing slots). A few cards attack their **own** neighbours (Minotaur, Bloodsoaked Totem).
- The card's attack is **split evenly** over the number of directions (9000 attack in 3 directions = 3000 each).
- A direction that points at an **empty slot hits the opposing player directly** for that share ("if one of your cards beats the one in front of it, you can do direct damage to your opponent"). Diagonal attacks off the board edge are lost (except own-neighbour attackers, whose off-board share hits their own player).
- Cards with 0 attack cannot attack; their ability is their job.
- Damage persists between rounds (no regeneration unless healed).

### 2.4 Ending the fight [H]
- Ends when a player is at ≤0 health, or after round 20, or when **no creature with attack remains on either side**.
- Winner = higher health. If both ≤0, the one with more (less negative) health wins. Equal health after round 20 = draw.

### 2.5 Tribe bonus [H/M]
- Main tribes: **Dwarves (green), Elves (blue), Orcs (red)**; fourth tribe **Neutrals (yellow, "dragons")**.
- If the line-up has ≥3 cards of one main tribe and no card of another main tribe, the player's maximum health for that fight rises by **15 %** (official Game Basics; one wiki page says 20 %). Up to two Neutrals may be mixed in and the bonus is kept. Neutrals alone give no bonus. For smaller line-ups: all non-neutral cards must share one tribe and must be in the majority (3 cards: 3 same or 2 same + 1 neutral; 4 cards: 4 same or 3 + 1 neutral; 5 cards: 5, 4 + 1, or 3 + 2).

### 2.6 Ability vocabulary [M]
| Effect | Rule | On-screen depiction |
|---|---|---|
| **Daze** | target cannot attack this round; abilities intact. Nearly always 1 round (Basilisk: 2). | red broken sword over the creature |
| **Suspend / Suppress** | target loses all abilities for the round; still attacks. Fires at the very start of the round. | blue circles with arrows |
| **Stun** | suspend + daze applied as two separate effects | red circles around the creature |
| **Indestructible** | takes no damage during the stated round(s) (usually round 1; yetis from round 2 on). Does not stop Direct Kill. | glowing transparent sphere |
| **Strengthen** | raises own or others' attack (pre-attack phase). Buffs to "neighbours" are split in half per neighbour; heals are not split. | — |
| **Heal** | creature heal (phase 4) or player heal (phase 5) | green glow / rising hearts |
| **Revive** | returns at full health once (Phoenix, Gargoyle, Sand Mystic…); Moon Dragon revives all allies that died the same round | winged frame with light |
| **Creature kill** | Colossus kills the opposing card with the highest attack at end of round 2; Dwarf Judge the lowest. Ignores indestructible. | red skull with blood |
| **Card damager** | damage to every enemy card each round, on death, or reflected to the attacker | — |
| **Direct damager** | damage to the opposing player each round, on the death of the opposite card, or reflected | — |
| **Unoccupied-field modifiers** | Rat Eater / Succubus +200 vs an empty slot, Treeman −200 | — |
| **Self-damage** | Minor Demon / Arch Demon damage their own player each round; Blood Spitter damages itself | — |
| **Trainer** | Lich King, Crystal Ghost, Blood Dragon: no combat use, huge XP when sacrificed | — |

The full ability text of all 145 ability cards is in `wiki-card-catalog.json` (field `ability_text`) and in the
compact list in section 3. Evolving-ability cards change text per fusion stage (section 3.3).

---

## 3. Cards

### 3.1 Catalog [H]
200 distinct cards: Dwarf 49, Elf 49, Orc 49, Neutral 53. Rarities (frame colour, count):

| Rarity | Frame | Count | Mana range | Max level unfused / + / ++ / +++ / ++++ |
|---|---|---|---|---|
| Common | grey | 4 (+1 "very common": Siren) | 1–2 | 9 / 10 / 11 / 12 / 13 |
| Standard | white/silver | 16 | 3–5 | 10 / 12 / 14 / 16 / 18 |
| Uncommon | green | 51 | 6–10 | 11 / 15 / 19 / 23 / 27 |
| Rare | blue | 48 | 11–15 | 12 / 18 / 24 / 30 / 36 |
| Heroic | purple | 36 | 16–20 | 13 / 21 / 29 / 37 / 45 |
| Legendary | orange/gold | 35 | 21–25 | 14 / 24 / 34 / 44 / 54 |
| Ultimate | red | 9 | 30 | 15 / 27 / 39 / 51 / 63 |

Each card has: name (with "+" marks for fusion stage), tribe emblem, art, attack arrows, rarity label, five fusion pips,
level bar "Level n / max", **Attack**, **Health (Defense)**, **Mana cost**, optional **ability value** (the "____" in the text,
shown in battle with an anvil icon) and ability text. Attack, health and ability value grow with level and jump with fusion.

### 3.2 Stat growth [M/L]
The wiki tables give stats at level 1 and at the level cap of each fusion stage (84 cards complete, the rest partial).
Median multiplier at the cap of each stage vs level 1 (Standard … Ultimate):

| Rarity | unfused | + | ++ | +++ | ++++ |
|---|---|---|---|---|---|
| Common | 1.87 | 2.36 | 2.91 | 3.52 | 4.19 |
| Standard | 2.0 | 2.65 | 3.4 | 4.25 | 6.9 |
| Uncommon | 1.8 | 2.5 | 3.4 | 4.7 | 6.1 |
| Rare | 1.58 | 2.22 | 3.15 | 4.11 | 5.66 |
| Heroic | 1.43 | 2.04 | 2.84 | 3.88 | 5.24 |
| Legendary | 1.31 | 1.86 | 2.60 | 3.58 | 4.87 |
| Ultimate | 1.45 | 2.25 | 3.3 | 4.6 | 6.3 |

Within a card, attack, health and ability value scale by about the same factor. Growth within a stage is
smooth (roughly geometric); the tables are "with full Evolve Bonus", i.e. assuming the two cards fused were
at their level cap.

### 3.3 Evolving-ability cards [H]
- **Bog Yeti / Mountain Yeti / Army of Ghosts**: unfused none; + no damage in round 2 (Bog) or 3 (Mountain, Army); ++ round 3 / 2; +++ rounds 2 and 3; ++++ no damage after round 1.
- **Sand Yeti**: heals X of your health each round at every stage; adds the yeti indestructible rounds (+ round 3, ++ round 2, +++ rounds 2–3, ++++ after round 1).
- **Magmamancer**: unfused none; + suspends the card opposite her left neighbour in round 1; ++ stuns it in round 1; +++ also suspends the card opposite in round 2; ++++ stuns the card opposite in round 2.

### 3.4 Card art
The fan wiki hosts 997 images: base art for 188 cards (`Name.jpg`) and fusion-stage art (`Name+.jpg` … `Name++++.jpg`),
plus later-era cards under numbered names. They are being copied into `assets/cards/` for the recreation.

---

## 4. Visual design and UI

### 4.1 Style [H]
- Hand-painted dark fantasy card art (flaregames' "hundreds of beautiful fantasy artworks, handpainted for the game").
- UI chrome: **dark slate/stone panels with bevelled carved frames**, subtle hexagonal texture, thin lighter edge highlights;
  buttons are **steel-blue rounded rectangles** with a bevel; the big *Attack!* button sits in a flaming orange spiked frame.
- Typography: a clean geometric sans (Proxima-Nova-like; use *Montserrat* / *Nunito Sans*) for all UI; marketing headers in
  thin gold caps. Numbers are colour-coded: **attack red, health green, mana cyan, level/star yellow, ability value orange,
  gold yellow, gems light blue**, stamina orange.
- Logo: gold bevelled serif "EVOKER" on a green rune-circle plaque with a laughing green-faced Morden medallion (`reference/logo.png`).
- Backgrounds: painted landscapes (green valley with mountains, swamp, snowy pass, orange sunset ruins, lava cave).

### 4.2 Top HUD (all menu screens) [H]
Left: back arrow and "?" help buttons. Centre panel: `Lvl. ★ n` with a yellow XP bar; below it the **stamina** bar (orange crystal icon,
potion count to the left, `cur/max`) and the **mana** bar (blue drop icon, potion count, `cur/max`). Right panel: gold with coin icon,
gems with gem icon, a green **+** button (shop).

### 4.3 Bottom navigation (6 buttons) [H]
Trophy = **League** (unlocks level 5) · crossed swords = **Arena** (level 4) · star-compass = **Quest map** · cards = **Cards/Deck** ·
green card stack with plus = **Shop/Boosters** · character arrow with "!" badge = **Character / level-up** (badge when stat points are unspent).
Locked buttons show a padlock. Active button has a light outline.

### 4.4 Battle screen [H] (see `reference/screenshots/Evoker-cards-battle.jpg`)
- Top bar: opponent portrait in a carved frame (left), opponent name, **ROUND n** (right).
- Opponent HP bar: green heart icon, `cur / max` centred, green fill on a dark track. Mirrored bar for the player below their row.
- Opponent row of 5 compact cards. Each compact card: thin HP bar outside the card (above for the opponent, below for the player),
  a stats strip (red sword ATK, yellow star level, green heart HP, orange anvil ability value) on the side facing the middle
  (**top of opponent cards, bottom of player cards**), art, and direction arrows on the edge facing the enemy (red = attack,
  green/blue = heal/buff directions).
- Empty slots are black recessed rectangles. Dead cards dissolve in golden sparks.
- Effects: yellow beam from attacker to target; red sunburst on hit; floating red "-100" numbers next to the HP bar; green
  cloud for heals; dazed cards show a red broken sword; stunned cards red rings; suspended cards blue rings.
- Bottom bar: player name (right), "?" button, **Skip fight** (steel-blue, bottom-left).
- Result popup: "Victory" / "Defeat" banner, rewards, "Tap to continue".

### 4.5 Pre-battle / deck screen [H]
Opponent name, opponent row (PvE face-up with stats; PvP face-down card backs showing the tribe emblem), flaming **Attack!** bar,
player name, player row with drag-and-drop cards (dragged card tilts and glows blue), and a **"Mana needed: 22 / 61"** bar under
the row (sum of deck mana vs current mana) with an arrow slider.

### 4.6 Card detail screen [H]
Name plate (top-left, dark), tribe emblem (top-right, carved square: Dwarf = green crystal, Elf = blue triple arrow, Orc = red axe,
Neutral = orange flame), large art with direction arrows, coloured frame by rarity; below: rarity label in the rarity colour,
5 crystal pips (lit = fusion stage + 1), star + "Level n / max" bar; stats panel: sword ATK, heart HP, drop mana, ability text in orange;
buttons: magnifier (zoom art), "$" (sell).

### 4.7 Other screens [H/M]
- **Title screen**: red dragon breathing fire over the hooded Evoker, logo at the bottom (`reference/screenshots/Evoker-title-screen.jpg`).
- **Quest map**: painted world map scrolling vertically, numbered square nodes connected by lines, current node glows in a golden rune circle;
  portal banner at the top with name and countdown; ranger girl speech bubble for tutorial lines ("That card is tough! You need a stronger deck.").
- **Quest progress**: purple "nn %" bar under the HUD, minion portraits in a tray at the bottom; tapping minions spends stamina; reward burst
  (gold coins) in the landscape; "Drink potion" dialog when stamina is too low.
- **Boss fight intro**: "Boss Fight n" banner, the boss card in a glowing rune circle, name plate.
- **Arena**: tabs Arena / Pieces / Replays; three opponents coloured green/yellow/red (easy/normal/hard) with info and attack buttons;
  event banner (e.g. "Infinite Wisdom – double XP"). Player info popup shows best card, level, stamina, mana, HP, quests, fights won.
- **League**: "Bronze League" header with countdown (24 h), rows of players (rank, avatar, name, points, progress bar, attack button).
- **Card training**: training slot + sacrifice stack, gold cost, OK; collection grid below with arrows.
- **Collection card** (compact): art, ATK, fusion-pip count, HP, mana, "Level n / max" bar.
- **Level-up popup** (card): "Level up!" over the art with old → new star level, attack, health, ability value; "Tap to continue".
- **Portal collection page**: portal name "(n/22)", "0/8" progress, "Reward: 5,300 Gems", 8 locked grey card silhouettes with rarity frames.
- **Player stats**: avatar, name, Change name, best card, Level/stamina/mana/HP bars, bonus column, Quests, Battles won, "Your cards n/80".

---

## 5. Progression and modes

### 5.1 Character [H]
Level 1: 50 stamina, 50 mana, 1500 HP. Each level-up grants **12 stat points**: 1 point = +1 stamina, +1 mana or +30 HP (the "!" badge
reminds you to spend them). Max level 200. Stamina and mana regenerate **1 per minute**. Orange potions refill stamina, blue potions refill
mana; when short, the game offers a potion (or sells one for 40 gems, 20 during "drinking contest").

### 5.2 Quests (PvE) [H]
- Quest map spends stamina. **Main quest = 100 quests**; each **portal = 25 quests** (limited-time, rotating every few weeks).
- Each quest: 2–5 **minion waves** of 2–4 minions. Tap a minion = one stamina cost (3 per tap at Q1–5, 4 at Q6–10, 5 at Q11–30, 6 from Q31, up to ~8 at Q100).
  After a wave: chance of a whole card or gold. Then the **boss fight**: one fixed boss card + four random cards of fixed quality; costs nothing;
  win → unlock next quest and a reward (gold, gems, potions, tokens or a card piece); lose → redo the minions. Old quests can be replayed.
- Total stamina per quest: 15 (Q1), 18 (Q2–3), 21 (Q4–5), 28, 32, 36, 44, 48 (Q6–10), ~55 (Q11–15), 50 (Q16–19), 75 (Q20–30), 60–84 (Q31–42),
  100–175 (Q58–100). Boss cards from Q33 on are listed in `wiki/Main_Quest.txt` and `wiki/Quests__PvE_.txt` (e.g. Q33 Tunnel Digger … Q100 Imperial Dragon++).
- Portals documented: The Dark Beyond, Dawn of Eternity, Desert Twilight, Divine Peace, Dragon Hunt, Dread Empress, Dwarven Rage, Dying Dreams,
  Dungeon Casino. Each has 8 set cards (collect all → 4,600–5,600 gem reward), 25 quests with boss, boss HP (≈4,000 → 10,500), stamina per figure (6 → 17),
  gold per figure (34 → 97). Boss reward quality rises from Rare to Legendary pieces. Portal boosters: a low token (~100 gems) and a high token (~1000 gems).

### 5.3 Arena, Pieces, League (PvP, asynchronous) [H/M]
- **Arena**: three random opponents (green/yellow/red). Attacking costs mana equal to the **sum of your deck's mana costs** and awards Tournament Points, gold and card XP.
- **Pieces**: strong cards drop as **card pieces**; the Pieces tab has 8 piece-hunt slots; attack players who hold pieces of a card you started collecting; win = steal the piece, lose = lose only mana. Missing pieces can be bought with gems (Uncommon 20; Rare 30/60/140; Heroic 170…1700; Legendary 125…4000). First piece of an empty slot 100 gems.
- **League**: daily (24 h) bracket of ~6–10 players; a win in a league battle = **150 points** (300 on double days); tiers Bronze, Silver, Gold (…); prizes for the top 8 (gems, potions, tokens). The "Replays" tab replays recent battles.
- The "Gremlin trick": attack with a lone 1-mana Gremlin to lose cheaply and re-roll an opponent.

### 5.4 Cards economy [H]
- Collection limit **80 cards** (quest card rewards beyond the limit convert to gold).
- **Training**: cards gain XP from any battle (double on "Infinite Wisdom" days); or **sacrifice** cards (training slot + sacrifice stack) for gold; XP given depends on the sacrificed card's level and mana cost (trainer cards give ~4,000 / 9,000 / 20,000 XP).
- **Fusion**: fuse two identical cards of the same stage → stage +1 (max ++++), level resets to 1, higher level cap, big stat jump. 16 base cards make a ++++. Fusing cards below their level cap gives a weaker result ("level up all 16 cards or you'll regret"). Gold cost per step: Standard 400/1,600/3,600/6,400; Uncommon 900/3,600/8,100/14,400; Rare 1,920/7,680/17,280/30,720; Heroic 3,750/15,000/33,750/60,000; Legendary 7,200/28,800/64,800/115,200; Ultimate 10,780/43,120/97,020/172,480.
- **Selling** (gold): Common 5·M·(9+L+F); Standard 6.5·M·(10+L+2F); Uncommon 8.5·M·(11+L+4F); Rare 20·M·(12+L+6F); Heroic 30·M·(13+L+8F); Legendary 50·M·(14+L+10F); Ultimate 55·M·(15+L+12F) with M = mana, L = level, F = fusion count.
- **Boosters** (face-down card picked from a pack): Neophyte 50 gems / bronze round token (green, blue, purple cards); Summoner 350 gems / silver square token (blue, purple, some orange); Archmage 975 gems / gold hexagonal token (blue, purple, orange). Tokens drop from quest bosses.
- **Daily rewards** (consecutive days): 1: 2 stamina potions · 2: 1 mana + 1 stamina potion · 3: 40 gems · 4: 2 stamina · 5: 1+1 · 6: 80 gems · 7: 2 Neophyte tokens · 8: 3 stamina · 9: 1 mana + 2 stamina · 10: 120 gems · 11: 3 stamina · 12: 1+2 · 13: 160 gems · 14: 2 Summoner tokens · 15: 4 stamina · 16: 2+2 · 17: 200 gems · 18: 4 stamina · 19: 2+2 · 20: 240 gems · 21: 2 Archmage tokens.
- **Events**: Infinite Wisdom (double card XP), Drinking contest (potions 20 gems), Card-piece event (piece prices halved), Great potion deal, Heroes package, Easter/Christmas events with trainer cards.

---

## 6. Unknowns and the assumptions the recreation makes

| Unknown | Decision for the recreation |
|---|---|
| Exact XP needed per player level and per card level | Player: `xp(L→L+1) = 100 · L^1.4` rounded. Card: `xp(l→l+1) = 40 · (base mana) · l^1.5 / 10`, tuned so a Standard card reaches its cap after ~30 easy fights. Battle XP for the player = 20 + 2·opponent level (+50 % on a win); card XP = 10 + enemy deck mana sum / 2 (double on Infinite Wisdom). |
| Stat growth per level inside a fusion stage | Geometric interpolation between the wiki checkpoints; for cards lacking checkpoints, use the rarity multiplier table (section 3.2). |
| Fusion with non-max-level cards | Result keeps the stage's standard curve scaled by `0.75 + 0.25 · avg(level/cap)` of the two inputs ("Evolve Bonus"); the UI warns before an imperfect fusion. |
| Sacrifice XP and gold cost | XP = 25 · mana · (level + 2) · rarity factor (Common 0.6, Standard 0.8, Uncommon 1, Rare 1.6, Heroic 2.4, Legendary 3.5, Ultimate 5); trainer cards use their documented XP; gold cost = XP / 4. |
| Pieces per card | Uncommon 2, Rare 4, Heroic 6, Legendary 10 (one more than the maximum "missing pieces" in the gem price table). |
| Deck slot unlocks | Level 1: slots 2–4; level 3: slot 5; level 5: slot 1. |
| Boss "four random cards of fixed quality" | Quality = rarity band by quest (Q1–10 Common/Standard, Q11–30 Standard/Uncommon, Q31–60 Uncommon/Rare, Q61–90 Rare/Heroic, Q91–100 Heroic/Legendary), levels scaled to the quest; boss HP from the wiki tables where known, otherwise interpolated. |
| Quest rewards | Wave: 55 % gold, 25 % nothing, 20 % card of the quest's quality band. Boss: 45 % gold, 25 % token, 15 % card piece (Q≥31), 10 % potion, 5 % gems. |
| Arena opponents | Simulated players generated from the catalog around the player's level (±2 levels; deck power ±20 %); names from a fantasy name list. |
| League | Daily league of 8 simulated players whose points grow over the day; player gets 150 points per win, each opponent can be fought up to 3 times per league; prizes: 1st 200 gems, 2nd 100, 3rd 50, 4th–8th 2 potions. Tiers Bronze → Silver → Gold → Platinum by cumulative league points. |
| Portals rotation | All documented portals included; one portal open at a time for 7 days, cycling in order; the player can also open any portal manually from a debug/"Portal archive" menu. |
| Attack resolution order | Attacker left→right, then defender right→left, damage applied immediately, deaths at clean-up (per the official phase text). |
| Buff splitting | "Neighbours" buffs give half the value to each neighbour; heals give the full value to each target (wiki statement). |
| Tribe bonus | 15 % (official text). |
| Minion fights | Each tap costs the per-tap stamina and defeats one minion instantly (as in the original); no mini-battle. |
| Timers | Stamina/mana regen and league/portal timers use real wall-clock time stored in the save. |

---

## 7. Sources (selection)

- Fan wiki: https://evoker.fandom.com/wiki/Game_Basics, …/Combat, …/Abilities, …/Cards, …/Training_cards, …/Gold, …/Gems, …/Resources, …/Quests_(PvE), …/Main_Quest, …/Arena_(PvP), …/Player_Stats, …/Daily_rewards, …/Decks, …/Tribe_Bonus, portal pages, 200 card pages (all dumped in `wiki/`).
- Store listings (archived): App Store id637436624, Google Play com.flaregames.craftedevil, APKCombo/Uptodown mirrors.
- Official site (archived): http://evokergame.com (2014–2017 captures), flaregames.com game page, flaregames support centre "Game Basics".
- Reviews: MMOs.com review and screenshot galleries (mmos.com/review/evoker-game), WriterParty tips (Oct 2014), MMOHuts.
- Forum: forums.flaregames.com Evoker section (league points, training, fusion discussions).
- Videos: BenitoLPGames "EVOKER – Tutorial Playthrough" (wqzda6-2fs4), "Day of a Godlike" (DhEcS3qE34Q), "Project 900 Token" (OpWzpIY16_s); GamePlayTV (nNHGuE5u0GE); Touch New Games (Svgtj4sYZRk).
