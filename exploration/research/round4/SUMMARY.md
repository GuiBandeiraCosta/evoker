# Round 4 summary: cards added after April 2016

Five agents searched four kinds of source for the 13 cards released after the final client (1.7.4, April 2016): gameplay
videos (`videos-halloween.md`, `videos-casino.md`), the fan wiki's comments, history and images (`wiki-deep.md`), the
archived flaregames forum (`forum.md`), and social media and other sites (`social-other.md`). The brief is in
`BRIEF.md`. The evidence frames are in `frames/`.

## Verdict per card

| Card | Our implementation | Evidence | Verdict |
|---|---|---|---|
| Siamese Orc | flat `raise_attack` +value to left/right, round 1 | In-game text L3 "by 850", L24 "by 1778" (video 4v5C3dKr8N4, wiki screenshot); forum list "+800 atk for his neighbours in 1st round" | **Confirmed** (high) |
| Raptorial Fungus | flat damage to opposing player every round | In-game text L1 "Does 1500 damage to the opposing player each round" (wiki screenshot, forum topic 36678) | **Confirmed** (high) |
| Werewolf Dwarf | invulnerable in even rounds | French card text "Ne subit aucun dégât lors des rounds pairs" (takes no damage in even rounds); forum "2nd, 4th"; Harpy has the same wording | **Confirmed** (high) |
| Tomb Colossus | no ability | Empty ability panel in a screenshot; forum: "has no ability at all" | **Confirmed** (high) |
| Cursed Stag | Basilisk's buff (`no_damage` front, rounds 1–2) | Forum: Basilisk clone with the same text; a 2018 wiki editor calls it a "2 round dazer" | **Confirmed** (high for the clone, medium for rounds 1–2) |
| Bone Dragon | `resurrect` (full HP) + `increment_attack` +value, once | Video Z0xxEbOBDKs ~8:50: dies at −4318 HP, comes back with 550 HP (full) and 3216 attack (= 100 + 3116), no second revive | **Confirmed** (high) |
| Army of Ghosts | Mountain Yeti's per-stage abilities | Forum: "yeti's ability", one of 5 evolving-ability cards; wiki stage texts | **Confirmed** (medium) |
| Umbral Dragon | kills 2 random cards on either side, except itself | Forum: can hit own cards and even pick already-dead cards ("why does he kill already dead cards?") | Mostly confirmed; open: picks may include dead cards and itself (medium-low) |
| Bouncer | random ally + random foe stunned, rounds 1–2 | Forum: two Bouncers can pick the same targets | Consistent (medium) |
| Goblin Thieves | swaps attack/HP of a random card, round 1 | Pt card text "Troca vida e ataque de uma carta aleatória" (video RGizuAsD8jc 0:42); no timing/side seen | Text confirmed; timing still a guess |
| Wheel of Fortune | 50/50 heal or damage per card | Nothing new | Unverified |
| Dark Mage | −X % attack in round 1 to cards with abilities, both sides, **not itself** | Stats confirmed (L1 1500/2000/15 %, max 20 %); no fight footage; nothing on itself / own cards / order | **Unresolvable** with surviving sources. Medusa precedent (wiki): hits itself too |
| Wizard Apprentice | value = **fail** chance; +25 % own attack on success, −25 % on failure | Value rises with level 6 → 59 %. Forum "gambler" (hooded Legendary on the casino set page = most likely this card): "36 % kill chance at ++" (++ range is 29–39 %) | **Probably wrong.** A failure chance that grows with level is implausible; the number is more likely the chance of a good effect. The exact effect is unknown |

## New facts

- **The 3 missing Dungeon Casino cards** are known only from their art on the set page (round 3, `../round3/frames/cardstats/casino_set_page_2of26.jpg`): a **Rare ogre/troll**, a **Rare waitress with a drinks tray** and a **Heroic tavern-crowd** card. No names, stats or abilities were found anywhere.
- **No new cards after Dungeon Casino (May 2017).** The Dec 2017 Holiday event was a "Santa's Booster" plus a portal re-run; 2018 had only re-runs until the shutdown (22 Aug 2018).
- The "unknown Ultimate (1800/1800, 30 mana, 490)" in video -xw0xifj2vE is **Sentinel**, not a new card.
- The 7 cards on a blanked wiki page "Cards in portal Neutral Monster" (Heras, Dark Dragon, Marui, …; one editor, 2017-09-05) appear in no other source. Treat them as unreliable.

## Bug found

`wizard-apprentice` shows **Cursed Stag art** at every fusion stage (`assets/cards/Wizard_Apprentice+.png` and
`Wizard_Apprentice++.png` are both stag images; mapping in `tools/import-art.js` line 34). The real art is probably the hooded
figure on the casino set page, but no full-size image of it was found.

## Proposed changes (need the user's decision)

1. Wizard Apprentice: reinterpret the percentage as the chance of the good outcome (or of a kill), and fix its art (placeholder or crop from the set-page frame).
2. Dark Mage: decide whether it weakens itself (wiki and Medusa precedent) or not (current design).
3. Umbral Dragon: optionally allow picks to land on dead cards and on itself (forum observation).
4. Optionally add the 3 missing Casino cards as art-only placeholders, or leave them out.

## Still worth trying

- About 18 fukfukara "Random PvP" videos from Feb–Mar 2018: enlarging the frames might show the missing Casino cards or Wizard Apprentice's text in players' decks.
- dQcnOrf1BFI (a Dying Dreams summary video) could not be downloaded because YouTube blocked yt-dlp. A manual pass over Ff-jbLef40M, TCvUZk_3hQ4 and X1dZBH_UyD4 might show a Dark Mage fight.
- archive.today copies of forum topics 38165, 38327 and 41462.
