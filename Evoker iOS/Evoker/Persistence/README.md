# Persistence

The save, its file, the store that every screen changes it through, the export / import of save files and the
debug actions. Port of `Evoker Web/src/ui/store.js`, the save wiring of `src/app.js` (`readSave`, `writeSave`,
`onOpen`, the clock ticks, `window.evoker.debug`) and `src/ui/screens/save-file.js`. The pure parts (the save
model, `SaveCodec`, `StoreHelpers`, `AppFlow.onOpen`) live in `EvokerCore`; this folder is the app-side glue.

| File | What |
|---|---|
| `GameStore.swift` | `@MainActor final class GameStore: ObservableObject` (CONTRACTS.md 4.1): the single save, `update` / `updateState` / `set`, autosave, `load` / `newGame` / `importJSON` / `reset`, `tick` / `flush`, `dailyEvent`, `debug` |
| `FileSaveStore.swift` | `SaveStore` over one JSON file in Application Support (atomic writes, `.bak` of the previous file) |
| `SaveFile.swift` | `save-file.js`: validation of an imported save (same messages), pretty export JSON, `evoker-save-<date>.json` |
| `SaveTransfer.swift` | SwiftUI: `ExportSaveLink` (share sheet), `ImportSaveButton` (Files picker + confirm), `ResetProgressButton` (double confirm), `SaveTransferButtons` |
| `DebugActions.swift` | `store.debug`: giveGold, giveGems, givePotions, giveTokens, setLevel, addCard, maxCards, refill, unlockQuests, unlockAll, addDays, reset, newGame |

## Where the save lives

```
<app sandbox>/Library/Application Support/Evoker/evoker.save.v1.json          the save
<app sandbox>/Library/Application Support/Evoker/evoker.save.v1.json.bak      the save before the last write
<app sandbox>/Library/Application Support/Evoker/evoker.save.v1.corrupt.json  a primary file that failed to load (kept for forensics)
```

The folder is created on the first save. Every write is atomic (`Data.write(options: .atomic)`), after the current
file was copied to `.bak`; a crash mid-write leaves the previous file in place. The folder is part of the normal
iOS backup (nothing excludes it). `FileSaveStore(directory:)` takes another folder for tests and previews;
`MemorySaveStore` (EvokerCore) keeps the save in memory.

The web game kept the same document under `localStorage['evoker.save.v1']`.

## Format

The file is the web's save object (`evoker.save.v1`, `Evoker Web/docs/design/architecture.md` 3.4) encoded with
`SaveCodec.serialize`: compact JSON, keys sorted, `lastSeen` set to the write time. `GameState` (EvokerCore,
`Models/GameState.swift`) uses the web's key names, so:

- an export of the web game loads here unchanged, and
- a file exported here (`Export save`) imports into the web game's Options screen unchanged.

Unknown top-level keys of an imported save survive a round trip (`GameState.extras`).

## Loading and migration

`GameStore.load()` is the web's `readSave()` + `openSave()`:

1. `FileSaveStore.load(now:)` reads the primary file and parses it with `SaveCodec.parse` (a lenient decode that
   fills missing fields with the defaults of `state.js defaultState`, then `StateOps.migrated`, the rest of
   `state.js migrate`: version, audio defaults, deck length, legacy league flags, legacy deck slots, card
   defaults, album seen list, uidCounter). A file that does not parse is copied to `.corrupt.json` and the `.bak`
   is tried; when neither parses there is no save (the title screen asks for a name).
2. `StateOps.pruneRemoved` drops what the data no longer has (cards, portals, sets removed since the save was written).
3. `AppFlow.onOpen` (`app.js onOpen`): stamina / mana regeneration, the daily reward, the settlement of a league
   from an earlier day, the piece raids; its notices (`OnOpenResult.notices`) are what the web showed as login
   toasts. The result is published and saved.

A newer save version than the app knows is refused by the import validation ("The save file is from a newer
version (N)."); the store never downgrades a file.

## The store in the app

- `update { state, deps, now in ... }` applies one pure game function of EvokerCore, saves synchronously on the
  main actor, publishes (`@Published state`) and returns the function's info. A failed save is logged
  (`onSaveError`, default: a console line) and never thrown to the UI. A throwing function leaves the save untouched.
- `onChange(previous, next)` runs after every publish: the app model re-applies the audio settings and plays the
  potion sound on a potion diff (the web's `store.subscribe` listeners).
- `tick()` is the two timers of `app.js`: regeneration (committed only when it changes something) and, on a later
  UTC day, the on-open hooks again (notices to `onNotices`); `today` is published so the quest map, shop, arena
  and league can refresh in place like the web's `NEW_DAY_RERENDER`. Call it from a 60 s timer and on
  `scenePhase == .active`; call `flush()` on `scenePhase == .background` (the web's `visibilitychange` flush).
- `dailyEvent` / `dailyEventId`: the event of the day on the save's clock (`PlayerOps.eventClock`, which adds the
  days skipped with `debug.addDays`), nil while the tutorial runs.
- `newGame(name:)`: `StateOps.newGame` seeded with `Seeds.seedFromNow(now)`, the iOS tutorial record
  (`TutorialRecord.newGame`: quest-based unlocks, name prompt at the first Arena visit), then the open hooks.
- `reset()`: the save and its backup are deleted and `state` becomes nil; the router shows the title screen.

## Export and import (how to copy a web save over)

Web to phone:

1. In the web game: Options (character screen, Settings tab) > **Export save**. The browser downloads
   `evoker-save-YYYY-MM-DD.json`.
2. Put the file where the phone can see it: AirDrop it, mail it to yourself, or drop it in iCloud Drive.
3. On the phone: Settings > **Import save**, pick the file in the Files picker, confirm the summary
   ("Replace your current progress with ... (level N, M cards)?"). The file is validated with the web's checks
   and messages, migrated, pruned and opened like a loaded save.

Phone to web: Settings > **Export save** opens the share sheet with `evoker-save-YYYY-MM-DD.json` (Save to Files,
AirDrop, Mail ...), then Options > **Import save** in the web game. The exported file is the pretty-printed
form of the save (two-space indentation like the web's download; keys sorted).

`GameStore.exportJSON()` returns the compact stored form for code that needs the bytes.

## Debug actions

`store.debug` ports `window.evoker.debug` one to one; every action goes through the store (autosave, publish):
`giveGold(n)`, `giveGems(n)`, `givePotions(stamina:mana:)`, `giveTokens(kind, n, portalId:)`, `setLevel(n)`,
`addCard(cardId, stage:level:)` (returns the uid), `maxCards()`, `refill()`, `unlockQuests(n)`, `unlockAll()`,
`addDays(n)` (moves the save's dates back and the daily event forward, then runs the open hooks), `reset()`,
`newGame(name:)`. They are for a debug menu and UI tests, not for the game's own flows.

## Differences from the web

- The web runs the open hooks on an import only when no save was loaded before (its `hadSave` subscription);
  here `importJSON` always runs them, so an imported save gets its regeneration, daily reward and raids at once.
- The web re-saved every minute from its regeneration timer even when nothing changed; `tick()` saves only when
  the regeneration changed the save.
- The web's reset in the Options screen started a new tutorial game at once; the contract's `reset()` deletes the
  save and lets the title screen ask for a name (the web's `debug.reset` did the same and reloaded).
- Dialogs are system alerts with the web's wording; a screen can rebuild the flow with `SaveTransfer.readImportFile`,
  `SaveFile` and `GameStore.importJSON` for the client's popup look.
