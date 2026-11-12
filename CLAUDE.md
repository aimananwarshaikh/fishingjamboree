# CLAUDE.md — Fishing Jamboree

## What this is

A digital version of the Fishing Jamboree board game. The target is an online game 3–4 players can playtest in a browser (desktop and mobile).

## Read first

- `docs/rulebook.md`: the rules. Single source of truth (the repo wins over any other copy).
- `docs/rulebook-engine-notes.md`: rule clarifications made during the build.
- `docs/build-plan.md`: sessions, stages and which model does what.
- `docs/architecture.md`: engine contract and structure (from Session 1).
- `docs/protocol.md`: online protocol (from Session 5).
- `docs/session-1b-kickoff.md`: decisions so far and the brief for stage 1b (read this at the start of Session 1b).

## Non-negotiables

- `packages/engine` is pure and deterministic: no I/O, no `Math.random`, no `Date`. All randomness comes from the seeded RNG stored in the state. State is plain JSON.
- Game content (board, cards, counts, prices) lives in `content/*.json`, never hard-coded.
- The server is authoritative. Clients send intents, and the server validates them with the engine.
- Every rule gets a test before or with its implementation. A rule the rulebook doesn't cover is decided, tested, and logged in `docs/rulebook-engine-notes.md`.
- Stay inside the current stage's scope from `docs/build-plan.md`. Note anything else under Status → Next.
- Before finishing a stage: run lint, typecheck and tests, commit, and update Status below.

## Commands

- `pnpm install`
- `pnpm test` (Vitest, all packages); `pnpm test:watch`
- `pnpm typecheck` (`tsc -b`); `pnpm lint`; `pnpm format`
- `pnpm check`: typecheck + lint + test. Run before every commit.
- `pnpm dev:web`, `pnpm dev:server`

## Layout

- `packages/engine`: pure rules (lint bans `Math.random`/`Date`/`process`/`console` here)
- `packages/server`: Node WebSocket server (`ws`), server-authoritative rooms
- `packages/sim`: bots and balancing simulator (Milestone B)
- `apps/web`: React + Vite client
- `content/`: board, cards, counts, prices (JSON)
- `assets/`: board image (`assets/board/board.webp`) and art (`assets/art/`)

## Status

