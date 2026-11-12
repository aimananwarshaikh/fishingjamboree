# Fishing Jamboree — Build Plan

**End goal:** a working online version that 3–4 players can playtest from a browser (desktop and phone).
**Milestone A, due Tue 17 Nov 2026, 7pm AEDT:** the hardest, riskiest parts built and tested, mostly with Fable: engine design, movement, cards and events, and the online server core. A bare two-browser proof is the stretch goal.
**Milestone B, after 17 Nov:** UI with the real art, lobby, mobile layout, deployment, balancing and playtests, built with Opus and Sonnet.

Docs Claude Code must read: `docs/rulebook.md` (rules source of truth), this plan, `CLAUDE.md`.

---

## 1. Model routing

| Model      | Use it for                                                                                                                                                 | Don't use it for                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Fable**  | Decisions that are expensive to undo (architecture, data model, protocol); the hardest algorithms (movement); tricky rule interactions; independent review | Boilerplate, config, running test loops, UI, docs |
| **Opus**   | Implementing a design Fable made; tracing the board map from the image; bots and simulator; stubborn bugs; game-UI interaction logic                       | Repo setup, lint fixes, simple components         |
| **Sonnet** | Scaffolding, tooling, routine tests, fixing lint/type errors, docs and status updates, straightforward UI, deploy config                                   | Designing anything other code depends on          |

**Rule of thumb:** Fable decides and writes the tricky core, Opus builds out from it, Sonnet tidies up. Switch down as soon as the tricky part is done.

**How to switch:** in Claude Code, type `/model` and pick the model named in the stage. Each session below is split into stages labelled **[FABLE]**, **[OPUS]** or **[SONNET]**.

- Before switching, have the current model **commit and update `CLAUDE.md` → Status**. The next model then reads the repo, not a long chat history.
- Start each new day with `/clear`, then the session's kickoff prompt.

**Saving Fable tokens**

- Start every Fable stage in plan mode. Approve the plan, then let it build.
- One target per stage, with a clear "done when". Stop the stage when it's met.
- Prepare inputs beforehand (map, card counts, decisions) so Fable never waits on you.
- Never ask Fable to explain, summarise or write docs; Sonnet does that afterwards.
- If Fable starts on routine work (wiring, renaming, repetitive tests), stop and switch to Sonnet.

---

## 2. Architecture defaults (Fable confirms or changes these in Session 1)

- **TypeScript monorepo** using pnpm workspaces:
  - `packages/engine`: pure game rules, no dependencies, no I/O
  - `packages/server`: Node WebSocket server (`ws`), server-authoritative rooms
  - `apps/web`: React + Vite client
  - `packages/sim`: bots and balancing simulator (Milestone B)
  - `content/`: board map, card definitions and counts, prices (JSON), so balancing never needs code changes
- **Engine contract:** `createGame(config, seed) → state`; `getLegalActions(state, playerId)`; `applyAction(state, action) → { state, events }`.
  - Pure and deterministic: no `Math.random` or `Date`. A seeded RNG is stored in the state.
  - State is plain JSON, so it can be saved, replayed and sent over the network.
- **Turn phases:** roll → choose destination (from a list of legal tiles) → resolve tile or card → dock/shop (if docked) → end turn. At round end: advance the round, and after rounds 5, 10 and 15 draw an event and expire the previous one.
- **Hidden information:** deck order is secret. The server sends each client `redactForClient(state)`.
- **Online:** clients send action intents. The server validates each one with the engine, applies it and broadcasts the redacted state plus an event log. Players join with a room code, and a seat token allows reconnection.
- **Hosting (Milestone B):** web on Vercel or Netlify, server on Render or Fly.io.

---

## 3. Prepare before Session 1

