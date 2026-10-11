# Round 3: other client versions and server data (topic `clients`)

Researched 2026-10-08. Machine-readable summary: `exploration/research/round3/clients.json`. The new APKs are in
`exploration/apk/versions/<version>/`. Disassemblies and download logs are in the scratchpad (`work/clients/`), not in the project.

## TL;DR

1. **No newer client exists. 1.7.4 was the last build on both platforms.** Android 1.7.4 was released on 2016-04-21 and was
   still "Current Version" on the Play Store snapshot of 2018-03-14. iOS 1.7.4 was released on 2016-04-26 (71.8 MB) and
   was still current on 2017-05-18. Everything added in 2016–2018 (Dungeon Casino cards, events, portals) came from
   the server: metadata, remote images on `evokergeo.trackingflaregames.net`, and server-pushed "LOA" popup layouts.
2. **I obtained and verified four more Android builds: 1.7.0, 1.7.1, 1.7.2 and 1.7.3.** All have the same flaregames
   certificate as 1.7.4, and all v1 digests and signatures verify. Their **game assets are byte-identical to 1.7.4.** The Lua
   differs only in SDK wiring (Vungle, Helpshift→Zendesk), `appversion`, and a War Cards toggle in 1.7.0. There are
   **no new screens, buff types, sprites, sounds or strings.**
3. **Older builds (1.3.0–1.6.3, 2014–early 2015) are listed on Uptodown, but I could not download them.** The download
   button is gated by Cloudflare Turnstile, which fails in a headless or automated browser. A human can fetch them in a
   normal browser (URLs below). They are the only versions that could still hold different client logic.
4. **I recovered no server data, and there almost certainly is none to recover from the web archive.** Every API call,
   including the metadata `model/` call, is a session-bound **POST** to `http://evoker.trackingflaregames.net/`. The
   Wayback Machine has only a 404 root page for that host and nothing for the asset CDN `evokergeo`. GitHub, pastebins and
   archive.org have no dumps, private servers or traffic captures. No IPA is archived.
5. **New engine-relevant fact: live fights were simulated on the server.** The client's battle screen plays a server-sent
   "visualization" script (`sound / animation / card / text / attribChange` instructions plus `finalState`). It does not
   run `fightsimulatorv2`. So post-2016 card mechanics needed no client update, and the 18 buff types in the client
   simulator are not guaranteed to be the full set the live server used in 2017–18.

## 1. Discrepancies with our recreation

| # | Finding | Original | Ours | Confidence |
|---|---|---|---|---|
| 1 | Who simulates fights | Server-side. Quest, boss and PvP screens receive `visualizationData.visualization` and `finalState` and only animate them (`ui.components.comp_fight_v3`: instruction types `sound`, `animation`, `card`, `text`, `attribChange`; "Unknown instruction type:"). The local `game.fightsimulatorv2` is reached only through `game.fightsimulatormanager` (`getByVersion`) for replays and tests. | `docs/design/original-engine.md` treats the client simulator as the complete live rule set. | High that fights were server-side. Medium on the consequence: the 2017–18 server may have had extra buff types or rule tweaks that never reached any client. The 1.7.4 simulator is still the best available evidence. |
| 2 | Fallback "locked feature" text | `server.metadatamanager.getLockedFeatureMessages` falls back to title "Please be patient" and text **"You can access the Leagues after you reached level 10"** when the metadata has no entry. | League unlocks at level 5. | Low. Gameplay videos from other round-3 agents show the League at level 5–6, so this is probably a stale default from an earlier design. Do not change on this evidence alone. |
| 3 | Monetised gem packs (only matters if a cosmetic shop is wanted) | iOS "Top In-App Purchases" in 2017: Apprentice's Bundle $4.99 (also $2.99), Wanderer's Purse $9.99 (also $4.99), Hero's Wallet $24.99, Evoker's Treasure $49.99 (also $24.99), Master's Vault $99.99 (also $44.99), Event Package $9.99. Android listed "In-app Products $2.99 – $122.35 per item". The product list and amounts came from the server (`shopItems`, `getshopinfo/`), not the APK. | No real-money shop (offline game). | High for names and prices. Gem amounts are unknown. |