- Current milestone: A (due 17 Nov 2026, 7pm AEDT)
- Last completed stage: Session 4, stage 4c [SONNET] (fuzz test: 1,000 seeded random-bot games; PR #9, merged). Before it: 4b [OPUS] (Tsunami, end of game, `redactForClient`, `replay`; a full 20-round game runs in code with a scored result). Before it: 4a [FABLE] (PR #7), Session 3 (3a in PR #5, 3b in PR #6) and Session 2 (PR #3).
  - 4c: `fuzz.test.ts`. 1,000 games (2/3/4 players by seed `fuzz-N`), bot picks uniformly from `getLegalActions` on the redacted view using `seedRng`/`randomInt`. After every action: `invariantProblems`, legality equal on state and view, 20,000-action stuck guard. At the end: round 20, `gameOver`, winners = best total. Every 50th game also checks `replay` reproduces the final state and `applyAction` rejects illegal actions (another seat's, wrong phase). Failures name seed, player count and action number. The full run takes about 10 s, so it is the default (no env var: lint bans `process` in the engine). No engine bugs found; engine code and `types.ts` unchanged.
  - 4b: Tsunami in `eventCards.ts` (Risk discard + draw pile shuffled together). End of game in `apply.ts` (`endGame`) with `scoreGame` in `economy.ts`. `view.ts` (`redactForClient`) and `replay.ts` are real; `notImplemented.ts` is gone. No change to `types.ts`. New tests: `cardTable.test.ts` (one row per card id in `content/cards.json`; a new card fails until it has a row), `fullGame.test.ts` (greedy policy plays whole 2/3/4-player games; scores, winners, ties, cash rebuilt from events, pinned outcomes per seed; seed `full-a` is a shared win), `view.test.ts` (redaction; `getLegalActions` equal on views in `dockShop`, `turnEnd`, Sinking Boat `placeShip` and every state of a whole game), `replay.test.ts`. Two rule notes added (Tsunami shuffle, end-of-game order).
  - 4a: design in `docs/architecture.md` §4 "Effects and modifiers". New: `modifiers.ts` (everything an event or upgrade changes, derived from `activeEvent`), `economy.ts` (fish, fines, sales), `cards.ts` (draw pipeline and handlers by effect kind), `dock.ts` (docking, shop, Sinking Boat relocation), `eventCards.ts` (expiry and draw after rounds 5/10/15, Golden Fish placement), `ctx.ts`. `landing.ts`, `legal.ts` and `apply.ts` now cover all six actions and the `dockShop` and `turnEnd` phases. Tests: `modifiers`, `economy`, `cards`, `dock`, `helicopter`, `eventCards`, `smoke` (`*.test.ts`); new helpers in `testHelpers.ts` (`land`, `withTopCard`, `withPlayer`, `withActiveEvent`, `invariantProblems`).
  - 3b: `movement.table.test.ts` checks `reachableDestinations` against the brute-force `oracle` (moved into `testHelpers.ts` with `isDock`) for every tile a ship can stand on, steps 1–9, with no ships and 5 fixed sets of 1–3 ships. Performance check: whole-board sweep at 9 steps (6 + 2 + 1) under a generous 10 s limit (it takes well under 1 s). No movement bugs found; `movement.ts` unchanged.
  - 3a: `movement.ts` (`reachableDestinations`: layered search over tile + previous tile), real `getActors`, `getLegalActions` and `applyAction` for `placeShip` (setup, late entry), `roll`, `move`, and the turn/round advance. Tests in `movement.test.ts` and `apply.test.ts` on the real board, helpers in `testHelpers.ts`. `landing.ts` (`resolveLanding`) is the Session 4 seam and does nothing yet.
  - Rule change (designer, 2026-11-12): docking does not need the exact roll; a roll of at least the distance reaches a free dock. Rulebook, architecture §4 and §12 item 15, and the notes log are updated.
  - 2a: `content/board.json` (8×20) traced from `assets/board/board.webp`, zones from `board-zones.jpg`. `pnpm board:render` (needs Playwright; `NODE_PATH="$(npm root -g)"` if it is installed globally) draws it over the art as `assets/board/board-overlay.jpg`.
  - 2b: `content/cards.json` and `content/rules.json` replace `card-counts.json`. Implemented `compileContent` (`content.ts`), seeded RNG (`rng.ts`: cyrb128 + sfc32, rejection-sampled die, Fisher–Yates), content hash (`hash.ts`), decks (`decks.ts`: build, draw, discard, reshuffle when empty), `createGame` with the roll-off (`setup.ts`). Tests use the real content via `src/testContent.ts`. The engine tsconfig's `rootDir` is now the repo root so tests can import `content/*.json`.
- Next stage: Session 5 (online protocol, `docs/protocol.md`; see `docs/build-plan.md`).
- All rule questions in `docs/architecture.md` section 12 are decided (2026-11-11), logged in `docs/rulebook-engine-notes.md` and written into `docs/rulebook.md`.
- Known issues: none.
- Card counts confirmed (now in `content/cards.json`). Risk deck is 16 cards including 2 Boots (confirmed 2026-11-12); rulebook card tables show the counts. Upgrade price $200 default, test $300 in simulation.
- `assets/board/board-zones.jpg` only defines the zones (teal=1, light blue=2, dark blue=3); all other tiles come from the original `board.webp`. Golden Fish cards are per fishing spot (independent of zones). Open: final zone names.
- Art is in `assets/art/` (see its README); board image in `assets/board/`.
- Board art updated 2026-11-12 (designer's `Left_dock.pdf`, same squares; `board.json` unchanged). Its zone labels all read "SAFE ZONE 3" (placeholder).
- Round display (decided 2026-11-12, for the web client: Session 6a's bare client can show the round number; the full version is Milestone B2): the digital board hides the printed 20-space round track. Instead show a banner when each round starts ("Round 6 of 20") and a small always-visible "Round N/20" display with a slim progress bar marking the three event points (after rounds 5, 10, 15). The engine's `roundStarted` and `eventDrawn` events are enough; no engine change. Pending from the designer: a PNG export of the board with the round-track layer hidden, ideally at 2× (2756×3938); until then the web client can crop or cover the left-hand track strip.
- `docs/rulebook.md` is the single source of truth for the rules. The claude.ai rulebook doc is a copy and may be out of date; the repo wins.
