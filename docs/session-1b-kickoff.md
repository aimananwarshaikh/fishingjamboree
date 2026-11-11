# Session 1b kickoff — for the Fable planning session

Written 2026-11-11 at the end of stage 1a. Read this after `CLAUDE.md`. It collects every decision and input made so far, so nothing depends on chat history.

## What to do

Stage 1b of `docs/build-plan.md` (Session 1, [FABLE], plan mode, ~75 min). Use the prompt in the plan, reproduced here:

> Read CLAUDE.md, docs/build-plan.md (sections 2 and 4 / Session 1) and docs/rulebook.md. Do stage 1b. Confirm or improve the architecture defaults, explaining any change in one line each. Design the engine contract, state, actions, phases, events and content schemas so they support online play, replays and bots without a redesign. Write docs/architecture.md and packages/engine/src/types.ts. Finish with a numbered list of rule ambiguities the engine needs decided, each with your recommended answer. Don't write implementations.

Additional instructions for this run:

- Also read `docs/rulebook-engine-notes.md`, `content/card-counts.json` and this file.
- Outputs: `docs/architecture.md`, `packages/engine/src/types.ts`, content schemas (board, cards, prices/config) as types in `types.ts` (JSON Schema optional), RNG choice, redaction rules, protocol sketch, rule-ambiguity list.
- Types must compile under the repo's strict config (`pnpm typecheck`). No implementations; stubs are stage 1c (Sonnet).
- Don't write `content/board.json` (Session 2a, Opus). Don't edit the rulebook; put proposed rule decisions in the ambiguity list for the designer to approve, then log them in `docs/rulebook-engine-notes.md`.
- Stop when the "done when" is met: types compile and the ambiguity list exists. Then commit and update `CLAUDE.md` → Status.

## Repo state

Monorepo at the repo root, pnpm workspaces, `pnpm check` (typecheck + lint + test) passes with one placeholder test.