The developer test-card set in `unittests.tests.testcards` (40 cards with German dev names) and the 64 golden fight
tests in `unittests.tests.testfightsimulatorsimplev2` are already in `tests/fixtures/original-cards.json` and
`original-tests.json`, so they are not new. I checked them against our cards anyway. Commons and uncommons match our
level-1 stats exactly (Pikeman, Raven Shaman, Worm Shaman, Keeper, Korim Stoneskull, Cave Dragon, Unicorn, Blood Spitter, Cave
Troll, Minor Demon, Homunculus, Catapult). Higher rarities in the test set are about 1/1.2 (rare), 1/1.5 (heroic) and 1/2
(legendary) of our values. Example: Griffin is 800/1400 in the test set and 1600/2800 in ours. That fits a prototype set
before rarity scaling, not live data. A few early values differ: Stone Golem hp 400 vs our 300, Tree of Life hp 600 vs
700, Basilisk hp 400 vs 500, Tribe Avenger atk 300 vs 200, Bone Collector atk 200 vs 300, Rat Eater 400/600 vs 720/480.
The test cards with no counterpart in our 200-card list are dev names: kobold, botin, kaiserdrache (Emperor Dragon) and
goldsucher. Our wiki-sourced values should stay.

## 2. Client versions: what exists, what I got

The signing certificate is the same for every version below. Subject: `C=DE, ST=Baden-Württemberg, L=Karlsruhe,
O=flaregames GmbH, CN=Klaas Kersting`, valid 2013-05-06 → 2040-09-21, SHA-256 fingerprint
`A7:7B:38:87:9C:B0:6A:F9:68:B4:65:43:4D:77:EB:24:B4:FA:88:5C:3A:D7:81:F7:D7:68:9E:C7:68:98:1B:EC`. For each APK, all
MANIFEST digests, the CERT.SF manifest digest, and the PKCS#7 signature over CERT.SF verify (`apk_verify_digests.py` plus
`openssl smime -verify`).