- [ ] Create an empty GitHub repo, e.g. `fishing-jamboree`.
- [ ] Have the board image and the Art folder ready to add to `assets/`.
- [ ] Card counts: send them if you have them; placeholder counts are fine until then.
- [ ] Upgrade price: $300 by default (it's a config value, so it can change any time).

---

## 4. Milestone A sessions (11–17 Nov)

About 16 hours in total, of which roughly 5.5 are Fable.

**If you fall behind, cut in this order:** Session 6 first, then the [OPUS] part of Session 5. Never cut the [FABLE] stages of Sessions 3 and 4.

### Session 1: Wed 11 Nov, 2h — Foundations and architecture

| Stage | Model                  | Time | Output                                                                                                                                                                                                               | Done when                                           |
| ----- | ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1a    | **[SONNET]**           | 30m  | Monorepo scaffold: TS strict, Vitest, ESLint/Prettier, pnpm scripts; project docs copied into `docs/`; `CLAUDE.md` created from the template; assets in `assets/`                                                    | `pnpm test` runs (zero tests is fine); first commit |
| 1b    | **[FABLE]**, plan mode | 75m  | `docs/architecture.md`; `packages/engine/src/types.ts` (state, actions, phases, events); content schemas for the board, cards and prices; RNG choice; redaction rules; a protocol sketch; a list of rule ambiguities | Types compile; you've read the ambiguity list       |
| 1c    | **[SONNET]**           | 15m  | Stub functions so everything compiles; update CLAUDE.md Status                                                                                                                                                       | Commit                                              |

**1a prompt (Sonnet):**

> Read CLAUDE.md if it exists, otherwise read the Fishing Jamboree project docs: claude/build-plan.md, claude/rulebook.md and claude/claude-md-template.md. (If you can't reach them, I'll drop them into docs/.) Do Session 1, stage 1a of the build plan exactly. Copy the docs into docs/ and create CLAUDE.md from the template. Commit when done.

**1b prompt (Fable, plan mode):**

> Read CLAUDE.md, docs/build-plan.md (sections 2 and 4 / Session 1) and docs/rulebook.md. Do stage 1b. Confirm or improve the architecture defaults, explaining any change in one line each. Design the engine contract, state, actions, phases, events and content schemas so they support online play, replays and bots without a redesign. Write docs/architecture.md and packages/engine/src/types.ts. Finish with a numbered list of rule ambiguities the engine needs decided, each with your recommended answer. Don't write implementations.

**1c prompt (Sonnet):**

> Read CLAUDE.md and docs/architecture.md (sections 3 and 4). Do Session 1, stage 1c. Add stub implementations of every function in the `Engine` interface in packages/engine/src/types.ts, one file per area, each throwing a "not implemented" error, and export them from the engine's index. Don't implement any rules. Run pnpm check, commit, push, and update Status in CLAUDE.md.

**2b prompt (Opus):**

> Read CLAUDE.md and docs/architecture.md (sections 3, 4, 7 and 8). Do Session 2, stage 2b with tests. Don't change types.ts without telling me why.

### Session 2: Thu 12 Nov, 2h — Board map and game setup

| Stage | Model        | Time | Output                                                                                                                                                                                                         | Done when                                                   |
| ----- | ------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 2a    | **[OPUS]**   | 60m  | `content/board.json` traced from the board image, following the schema; a debug script that draws tile types over the board image                                                                              | You've compared the overlay with the board and corrected it |
| 2b    | **[OPUS]**   | 45m  | Convert `content/card-counts.json` into `content/cards.json` and `content/rules.json`; `createGame`, turn-order roll-off, seeded dice, decks (build, shuffle, draw, discard, reshuffle when empty), with tests | Tests pass                                                  |
| 2c    | **[SONNET]** | 15m  | Lint/type cleanup; update Status                                                                                                                                                                               | Commit                                                      |

**2a prompt (Opus):**

> Read CLAUDE.md and docs/architecture.md. Do Session 2, stage 2a. Trace assets/board image into content/board.json using the board schema in types.ts. Follow `BoardContent` and the example in docs/architecture.md section 7: a terrain grid and a zone grid (one character per tile) plus the dock and fishing-spot lists. Then write a script that renders the map over the board image as a PNG, so I can check it. List any tiles you weren't sure about.

### Session 3: Fri 13 Nov, 2h — Movement (the hardest single piece)

| Stage | Model        | Time | Output                                                                                                                                                                                                                                                                                                                            | Done when                          |
| ----- | ------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 3a    | **[FABLE]**  | 90m  | The full edge-case test list first, then reachable-destination logic: exact step count; no diagonals; no immediate step back; can't pass through ships or the island; can't end on an occupied dock; can't end on the start tile; 0 steps; leaving a dock; players 3–4 entering from a starting dock; the "no legal move" outcome | Every edge case has a passing test |
| 3b    | **[SONNET]** | 30m  | Extra table-driven tests generated from the real map; a performance check on worst-case rolls (6 + 2 + 1 = 9 steps); update Status                                                                                                                                                                                                | Commit                             |

**3a prompt (Fable):**

> Read CLAUDE.md, docs/architecture.md and the Movement, Setup step 7 and Special cases sections of docs/rulebook.md. Do Session 3, stage 3a. Write the complete edge-case test list first and show it to me. Then implement the reachable-destinations function and its integration into the move action, and make every test pass. Where the rulebook is silent (e.g. passing over a free dock, looping back to a tile visited earlier in the same move), pick the most sensible rule, encode it in a test, and add it to docs/rulebook-engine-notes.md.

### Session 4: Sat 14 Nov, 3–4h — Cards, events and economy

| Stage | Model        | Time    | Output                                                                                                                                                                                                                                                                                                                                                                            | Done when                         |
| ----- | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 4a    | **[FABLE]**  | 60m     | The effect and modifier system: card resolution pipeline; event modifiers that expire at the next event (±1 movement, zone +1 catch, Shark Repellent, Golden Fish); capacity overflow; fines → tokens; Helicopter (a lasting event: once per own turn, before rolling or at the end of the turn); Sinking Boat relocation; the dock/shop phase. Build these hard ones with tests. | Tests pass for each listed rule   |
| 4b    | **[OPUS]**   | 90–120m | Remaining cards; selling at the dock; buying upgrades; round and event flow; end of game (a tie is a tie)                                                                                                                                                                                                                                                                         | A full 20-round game runs in code |
| 4c    | **[SONNET]** | 30m     | A fuzz test where a random-move bot plays 1,000 seeded games and checks invariants: cash never negative, fish ≤ capacity, no two ships on one tile, every game ends after round 20. Update Status                                                                                                                                                                                 | Fuzz test passes; commit          |

**4a prompt (Fable):**

> Read CLAUDE.md, docs/architecture.md, docs/rulebook.md (Card reference, Capacity, Fines, Docks, Special cases) and docs/rulebook-engine-notes.md. Do Session 4, stage 4a: design and build the effect/modifier system and the listed hard rules, with tests. Leave the simple cards and plumbing as clearly marked TODOs for Opus.

**4b prompt (Opus):**

> Read CLAUDE.md and the TODOs Fable left. Do Session 4, stage 4b, using the patterns Fable established. Don't redesign them.

### Session 5: Sun 15 Nov, 3–4h — Online server core

| Stage | Model        | Time | Output                                                                                                                                                                                                                         | Done when               |
| ----- | ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 5a    | **[FABLE]**  | 75m  | `docs/protocol.md` plus the server core: room lifecycle (create, join by code, 2–4 seats, start); validating actions with the engine; redacted broadcasts; sequence numbers; reconnecting with a seat token; disconnect policy | Core tests pass         |
| 5b    | **[OPUS]**   | 90m  | WebSocket server built around the core; an integration test where fake clients play a full game                                                                                                                                | Integration test passes |
| 5c    | **[SONNET]** | 30m  | Dev scripts, README run instructions; update Status                                                                                                                                                                            | Commit                  |

**5a prompt (Fable):**

> Read CLAUDE.md, docs/architecture.md and the engine's public API. Do Session 5, stage 5a. Design the online protocol for a server-authoritative game with 3–4 remote players, write docs/protocol.md, and build and test the transport-independent room/session core. Keep WebSocket plumbing out of it; Opus will add that.

### Session 6: Mon 16 Nov, 2h — Two-browser proof (stretch)

| Stage | Model        | Time | Output                                                                                                                             | Done when                   |
| ----- | ------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 6a    | **[SONNET]** | 75m  | A bare web client: join a room, draw the grid from board.json, highlight legal tiles, roll/move/buy buttons, an event log. No art. | Two tabs join the same room |
| 6b    | **[OPUS]**   | 45m  | Fix integration bugs                                                                                                               | Three tabs play a full game |

### Session 7: Tue 17 Nov, 1h (before 7pm) — Review and handoff

| Stage | Model        | Time | Output                                                                                                                                                                               | Done when             |
| ----- | ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 7a    | **[FABLE]**  | 40m  | An independent review of the engine and server against the rulebook: rule bugs, risky design, missing tests. Written to `docs/review-2026-11-17.md` in priority order. **No fixes.** | Review file committed |
| 7b    | **[SONNET]** | 20m  | Update CLAUDE.md Status and `docs/next-steps.md`; tag `milestone-a`                                                                                                                  | Tag pushed            |

**7a prompt (Fable):**

> Act as a skeptical reviewer who hasn't seen this code before. Read docs/rulebook.md, docs/rulebook-engine-notes.md, docs/architecture.md, docs/protocol.md, then the engine and server code and tests. Find rule bugs, risky design decisions and untested cases. Write docs/review-2026-11-17.md as a prioritised list (P1/P2/P3), with file references. Don't fix anything.

---

## 5. Milestone B: online playtest (Opus and Sonnet)

Estimate: 3–5 weeks at 7–10 hours a week.

| Phase | Work                                                                                                                                                                                                                                                            | Model                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| B1    | Fix the review's P1 and P2 issues                                                                                                                                                                                                                               | Opus (Sonnet for small fixes)                                         |
| B2    | Real UI with your art: board, ships, cards, tokens, dice, turn feedback. Round display instead of the printed track: a "Round N of 20" banner at each round start and a small round counter with a progress bar marking the event points (see CLAUDE.md Status) | Sonnet for components; Opus for board interaction and animation state |
| B3    | Lobby: create/join room, names, ready-up, rematch                                                                                                                                                                                                               | Sonnet                                                                |
| B4    | Responsive mobile layout (the tall board suits phones in portrait)                                                                                                                                                                                              | Sonnet                                                                |
| B5    | Deploy web and server, environment config, basic logging                                                                                                                                                                                                        | Sonnet (Opus if networking issues come up)                            |
| B6    | Bots and balancing simulator → set card counts and upgrade price                                                                                                                                                                                                | Opus builds, Sonnet runs and reports                                  |
| B7    | 3–4 person online playtests and fixes                                                                                                                                                                                                                           | Opus                                                                  |

Fable is optional here. Save it for a bug Opus can't crack, or for designing AI opponents later.

---

## 6. If Fable tokens run out

The goal is still achievable. Every [FABLE] stage becomes **[OPUS] in plan mode**, with three changes:

1. Smaller steps: split the stage into two, design first and then build.
2. Tests first, always.
3. An extra Opus review pass at the end of each former Fable stage. Start it in a fresh session and give it the Session 7 reviewer prompt, scoped to that stage.

Expect more back-and-forth and some slippage on Sessions 1, 3, 4 and 5. The scope doesn't change, only the time.

---

## 7. Decisions log

Record every rule clarification the engine needs in `docs/rulebook-engine-notes.md` (date, question, answer, who decided). Anything that changes how the game plays goes back into the living rulebook doc too.
