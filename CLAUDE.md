# Evoker — working notes for Claude (repository root)

Two projects live side by side in this repository:

- **`Evoker Web/`** — the finished web recreation of Evoker (flaregames' mobile CCG, 2013–2018). It is the
  **reference implementation**: the battle engine is a literal port of the original client's Lua simulator, every
  rule and number is documented in `Evoker Web/docs/design/`. Its own `Evoker Web/CLAUDE.md` applies to any work
  inside that folder (run `npm start` / `npm test` from inside `Evoker Web/`). Do not change its behaviour to suit
  the iOS port; the port follows it.
- **`Evoker iOS/`** — the iPhone app. What ships is the **EvokerWeb** target: the web game bundled unchanged in a
  native shell (WKWebView + a custom-scheme file handler, `Evoker iOS/EvokerWeb/`), so web fixes reach the phone with the next
  build. The native rewrite (target "Evoker"; SwiftUI menus, SpriteKit battles) stays as work in progress.
  Structure, build steps and conventions: `Evoker iOS/README.md`; the native architecture plan:
  `Evoker iOS/docs/PLAN.md`.

Rules of the house that apply to both: faithfulness to the original beats taste; game logic is pure and
deterministic (seeded RNG, injected clock); every reported bug gets a regression test; keep tests green.
