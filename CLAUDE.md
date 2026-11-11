# Fishing Jamboree

Online multiplayer (3–4 players, browser, desktop + phone) version of the Fishing Jamboree
board game. **Docs to read first:** `docs/rulebook.md` (rules source of truth),
`docs/build-plan.md` (plan, sessions, model routing), this file.

## Layout

- `packages/engine` — pure game rules. No deps, no I/O, no `Math.random`/`Date` (lint-enforced).
- `packages/server` — Node WebSocket server (`ws`), server-authoritative rooms.
- `packages/sim` — bots + balancing simulator (Milestone B).
- `apps/web` — React + Vite client.
- `content/` — board map, card definitions/counts, prices as JSON (balancing needs no code change).
- `assets/` — board image and art.
- `docs/` — plan, rulebook, architecture, protocol, decisions log.

## Commands

- `pnpm install`
- `pnpm test` — Vitest (all packages); `pnpm test:watch`
- `pnpm typecheck` — `tsc -b`; `pnpm lint`; `pnpm format`
- `pnpm check` — typecheck + lint + test (run before every commit)
- `pnpm dev:web`, `pnpm dev:server`

## Engine contract (defaults; Fable confirms in Session 1b)

`createGame(config, seed) → state`; `getLegalActions(state, playerId)`;
`applyAction(state, action) → { state, events }`. Pure, deterministic, seeded RNG stored in
state, state is plain JSON. Server sends clients `redactForClient(state)` (deck order is secret).

## Conventions

- TypeScript strict. Prettier + ESLint. Tests next to source as `*.test.ts`.
- Tests first for rules. Table-driven where possible.
- Rule ambiguities: log in `docs/rulebook-engine-notes.md` (date, question, answer, who decided).
- Before switching model: commit and update the Status section below.
- Don't cut corners on [FABLE] stages of Sessions 3 and 4 (see build plan).

## Status

- **Milestone A due Tue 17 Nov 2026, 7pm AEDT.**
- Session 1a (scaffold): DONE — monorepo, TS strict, Vitest, ESLint/Prettier, pnpm scripts.
- **Waiting on:** real `docs/rulebook.md`, board image + Art folder into `assets/`, card counts
  (placeholders OK), upgrade price (default $300, config value).
- **Next:** Session 1b [FABLE, plan mode] — `docs/architecture.md`, `packages/engine/src/types.ts`,
  content schemas, ambiguity list.
