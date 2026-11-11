# CLAUDE.md — Fishing Jamboree

## What this is

A digital version of the Fishing Jamboree board game. The target is an online game 3–4 players can playtest in a browser (desktop and mobile).

## Read first

- `docs/rulebook.md`: the rules. Source of truth.
- `docs/rulebook-engine-notes.md`: rule clarifications made during the build.
- `docs/build-plan.md`: sessions, stages and which model does what.
- `docs/architecture.md`: engine contract and structure (from Session 1).
- `docs/protocol.md`: online protocol (from Session 5).

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
- Last completed stage: Session 1, stage 1a [SONNET]
- Next stage: Session 1, stage 1b [FABLE, plan mode]
- Known issues: none yet
- Card counts confirmed (`content/card-counts.json`). Upgrade price $200 default, test $300 in simulation.
- Open: final zone names, and exact tile ownership of each zone (confirm before Session 2a).
- Art is in `assets/art/` (see its README); board image in `assets/board/`.
- Rulebook living version is a claude.ai artifact; if it differs from `docs/rulebook.md`, the living doc wins.
