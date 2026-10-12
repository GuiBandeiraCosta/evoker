# exploration/ — research material behind Evoker Web

Everything in this folder was *found*, not written for the game: the original client, what was pulled out of it,
the wiki dump, videos, forum posts, playtest reports and the art recovered or generated for cards whose fusion
stages were lost. The game (`src/`, `css/`, `data/`, `assets/`) never loads anything from here at runtime; only
the data build, a few tests and the dev tools read it.

| Folder | What it is |
| --- | --- |
| `apk/` | The genuine Android client 1.7.4 (`evoker-1.7.4.apk`, signature verified) and the older 1.7.0–1.7.3 builds (`versions/`) - the `.apk` files themselves are not in the repository (git-ignored, kept locally; the repository is public since 2026-10-12) - unpacked: sprite sheets, animations, fonts and sounds (`assets/`), the disassembled Lua modules (`lua/`, the battle simulator is `game.fightsimulatorv2.txt`), the client's data tables (`data/`: colours, image sheets, English strings, and `prepackaged-map.json`, our classification of the 719 cached remote images). `tools/` holds the unpacking scripts. |
| `research/` | What was learnt outside the client: `evoker-research-brief.md` and `web-research-findings.txt` (first survey), `wiki/` (the fan wiki, one text file per page) and `wiki-card-catalog.json` (the card catalog built from it — **the input of `npm run build:data`**), `reference/` (store screenshots and promo art), `round3/` (29 gameplay videos, forum, store pages: decisions, gaps, evidence frames), `round4/` (post-2016 cards, level-data gaps, `art-found/` recovered and `art-generated/` stand-in fusion-stage art — the copies the game uses live in `assets/cards/`, see `art-wired.txt`), `round5/` (the "exactly like the app" playtest reports and the starter sets). |
| `tools/` | One-off pipelines that turned the research into shipped files, kept so the step is reproducible: `extract-sprites.py` (sheets → `assets/orig/ui/`), `make-frames.py` / `make-card-frames.py` (nine-slice frames and rarity card frames), `classify-prepackaged.py` (minion / portrait cut-outs), `build-map.py` (the quest map stitched from 420 tiles), `import-art.js` (wiki card art → `assets/cards/`). Python scripts need Pillow and are run from anywhere (`python exploration/tools/<script>.py`). |

What depends on this folder: `tools/build-cards.js` (the wiki catalog), `tests/abilities.test.js`, `tests/data.test.js`,
`tests/data-wiki.test.js`, `tests/audio.test.js`, `tests/quest-ui.test.js`, `tests/tutorial.test.js` (they re-check the
game's data against the raw sources) and `tools/make-gallery.js` (the reference screenshots).
