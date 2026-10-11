# Generated fusion-stage artwork

These are stand-in images for the fusion stages (+ to ++++) that no original image could be found for. They are
**not wired into the game**: `data/cards.json` and `assets/cards/` are unchanged. Real images recovered from the fan wiki are
in `../art-found/`. Use those in preference to these.

Files: `<card-id>/p1.jpg` … `p4.jpg` (p1 = +). Three cards also have `base_cropped.jpg`: Bouncer, Raptorial Fungus and
Siamese Orc. In `assets/cards` their base art is a whole phone screenshot, and this file is the card cut out of it.
`generated.txt` lists what was made per card.

## How the original stage art works (measured on the 158 cards with all five original images)

| Stage | Orientation | Colour | Effects |
|---|---|---|---|
| + | mirrored (157/158 cards) | brighter, warmer, more saturated | soft glow |
| ++ | original (157/158) | stronger | sparkle field, embers |
| +++ | mirrored (156/158) | stronger again | denser sparkles, light streaks |
| ++++ | original (156/158) | strongest, golden | golden magic circle (pentagram or rune circles), sparkles, glow |

There is no zoom or rotation: the fitted scale is 1.000 and the angle 0°. The baked-in rarity frame stays unchanged.
Average colour change from the base (Lab L / b, HSV saturation on a 0–255 scale): + ≈ +13 / +9 / +27, ++ ≈ +24 / +10 / +27,
+++ ≈ +33 / +16 / +33, ++++ ≈ +38 / +18 / +31.
The circle's design and position change from card to card. Some groups of cards share the same sparkle field.

## How these were made (`tool/gen_fusion_art.py`)

1. Mirror for + and +++.
2. Colour grade per stage (gamma, warm shift in Lab, saturation gain). `tool/fit_grade.py` fitted it to the
   real stages.
3. Warm glow over the highlights.
4. A sparkle field (++ to ++++) taken from real stage art (the median of the card groups that share it,
   `hpt_s*.npy`), randomly shifted per card.
5. On ++++, the golden magic circle cut from the real Ogre++++ (`sprite_circle.png`), at a size, rotation and position
   seeded per card.
6. The original frame pasted back.

`tool/validation.jpg` compares real stages (upper row of each pair) with what the generator makes from the same base
(lower row). The generated versions are close but plainer: they lack the card-specific extras such as embers, lightning
and coloured tints.

## Limitations

- Werewolf Dwarf: our base is a 100×100 icon, so ++ to ++++ were built from the wiki's + image (`../art-found`).
  That image is a frameless crop with a different aspect ratio.
- Harpy, Minotaur, Flameling and Goblin Mob: the found stages are frameless crops, while the generated stages keep the
  frame. Mixing the two within one card looks inconsistent.
- Siamese Orc and Raptorial Fungus are generated from the card cut out of a screenshot, so they are lower resolution than the others.
