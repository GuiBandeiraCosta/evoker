# Backgrounds

Cropped from the original game's screenshots (see `docs/research/reference/`). All are JPEG.

| File | Size | Use |
|---|---|---|
| `title.jpg` | 1536×1760 | Title screen key art (red dragon over the hooded Evoker); place the logo over the lower third. |
| `quest-valley.jpg` | 1536×1240 | Quest screen landscape (green valley, mountains). Also fine for the Character / Shop screens behind panels. |
| `boss-valley.jpg` | 1536×1540 | Boss-fight intro backdrop (valley with the golden rune circle already painted in). |
| `map-coast.jpg` | 1536×1600 | Quest map (coast, forest, mountains). Contains the original portal banner at the top and the ranger guide at the bottom-left; crop/cover so that the map area shows, or draw UI over it. |
| `horizon-valley.jpg` | 1536×245 | Battle horizon strip: green valley with a castle. |
| `horizon-swamp.jpg` | 1536×225 | Battle horizon strip: misty swamp. |
| `horizon-sunset.jpg` | 1536×225 | Battle horizon strip: sunset ruins (arena / PvP). |

## Building a battle backdrop in CSS

The original battle screen is: sky at the top, a painted horizon in the middle (between the two card rows), ground at the bottom.
Use a horizon strip at roughly 42–58 % of the stage height (`background-size: 100% auto`, `background-position: center 50%`,
`background-repeat: no-repeat`) over a two-stop gradient sky and a ground gradient. Sampled colours from the originals:

| Theme | sky top | sky low | ground |
|---|---|---|---|
| valley (quests) | `#354353` | `#396648` | `#193917` |
| sunset (arena, league, pieces) | `#c65326` | `#9a6026` | `#7d3219` |
| swamp (portal quests) | `#584a3a` | `#436130` | `#2a3e14` |
| lava (boss fights ≥ Q31, gradient only, no strip) | `#3d2315` | `#5a2a12` | `#c1922e` |

Example:

```css
.battle-bg.sunset {
  background:
    url(../assets/bg/horizon-sunset.jpg) center 50% / 100% auto no-repeat,
    linear-gradient(#c65326 0%, #9a6026 50%, #7d3219 52%, #3a1a0c 100%);
}
```

`assets/ui/guide-ranger.jpg` (440×710) is the tutorial guide portrait; `assets/ui/potion-stamina.jpg` the orange stamina potion
(use a CSS `hue-rotate(190deg)` filter for the blue mana potion).
