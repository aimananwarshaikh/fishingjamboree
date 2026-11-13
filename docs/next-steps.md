# Next steps (handoff after Milestone A)

Written 2026-11-13 (stage 7b) for someone who has not seen this project. Read `CLAUDE.md` first, then this file.

## Where Milestone A ended

A full online game for 2–4 players runs in a browser (desktop and phone width):

- Create a room, others join by code, the host starts, 20 rounds are played to a scored result.
- A refresh rejoins the seat. A player who closed their tab gets their seat back from the start screen (saved seats in `localStorage`) or from a rejoin link `#rejoin=CODE.TOKEN`. A tab whose seat is taken over goes back to the start screen with a message.
- A player who is away for 60 seconds (or leaves) is played for by the server. Since B1 (P1-2): a turn timer (60 s per decision) and a reconnect grace budget (2 minutes per player per game).
- The engine follows `docs/rulebook.md` with no known rule bug (`docs/review-2026-11-17.md`). 1,000 seeded random games pass in `fuzz.test.ts`.
- `scripts/playtest-three-tabs.mjs` (Playwright) plays whole games in three tabs by clicking only what a player can click.

How to run it: see "Running locally" in `README.md`. `pnpm check` and `npx prettier --check .` must pass before a commit.

The client is bare: SVG board, no card art, no animation. That is Milestone B2.

## Open items from the review

Full detail, evidence and file references are in [`docs/review-2026-11-17.md`](review-2026-11-17.md). Order is priority, then what to do first. Models are suggestions.

### P1