| Version | versionCode | Released (store) | Size (bytes) | SHA-256 | Source | Status |
|---|---|---|---|---|---|---|
| 1.7.0 | 48 | 2015-03-19 | 47,312,911 | `3f782c1cf1f4059f494c50809dde29ced8bec4dd69164e71270b379c0ca28f81` | APKPure API → data.winudf.com (SHA-1 matches APKPure's listing) | **Downloaded**, verified |
| 1.7.1 | 49 | 2015-07-21 | 47,082,570 | `d46fd14761318370619af6f9c06fae7f3ab4609b066e6cb0c92ce5def2011079` | APKPure | **Downloaded**, verified |
| 1.7.2 | 50 | 2015-09-29 | 47,097,965 | `30551187db3bf6437caefc13d1f566ba2fdc20f4b99d93a678123b402548b925` | APKPure | **Downloaded**, verified |
| 1.7.3 | 51 | 2015-11-02 | 47,171,895 | `5276d30c02837ba9b3e7c96064676fbc70a1d7ecc24761f7cfbeb295a154d3d2` | APKPure | **Downloaded**, verified |
| 1.7.4 | 52 | 2016-04-21 | 46,580,839 | `2e10595363ffcf7899217781aee8449b9080039b754daf6538bbc96040b6d60f` | already in project; SHA-1 `db84253e…` matches APKPure | final version |
| 1.6.3 | ? | Uptodown 2015-02-12 | ? | ? | [Uptodown file 103641](https://evoker-magic-card-game.en.uptodown.com/android/download/103641) | Turnstile-gated, not downloaded |
| 1.6.2 | ? | 2015-02-05 | ? | ? | [Uptodown 102321](https://evoker-magic-card-game.en.uptodown.com/android/download/102321) | same |
| 1.6.1 | ? | 2015-02-05 | ? | ? | [Uptodown 102223](https://evoker-magic-card-game.en.uptodown.com/android/download/102223) | same |
| 1.6.0 | ? | 2015-02-02 (iOS 1.6.0: 2015-01-29, "Now in Japanese, Korean, Brazilian Portuguese and Traditional Chinese") | ? | ? | [Uptodown 101499](https://evoker-magic-card-game.en.uptodown.com/android/download/101499) | same |
| 1.5.0 | ? | 2014-11-29 | ? | ? | [Uptodown 91149](https://evoker-magic-card-game.en.uptodown.com/android/download/91149) | same |
| 1.4.1 | ? | 2014-11-27 | ? | ? | [Uptodown 90803](https://evoker-magic-card-game.en.uptodown.com/android/download/90803) | same |
| 1.3.0 | ? | 2014-09-24 | ? | ? | [Uptodown 79261](https://evoker-magic-card-game.en.uptodown.com/android/download/79261) | same |
| 1.1.6 | ? | 2014-02-21 ("New Tournaments / Daily Events / Localized Game-Content") | 42M | – | Play Store Wayback snapshot only | not available anywhere |

The Uptodown dates are upload dates, not release dates. Each Uptodown download needs a Cloudflare Turnstile token,
posted to `/ajax/app/29823/file/<id>/download-url`. Headless and off-screen automated Edge never got a token. The 2018
direct `dw.uptodown.com/dwn/…` links in the Wayback captures are dead (404) and were not archived. **To get them, open the
links above in a normal browser and click Download. Then verify with `apk_verify_digests.py` and the fingerprint above.**

Sites with nothing more:

- APKPure has only 1.7.0–1.7.4, all obtained.
- APK4Fun has only 1.7.4.
- APKMirror has no Evoker page.
- Aptoide returns "not found".
- APKCombo, apkmonk and apk.support were unreachable from this machine (timeout or DNS).
- APKFab, APKGK and androidapksfree return Cloudflare 403.
- archive.org has no Evoker APK or IPA item (subagent search: evoker, craftedevil, flaregames, 637436624).

## 3. Diff of 1.7.0–1.7.3 against 1.7.4

- **Assets**: every file under `assets/` is CRC-identical to 1.7.4, apart from these:
  - App icons.
  - `resource.car` (the Lua).
  - Six Vungle ad images (`assets/vg_*.png`), present only in 1.7.0.

  The older APKs also carry Helpshift (`res/*/hs__*`) and Heyzap (`hz_*`) SDK resources. There are **no new or different
  sprites, card art, sounds, fonts, animations, prepackaged images or loca strings.**
- **Lua** (943–945 modules, disassembled with `lua51dump.py`; I renamed the chunks from the `.car` directory: format
  `rac\x01`, then entries of `u32 type, u32 offset, u32 namelen, name padded to 4`):
  - 1.7.0 → 1.7.1:
    - `fglib.native.vungle` removed.
    - `appversion` changed.
    - In 1.7.0 the `appversion` module still holds a **War Cards switch** (`require "warcards"`):
      - name "War Cards", `com.flaregames.warcards`, iOS 798663996.
      - server `http://wc-us-vir-1.flarecloud.net/`.
      - The same codebase served flaregames' sister CCG. That is why `prepackaged_warcards.json` exists.
  - 1.7.1 → 1.7.2 → 1.7.3: only the version number changed.
  - 1.7.3 → 1.7.4:
    - `fglib.native.helpshift` removed. The help button now opens `https://flaregames.zendesk.com/hc/categories/201072902-Evoker` instead of `http://flaregames.helpshift.com/a/evoker/`.
    - Receipt `verify` call dropped in `fglib.appstore.purchasemanager`.
    - Matching edits in `statusbar_comp`, `ctrl_playerinfo` and `static_init`.
  - `minimalServerVersion` = 56 in all five versions.
  - `fightsimulatorv2`, every UI screen and layout, `metadatamanager`, the tutorial and the quest code are byte-identical in
    the disassembly.
- **Nothing bundled that 1.7.4 lacks.** No version ships metadata, cached JSON, default card tables or offline
  fallbacks. The metadata is downloaded and stored as `DocumentsDirectory/metadata.json`. A user's device backup from
  2016–18 would hold it, but no APK does.

## 4. Server: hosts, API, metadata schema

- Game server (release): `http://evoker.trackingflaregames.net/`.
  - Staging: `ev-staging-{2,3,4,rc,nightly,live-test}-*.us-east-1.elb.amazonaws.com`, `staging1.flaregames.net:8090`.
  - Others: auth `fgauth.trackingflaregames.net`, `leaderboard.trackingflaregames.net/leaderboard/`, `receipt.trackingflaregames.net/voucher`, tracking `tracking.trackingflaregames.net/event/1/mlog`.
  - The DNS names still resolve to an empty CNAME and do not answer.
- Remote assets: `remoteAsset://evokergeo.trackingflaregames.net/<md5>.png?w=..&h=..`, fetched over plain HTTP and cached for
  86,400 s. The project's `prepackaged/` hashes are these md5 names.
- **Request format** (`server.server`, function at lines 1269–1302):
  - `POST <server_url><action>`, form-encoded body of the parameters plus `v` (client version), `sessionid`, `locale`, and an increasing `sequence`.
  - JSON responses.
  - Requests made while logged out are queued as `{action, parameters}`.
- Endpoints (all POST):
  - Account and user: `model/` (metadata), `user/`, `user/me/{deck/,decks/,cards/,inventory/,levelup2/,checklevelup/,setTutorial,setName,getshopinfo/,validatereceipt/,loaAck/,dices,…}`.
  - Content: `quest/`, `quest2/` (+`/fight`, `/getBoss`, `/getReward`, `status/`), `quest3/`, `pvp/enemies/`, `pvp/history/`, `pvp/replay/`, `pvp2/`, `league/`, `sets/`, `loa/`.
  - Shop: `booster/`, `booster2/` (+`/drawStatic`), `booster3/`, `shop/`, `shop2/`, `clientstore/`.
  - Cards: `cards/buyCardPiece`, `cards2/fuse`, `cards3/enhance`.
  - Other: `fight/simulate` (debug), `facebook/*`, cheat endpoints `user/me/cheat*`.
  - The full list is in `clients.json`.
- **Metadata (`model/`) top-level keys** read by `server.metadatamanager`:
  - Content: `card_templates` (ids are 24-hex Mongo ObjectIds, e.g. `518a6a221b19f94202000072`), `questEnemySets`, `animations`, `tutorialImages`, `boosterPacks`, `widgetHelp`, `tutorial`, `tutorialv3`, `lockedFeatureMessages`.
  - Economy and progression: `shopItems[{itemType,cost,amount,price}]`, `cardLevelData`, `cardMaxLevels`, `rarities`, `playerDefaults.levelBeforeStamina` (default 0), `enhance2Config`, `sell2Config`, `version`.
  - Fight and card pieces: `fightConfig.rematchCost` (default 0), `fightConfig.version` (default 1), `cardPieceConfig.randomCardPieceCosts` (default 0), `cardPieceConfig.maxCardPieceCount` (default 4).
  - The client discards cached metadata when the server, locale or game (Evoker or War Cards) changes, and ignores updates with a smaller `version`.
- Related platform hint, not verified: the sibling game Throne Wars used `http://{server}.trackingflaregames.net/lmodel/ios/301/315/en/en/` (github.com/joshstrange/node-thronewars). Evoker's `model/` is a POST with a session, so it cannot be fetched without the server either way.

## 5. Archives and code search: what was looked for and not found

- **Wayback CDX**:
  - `evoker.trackingflaregames.net/*`: only `/` and `/robots.txt`, both 404 (2017-06-02).
  - Nothing at all for `evokergeo.trackingflaregames.net`, the staging ELB hosts, `staging1.flaregames.net` or `leaderboard.*`.
  - `fgauth.*`: 404 only.
  - The `*.trackingflaregames.net` domain search shows only these and Royal Revolt 2's admin pages.
  - `flarecloud.net` holds other flaregames games (Nonstop Knight, Olympus Rising), not Evoker.
  - Because every Evoker call is a session POST, archives could not have captured metadata.
- **GitHub, GitLab, pastebin and forums** (subagent, via `gh search code` and web search) found no dump, private server, bot
  or mitm capture:
  - Queries: `craftedevil`, `trackingflaregames`, `evokergeo`, the template-id prefix `518a6a221b19f942020000`, `flaregames evoker` plus json, metadata, dump, bot or cheat.
  - `craftedevil` appears only in package lists, and XPrivacy crowd data mentions version 1.1.7.
  - `trackingflaregames` appears only in ad/tracker blocklists.
  - Mod-APK and cheat sites have nothing.
- **iOS IPA**: none on archive.org and none found elsewhere (decrypt.day, armconverter and ipaarchive were not checked directly). Store snapshots give the iOS history: 1.6.0 (2015-01-29, 50.7 MB) and 1.7.4 (2016-04-26, 71.8 MB, last).
- **Data still only from the fan wiki**: per-level stat tables (e.g. Rune Smith L1 200/500/100 → L11 360/903/180) come from evoker.fandom.com card pages. The wiki API works with a browser User-Agent: `api.php?action=parse&page=<Name>&prop=wikitext`.

## 6. Recommendations

1. Getting 1.3.0–1.6.3 needs one manual browser download each from Uptodown. They predate leagues and card pieces, so they would show an earlier tutorial and fight simulator (v1 versus v2). That is useful for history, but less so for the 2016 target.
2. Note in `original-engine.md` that the live game simulated fights on the server and that the client simulator is the 2016
   reference. Cards added later may rely on server-only behaviour, and we have to reconstruct that from wiki text either way.
3. No further client mining is worthwhile for the 2017–18 content. It never shipped in any client.
