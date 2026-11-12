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
- Last completed stage: Session 2 (2a, 2b [OPUS]; 2c folded in: `pnpm check` clean, CI added in `.github/workflows/ci.yml`). Merged in PR #3.
  - 2a: `content/board.json` (8×20) traced from `assets/board/board.webp`, zones from `board-zones.jpg`. `pnpm board:render` (needs Playwright; `NODE_PATH="$(npm root -g)"` if it is installed globally) draws it over the art as `assets/board/board-overlay.jpg`. Check that image and correct `board.json` if needed.
  - 2b: `content/cards.json` and `content/rules.json` replace `card-counts.json`. Implemented `compileContent` (`content.ts`), seeded RNG (`rng.ts`: cyrb128 + sfc32, rejection-sampled die, Fisher–Yates), content hash (`hash.ts`), decks (`decks.ts`: build, draw, discard, reshuffle when empty), `createGame` with the roll-off (`setup.ts`). Tests use the real content via `src/testContent.ts`. The engine tsconfig's `rootDir` is now the repo root so tests can import `content/*.json`.
- Next stage: Session 3 [FABLE] (movement), in plan mode with the 3a prompt from `docs/build-plan.md`. Before it, the designer checks `assets/board/board-overlay.jpg` (starting-dock columns, island edges (2,12), (3,11), (5,11), and tiles (1,15), (7,0)). Still stubs: `getActors`, `getLegalActions`, `applyAction`, `redactForClient`, `replay`. Delete each stub's test entry in `index.test.ts` as it gets a real implementation.
- All rule questions in `docs/architecture.md` section 12 are decided (2026-11-11), logged in `docs/rulebook-engine-notes.md` and written into `docs/rulebook.md`.
- Known issues: none.
- Card counts confirmed (now in `content/cards.json`). Risk deck is 16 cards including 2 Boots (confirmed 2026-11-12); rulebook card tables show the counts. Upgrade price $200 default, test $300 in simulation.
- `assets/board/board-zones.jpg` only defines the zones (teal=1, light blue=2, dark blue=3); all other tiles come from the original `board.webp`. Golden Fish cards are per fishing spot (independent of zones). Open: final zone names.
- Art is in `assets/art/` (see its README); board image in `assets/board/`.
- `docs/rulebook.md` is the single source of truth for the rules. The claude.ai rulebook doc is a copy and may be out of date; the repo wins.