| Item                                                | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Model |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| P1-1 A player who closes their tab cannot come back | **Done** (PR #15, client only). Not done from it: a player who lost both the tab and the saved seat (new browser or device) still cannot get back without a rejoin link; there is no rejoin by name.                                                                                                                                                                                                                                                    |       |
| P1-2 One player can hold the game up                | **Done** (B1, server and a small client change; no engine or rule change). Turn timer: 60 s per decision for the deciding player, connected or not; then the server plays one action (not away). Reconnect grace: still 60 s per drop, now within a 2-minute budget per player per game. Clients get `RoomInfo.timers`, `SeatInfo.awayInMs` and `turnTimeLeftMs`. Open for the designer: question 4 (length, away after a timeout, host kick or pause). |       |

### P2

| Item                                       | What to do                                                                                                                                                                                                                                                            | Model |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| P2-3 Server play for an away player is bad | Make `chooseAutoAction` head for the nearest dock and stay near it, and possibly skip the card draw. This changes what the server does for a player, so confirm with the designer (question 3 below). `autoplay.ts:24-30`.                                            | Opus  |
| P2-4 One room's error stops `tick` for all | Catch per room in `tick`, keep the updates already built, and log. Also reply with an error when `handleMessage` throws, so the client's buttons are not stuck. Add the two-rooms test. `core.ts:172-181`, `:353`, `:442-451`; `transport.ts:138-151`; `App.tsx:206`. | Opus  |
| P2-5 A server restart ends every game      | Save the replay log (it already holds everything needed) and restore rooms on start. Decide where it is stored (file, database) together with B5. `core.ts:112`, `:207-210`.                                                                                          | Opus  |
| P2-6 Design points                         | Not code. See "Questions for the designer".                                                                                                                                                                                                                           | —     |

### P3 (the review does not number these; named by section and bullet)

Small fixes and tests: Sonnet unless noted.

**Engine**

- Make the impossible branches in `apply.ts:183, 187, 214, 219, 241` throw instead of returning quietly.
- Make `compileContent` check that fish values, fines and prices are multiples of `fineTokenValue` (`content.ts:240-245`, `:365`), with a test.
- Redact `players`, `turn` and `phase` field by field in `view.ts:26-29`, or fix the comment.
- Make `replay` check `schemaVersion` (`replay.ts:10-15`).
- Remove the dead branch for content with no event cards (`eventCards.ts:80-81`).
- Move `SETUP_SHIPS = 2` (`apply.ts:32`) into `content/rules.json`. Needed for the 5–6 player variant, which is not planned yet.
- Fix the three doc drifts: `architecture.md` §4 vs §12 item 28 (Helicopter and fine tokens); `rulebook.md` Docks (sell before pay); the stale "Risk (15)" and "exact landing" rows in the notes log.

**Server**

- Per-IP connection limit, `Origin` check, backpressure limit, idle limit for sockets with no seat; room codes can be walked and the host cannot remove a stranger from the lobby (`transport.ts:205-211`, `:243-254`; `core.ts:241-245`). These belong with B5 (deploy); a kick button belongs with B3.
- Clean player names (control, zero-width and right-to-left characters; Unicode normalisation) (`core.ts:496-499`).
- A disconnected lobby seat holds its name for 2 minutes (`core.ts:249-251`); a rejoin link now covers most cases, so it is low priority.
- Clear `away` when a game finishes (`core.ts:530-535`).
- Replace `localeCompare` in seat ordering (`core.ts:515`): wrong from `p10`.
- Validate `PORT` and make shutdown not wait on keep-alive connections (`main.ts:15`, `:43-49`).

**Web client**

- **`?server=` can send the seat token to another server** (`useGame.ts:50-52`, `:151-160`). **A bit more important since P1-1:** the token now also sits in `localStorage` and in rejoin links, and the client sends `rejoin` with it to whatever `?server=` says. Allow `?server=` in dev builds only, or check it against an allow-list. Do this before any public deploy (B5); Sonnet.
- `leave` while reconnecting is lost, because the pending retry timer reopens the socket (`useGame.ts:186-189`, `:137-146`, `:100`).
- After errors other than `bad-token` and `room-not-found` during a rejoin (for example `unsupported-version`) the table is dead (`useGame.ts:116-125`).
- The server port is fixed at 8787 (`useGame.ts:54`) and an `https` page needs `wss`. See B5.

**Missing tests** (Sonnet)

- `useGame.ts` (backoff, saved session, `bad-token` reset, `leave`). `scripts/playtest-three-tabs.mjs` covers it but is not in `pnpm check` or CI (`.github/workflows/ci.yml`).
- `fuzz.test.ts`: count the event types reached and fail if an expected one never appears (`turnSkipped`, `relocationFailed`, Sinking Boat to the cruise dock); read the token value from content (`fuzz.test.ts:130`).
- Engine: Helicopter expiring between start and end of a turn, and use on the last turn of round 20; a Sinking Boat victim taking a late entrant's dock; `applyAction` leaves its input untouched.
- Server: two rooms at once; the transport's `close()` during a game; unusual Unicode names.

## Questions for the designer

1. **The left starting dock has one exit.** (3,19) opens only onto (3,18), so a ship ending on (3,18) shuts the dock in both directions for a turn. The right dock has two exits. Add an exit, or leave it? (Review P2-6; 280 stuck turns in about 60,000.)
2. **A player on $0 beats anyone holding fine tokens.** Totals can be negative. Is that intended, or should fines be capped or scored differently? (929 of 1,000 random games had a negative total.)
3. **What should the server do for an away player?** Head for the nearest dock and sit there, skip the card draw, or something else? (P2-3; today they end near −$220.)
4. **Turn timer.** Built with the simplest choice (P1-2, B1): 60 seconds per decision, then the server plays **one** action for the player, who is not marked away. So a connected player who never acts costs about 2–3 minutes per turn of theirs. Is 60 seconds right? Should a player who times out become "away" instead (their later decisions then take 2 seconds until they act again)? Can the host kick or pause? Also: the reconnect grace budget is 2 minutes per player per game; is that right?
5. Information only, no decision needed unless you disagree: missed turns for players 3 and 4 never happened in 1,000 random games; the Golden Fish was lost to a full ship about three times as often as it was taken.
6. **Final zone names.** The board art's zone labels all read "SAFE ZONE 3" (placeholder).
7. **PNG of the board with the round-track layer hidden**, ideally 2× (2756×3938). Until it arrives the client can crop or cover the left-hand track strip. Needed for B2.

## Known issues and gaps, by Milestone B phase

Phases are in `docs/build-plan.md` section 5.

- **B1 (review fixes):**
  - Rooms are in memory only (P2-5).
  - P1-2 follow-ups, if the designer wants them (question 4): away after a timeout, a host pause or kick (kick belongs with B3), a per-room timer length chosen in the lobby (the room already holds its own `timers`).
- **B2 (real UI):**
  - The log is per tab; a refresh restarts it from "Joined room …" (the protocol sends no event history on rejoin, by design). Decide if the real UI needs history; if so, it is a protocol change.
  - Round banner and "Round N/20" progress bar with the three event marks (decided 2026-11-12; the bare client only has the bar). Needs the PNG from the designer.
  - Animation, a layout for the shop and Helicopter, touch tuning (6a notes).
- **B3 (lobby):** rematch and spectators (not in the protocol, `docs/protocol.md` §10); a way for the host to remove a player.
- **B4 (mobile):** the board is about 900 px tall on a phone (8×20 cells at ~45 px), so the far end needs a scroll. Zoom or crop it.
- **B5 (deploy):**
  - `pnpm start:server` does not reload; after changing server code, restart it, and kill the child `node … tsx … src/main.ts` process if `pkill -f "tsx src/main.ts"` was used, or the new server fails with `EADDRINUSE`. `pnpm dev:server` watches.
  - In dev, React StrictMode runs the rejoin effect twice on a refresh (a socket opened and closed at once). Harmless, gone in a production build.
  - Not done in 5b: no `Origin` check, no cap on connections per IP, no backpressure limit on slow sockets (the heartbeat covers dead ones).
  - The server port, `wss` for `https`, and `?server=` (see P3 above).
  - Put `scripts/playtest-three-tabs.mjs` into CI if it can run there.
- **B6 (bots, balancing):** `packages/sim` is empty. Card counts, the upgrade price ($200 default, $300 in simulation) and the design questions 1–2 feed into it.
- **B7 (playtests):** nothing yet.

## Recommended order

1. **B1 [OPUS]:** P1-2 is done. Next P2-4 (small, protects other rooms), P2-3 once the designer answers question 3, then P2-5. Sonnet can do the `?server=` restriction and the small P3 fixes and tests alongside.
2. **B2 onwards** as in `docs/build-plan.md`: B2 UI, B3 lobby, B4 mobile, B5 deploy, B6 bots and balancing, B7 playtests. Do the P3 server hardening with B5 and the host kick with B3.
3. Start a fresh Opus session for a review pass at the end of B1 (build plan section 6, item 3).

## History

The detailed notes for the stages 2a–5c, moved out of `CLAUDE.md` Status on 2026-11-13. The git log and the PRs hold the rest (Session 2: PR #3; 3a: PR #5; 3b: PR #6; 4a: PR #7).

- 5c: server package `start` script (`tsx src/main.ts`, no watch) and root `start:server`; README "Running locally" (install, check, start, `PORT`/`HOST`/`CONTENT_DIR`, health check, WebSocket URL, `wscat` smoke test). Checked by hand: `pnpm start:server` and `pnpm dev:server` start, `/health` answers `ok`, a `create` message gets the `welcome` reply, `PORT` is honoured. No code behaviour changed.
- 5b: `transport.ts` (`createGameServer`: one connection id per socket, JSON text frames with `bad-message` on bad JSON or binary, `Outbound` carried out in order, `core.disconnect` once per closed socket, `tick` scheduled from `nextDeadline()`, ping/pong heartbeats every 15 s, 4 KiB frame limit (1009), token-bucket rate limit 30 burst / 10 per s (1008), 500-room cap (`server-busy`); all in `TransportConfig`). `main.ts` serves it with `GET /health` on `PORT` (default 8787; `pnpm dev:server`). Tests: `transport.test.ts` with real sockets (`wsTestClient.ts`): a whole 3-player game with a disconnect and rejoin by seat token (replay matches, nothing private sent, every socket disconnected exactly once), the server playing for an away player on the timer, bad JSON, size limit, rate limit, heartbeat drop, `replaced`, room cap, lobby grace. Transport decisions are in the notes log and a table in `docs/protocol.md` §9. No core or protocol change; no core bug found.
- 5a: `docs/protocol.md` (replaces the sketch in architecture §10). In `packages/server/src`: `protocol.ts` (message types, no Node imports, so the web client can import it), `parse.ts` (validates and rebuilds every client message), `core.ts` (`ServerCore`: `handleMessage`, `disconnect`, `tick`, `nextDeadline`; returns `Outbound[]`, no sockets or timers), `autoplay.ts` (what the server plays for an away player), `ids.ts` (`cryptoIds`), `content.ts` (`loadContent`). Tests: `parse`, `ids`, `lobby`, `game` (whole 2/3/4-player games over the protocol; replay matches; nothing private is sent), `reconnect` (seat tokens and the disconnect policy), `autoplay`, with `testHarness.ts` (fake clock, predictable ids). Decisions are in the notes log: intents must name the current `seq`; 60 s reconnect grace, then the server plays for the player; 2 min lobby grace; idle rooms deleted after 30 min. No engine change.
- 4c: `fuzz.test.ts`. 1,000 games (2/3/4 players by seed `fuzz-N`), bot picks uniformly from `getLegalActions` on the redacted view using `seedRng`/`randomInt`. After every action: `invariantProblems`, legality equal on state and view, 20,000-action stuck guard. At the end: round 20, `gameOver`, winners = best total. Every 50th game also checks `replay` reproduces the final state and `applyAction` rejects illegal actions (another seat's, wrong phase). Failures name seed, player count and action number. The full run takes about 10 s, so it is the default (no env var: lint bans `process` in the engine). No engine bugs found; engine code and `types.ts` unchanged.
- 4b: Tsunami in `eventCards.ts` (Risk discard + draw pile shuffled together). End of game in `apply.ts` (`endGame`) with `scoreGame` in `economy.ts`. `view.ts` (`redactForClient`) and `replay.ts` are real; `notImplemented.ts` is gone. No change to `types.ts`. New tests: `cardTable.test.ts` (one row per card id in `content/cards.json`; a new card fails until it has a row), `fullGame.test.ts` (greedy policy plays whole 2/3/4-player games; scores, winners, ties, cash rebuilt from events, pinned outcomes per seed; seed `full-a` is a shared win), `view.test.ts` (redaction; `getLegalActions` equal on views in `dockShop`, `turnEnd`, Sinking Boat `placeShip` and every state of a whole game), `replay.test.ts`. Two rule notes added (Tsunami shuffle, end-of-game order).
- 4a: design in `docs/architecture.md` §4 "Effects and modifiers". New: `modifiers.ts` (everything an event or upgrade changes, derived from `activeEvent`), `economy.ts` (fish, fines, sales), `cards.ts` (draw pipeline and handlers by effect kind), `dock.ts` (docking, shop, Sinking Boat relocation), `eventCards.ts` (expiry and draw after rounds 5/10/15, Golden Fish placement), `ctx.ts`. `landing.ts`, `legal.ts` and `apply.ts` now cover all six actions and the `dockShop` and `turnEnd` phases. Tests: `modifiers`, `economy`, `cards`, `dock`, `helicopter`, `eventCards`, `smoke` (`*.test.ts`); new helpers in `testHelpers.ts` (`land`, `withTopCard`, `withPlayer`, `withActiveEvent`, `invariantProblems`).
- 3b: `movement.table.test.ts` checks `reachableDestinations` against the brute-force `oracle` (moved into `testHelpers.ts` with `isDock`) for every tile a ship can stand on, steps 1–9, with no ships and 5 fixed sets of 1–3 ships. Performance check: whole-board sweep at 9 steps (6 + 2 + 1) under a generous 10 s limit (it takes well under 1 s). No movement bugs found; `movement.ts` unchanged.
- 3a: `movement.ts` (`reachableDestinations`: layered search over tile + previous tile), real `getActors`, `getLegalActions` and `applyAction` for `placeShip` (setup, late entry), `roll`, `move`, and the turn/round advance. Tests in `movement.test.ts` and `apply.test.ts` on the real board, helpers in `testHelpers.ts`. `landing.ts` (`resolveLanding`) is the Session 4 seam and does nothing yet.
- Rule change (designer, 2026-11-12): docking does not need the exact roll; a roll of at least the distance reaches a free dock. Rulebook, architecture §4 and §12 item 15, and the notes log are updated.
- 2a: `content/board.json` (8×20) traced from `assets/board/board.webp`, zones from `board-zones.jpg`. `pnpm board:render` (needs Playwright; `NODE_PATH="$(npm root -g)"` if it is installed globally) draws it over the art as `assets/board/board-overlay.jpg`.
- 2b: `content/cards.json` and `content/rules.json` replace `card-counts.json`. Implemented `compileContent` (`content.ts`), seeded RNG (`rng.ts`: cyrb128 + sfc32, rejection-sampled die, Fisher–Yates), content hash (`hash.ts`), decks (`decks.ts`: build, draw, discard, reshuffle when empty), `createGame` with the roll-off (`setup.ts`). Tests use the real content via `src/testContent.ts`. The engine tsconfig's `rootDir` is now the repo root so tests can import `content/*.json`.
