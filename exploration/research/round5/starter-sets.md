# Main-line album sets: Dwarven Apprentice, Elven Novice, Orc Grunt, Arborearch (round 5)

Why: the 1.7.0 tutorial video shows "Card added to set: Orc Grunt 0/8 → 1/8" (Throat-Cutter, Q1), "Elven Novice
1/8 → 2/8" (Falconer, Q4), "Arborearch 0/7 → 1/7" (Gremlin, Q7) and later Orc Grunt 2/8 (Worm Shaman), 3/8 (Pouch
Tearer), 4/8 (Bone Breaker) (tutorial-v2.md §1.9, 4.4, 5.6, 6.9, 8.2, 9.6); the 2014 client opens on the album page
"Dwarven Apprentice (1/17)" with Master Brewer (tutorial.md §0). Our data had none of these sets (the main-line cards
only formed the 17-card "Main Quest" page). The set lists came from the server and are in no client file
(`game.setsmanager` only receives them), in no wiki page and in no other report.

Method: every downloaded video was template-scanned for the album page layout; the album pages of two Brazilian
accounts with complete sets on the final "/26" client were found (WzDCvHuf8FE, hJoyeys0cnI, Evoker Br). Each card
slot was matched against our card art (`assets/cards/<Name>.jpg`, normalised correlation; a script in the session
scratchpad) and the rarity frame colours were checked (green = Uncommon, blue = Rare, purple = Heroic, gold =
Legendary). The 2014 Dwarven Apprentice page (grey silhouettes) was matched the same way and gives the same 8 cards.

| Page (/26) | Set | Reward | Cards in page order (match score) | Frame |
|---|---|---|---|---|
| 10 | Dwarven Apprentice | 50 gems | Pikeman .71, Master Brewer .81, Iron Breaker .75, Blunderbuss Gunner .80, Lance Stabber .81, Korim Stoneskull .77, Axe Whirler .81, Pyromancer .74 (2014 silhouettes: .67 / .77 / .75 / .74 / .74 / .60 / .81 / .70) | `frames/sets/dwarven_apprentice_10of26.jpg` (WzDCvHuf8FE @ 1:14.5), `frames/sets/dwarven_apprentice_2014_1of17.jpg` (NbX8RxYbN7k @ 0:00) |
| 11 | Elven Novice | 50 gems | Envoy .81, Keeper .74, Falconer .46 (owl art, visibly Falconer), Scout .85, Archer .76, Meadow Guard .81, Hunter .67, Tree of Life .85 | `frames/sets/elven_novice_11of26.jpg` (WzDCvHuf8FE @ 1:15.5) |
| 12 | Orc Grunt | 50 gems | Pouch Tearer .69, Throat Cutter .75, Lurking Goblin .39 (weak; the only orc Standard left), Bone Breaker .53, Worm Shaman .70, Flinger .66, Blood Spitter .59, Tribe Avenger .65 | `frames/sets/orc_grunt_12of26.jpg` (WzDCvHuf8FE @ 1:16.5) |
| 22 | Arborearch | 3,500 gems | Gremlin .82, Will-o'-the-Wisp .83, Ogre .75, Giant Lizard .73, Giant .76, Giant Spider .79, Griffin .72 | `frames/sets/arborearch_22of26.jpg` (hJoyeys0cnI @ 1:39.3) |

The three tribe starter sets are the tribe's Common + five Standards + two 6-mana Uncommons (Club Swinger is not in
Orc Grunt, which agrees with the tutorial: completing it before Q9 did not move the Orc Grunt counter). Arborearch is
all neutral with one card per rarity step. Every count of the tutorial video is reproduced by these lists.

Other pages of the /26 client (name, reward): 1 Dawn of Eternity 5600, 2 Dungeon Casino 5000, 3 Dread Empress 4500,
4 The Dark Beyond 4600, 5 Desert Twilight 4000, 6 Dwarven Rage 4000, 7 Dragon Hunt 5000, 8 Divine Peace 4000,
9 Dying Dreams 5300, 10-12 above, 13 Artificer 50 (4 cards), 14 Dwarven Journeyman 150, 15 Elven Initiate 150,
16 Orc Overseer 150, 17 Despoiler 300 (6), 18 Dwarven Master 1250, 19 Elven Magus 1250, 20 Orc War Leader 1250,
21 Elemental Adept 2500 (6), 22 Arborearch, 23 Dragon Lord 4500 (7), 24 Dwarven Greybeard 5500 (6), 25 Elven Archmage
5500 (6), 26 Orc High Chief 5500 (6). Their card lists were not matched (to do: the same frames show pages 13-21 and
23-26 complete, so they can be matched the same way; the 1.7.0 builds number the pages /21-/22 in another order).

Implemented: `SETS` entries with `album: true` and the page order (constants.js), the membership in
`data/card-overrides.json` (`sets: ["main", "<set>"]`, rebuilt into data/cards.json), album pages after the portals
(shop.albumSets / setCollections), the "Card added to set" plate for these cards, the album "!" badge
(shop.albumNewCards, `state.collections.seen`).