| Path              | State                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` | Placeholder `index.ts` only. ESLint bans `Math.random`, `Date`, `process`, `console` here. No `types` entry in tsconfig (no Node types), so the engine must stay environment-free. |
| `packages/server` | Stub. Depends on `ws`. Session 5.                                                                                                                                                  |
| `packages/sim`    | Stub. Milestone B.                                                                                                                                                                 |
| `apps/web`        | Minimal React + Vite page. Session 6.                                                                                                                                              |
| `content/`        | `card-counts.json` (draft; the schema may restructure it).                                                                                                                         |
| `assets/board/`   | `board.webp` (original art, source for tiles), `board-zones.jpg` (zones only).                                                                                                     |
| `assets/art/`     | Card faces, backs, tokens, bills. See its README. Not needed in Milestone A.                                                                                                       |

TypeScript options worth knowing: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `composite` project references.

## Rules summary (rulebook is the source of truth)

Read `docs/rulebook.md`. Short version: 2–4 players (3–4 for playtests; the 5–6 variant is out of scope), 20 rounds, one d6, grid movement of an exact step count, Safe/Risk/Event decks, dock to sell fish and buy Speed/Capacity upgrades, richest player wins.

## Decisions made so far

Also in `docs/rulebook-engine-notes.md`.

1. **Card counts.** Safe deck (18): Boot 4, +1 Fish 4, +2 Fish 4, +3 Fish 4, $100 fine 2. Risk deck (15): Boot 2, +3 Fish 2, $200 fine 2, $300 fish 3, $500 fish 2, $700 fish 1, Shark 3, Sinking Boat 1. The Risk deck has no +1 or +2 Fish. Event deck: one copy each of 11 cards (Golden Fish × 3, +1 Catch × 3, +1 Movement, −1 Movement, Helicopter, Shark Repellent, Tsunami), of which only three are drawn per game (after rounds 5, 10, 15). The event deck count is an assumption; confirm it in the ambiguity list.
2. **Upgrade price** is $200 by default, a config value; simulation may move it to $300. Upgrades are Speed (roll +2) and Capacity (8 fish instead of 5).
3. **Names.** "Shipwreck Bay" (not Shark Bay), "Davy Jones' Locker" (not Davy Jones). The board art still has the old labels.
4. **Zones.** Three safe zones, defined by colour on `board-zones.jpg`: teal = 1, light blue = 2, dark blue = 3. Plus two risk areas: Shipwreck Bay (2×4) and Davy Jones' Locker (5×5). Zones only matter for the "+1 Fish to All Catch" events. Proposed names (not final): Pearl Shallows, Kelp Reach, Windward Deep.
5. **Fishing spots are independent of zones.** Three numbered spots (1, 2, 3) on the board. Each Golden Fish event is tied to a spot, not a zone.
6. **Board source.** Tiles, island, docks, fishing spots and risk areas are traced from the original `board.webp`. `board-zones.jpg` is used only to assign each tile a zone. The two images differ slightly (e.g. island shape, grid edges); Session 2a must list mismatches.
7. **Docks.** Two starting docks (bottom pier) and one cruise ship dock (top right). Ships only enter the board from a starting dock. The 5–6 player dock is out of scope.
8. **Tile types for the board schema** (from the build plan): sea, island, dock, shipwreck-bay, davy-jones-locker, fishing-spot, off-board; plus a zone (1/2/3) and a dock id where relevant. Fishing spots also need a spot number. Decide how a tile can be both sea (with a zone) and a fishing spot.

## Things the design must support

- **Server-authoritative online play.** Clients send intents; the server validates with the engine and sends `redactForClient(state)` plus an event log. Deck order is hidden, and so are drawn-but-unresolved cards if relevant.
- **Replays.** State is JSON, actions are logged, and the RNG is seeded and stored in state. Same seed plus the same actions gives the same game.
- **Bots and simulation.** `getLegalActions` must be cheap. Bots must be able to play from the redacted view.
- **Simultaneous decisions.** The Helicopter event lets every player choose, so it needs its own decision phase (several players choose at once; see Session 5).
- **Data-driven content.** Card definitions, counts, prices and the board are JSON in `content/`. Balancing must not need code changes.
- **Reconnection and disconnect handling** shape the protocol (Session 5), not the engine, but the engine must not make them hard.

## Seed list of ambiguities to resolve

These came up while reading the rulebook. Fable should keep, drop or extend them, and give a recommended answer for each in the final numbered list.

1. **Zone of risk-area tiles.** "+1 Fish to All Catch" applies to fish cards and Boots drawn "in that zone", but the Risk deck has Boot and +3 Fish. Which zone are Shipwreck Bay and Davy Jones' Locker tiles in, and does a +1 Catch event ever apply to Risk draws?
2. **No-step-back rule.** Per step within a move, or only against the tile you started the turn on? Can a path revisit any earlier tile in the same move?
3. **Passing over docks.** May you pass through a free dock without docking? Over an occupied one (the rule says no)?
4. **Leaving a dock.** Is the dock tile itself the start tile (so you can't end on it), and what happens if every exit is blocked?
5. **Roll modifiers.** Order and floors: Speed (+2), +1 Movement, −1 Movement, and what a roll reduced to 0 or below does (the rulebook covers a roll of 1 becoming 0).
6. **Helicopter.** When does it resolve (immediately when drawn, before round 6 starts)? Player order, and what if a player can't afford $200? Do fish on a ship that is sitting on a dock count? The effect is a one-off sale, not a modifier. Does the fee go to the bank? Do fines get paid from the sale first (the rulebook says so)?
7. **Event timing and expiry.** An event drawn after round 5 lasts through round 10, and the previous event expires when a new one is drawn. The round 15 event lasts to the end. Is the Helicopter or Tsunami "instant" with no lasting effect? When does a Golden Fish disappear if unclaimed?
8. **Golden Fish.** Token counts as one fish, so it respects capacity. What if the ship is full? What if a player lands on the spot while docked or blocked? What if two events both put a Golden Fish out (only one at a time, since events expire)?
9. **Shark.** "Lose 3 fish, cheapest first": tie-break among equal values, and with Shark Repellent active only in Shipwreck Bay (not Davy Jones' Locker). Confirm that.
10. **Capacity overflow.** Which fish are lost? The new ones, never swapping. What about +3 Fish with room for 2: take two $100 tokens? And a $700 fish when full?
11. **Fines.** Pay from cash, then take fine tokens. Does a docked player pay tokens first from fish value, then cash? Order of sale versus buying upgrades when cash is short. Can fine tokens exceed some limit? A fine when docked.
12. **Sinking Boat.** Both starting docks taken: go to the cruise ship dock, else stay. Does arriving at a dock this way count as docking (no sale, since fish are lost)? Fine tokens stay.
13. **Late entry (players 3–4).** Entering the board uses the start of the turn if a starting dock is free. Is the entry the dock tile itself (so the player then moves out with their roll)? What if the roll makes the move illegal? Who gets the free dock if both are free?
14. **Turn order.** Roll-off ties re-rolled between tied players only. Seat order is fixed after the roll-off.
15. **Docking.** "You can't stay docked turn after turn." If a docked ship can't leave, it misses its turn. Can you dock again straight after leaving? Do you need an exact roll to land on a dock (yes)? Does docking need any fish?
16. **End of game.** Final scoring after round 20 (after the last player's turn). Fish on the ship are worth nothing. Tie-break: fewer fine tokens, then shared win.
17. **Deck exhaustion.** Reshuffle the discard pile when a deck is empty. With the Risk deck's counts and Tsunami this is rare but must be defined, including a deck and discard both empty.
18. **Empty-fish draws.** Boot gives nothing; "+1 Catch" turns Boot into one $100 fish (per rulebook: "every fish card or Boot").
19. **Hidden information.** The Risk and Safe draws are secret until drawn; an event card is public. Is the discard pile public (yes)? Does each player's fish tokens' values stay public (assume yes).
20. **Player count.** Engine support for 2–4; the playtest target is 3–4.

## Out of scope for 1b

Implementations, `content/board.json`, UI, server code, simulation, deployment. Stage 1c (Sonnet) adds stubs so the repo compiles.

## After 1b (checklist for the designer)

- Read the ambiguity list and answer each item; log answers in `docs/rulebook-engine-notes.md` and update the rulebook where play changes.
- Confirm or adjust the zone names.
- Then Session 2 (Opus): trace the board, then `createGame` and decks.
