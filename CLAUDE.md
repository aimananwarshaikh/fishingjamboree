# CLAUDE.md — Fishing Jamboree

## What this is

A digital version of the Fishing Jamboree board game. The target is an online game 3–4 players can playtest in a browser (desktop and mobile).

## Read first

- `docs/rulebook.md`: the rules. Single source of truth (the repo wins over any other copy).
- `docs/rulebook-engine-notes.md`: rule clarifications made during the build.
- `docs/build-plan.md`: sessions, stages and which model does what.
- `docs/architecture.md`: engine contract and structure (from Session 1).
- `docs/protocol.md`: online protocol (from Session 5).
- `docs/next-steps.md`: where Milestone A ended, open review items, questions for the designer, plan for Milestone B (read this before starting Milestone B).
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

- Current milestone: B (Milestone A delivered; see `docs/next-steps.md`)
- Last completed stage: Milestone B, phase B1 [OPUS], review item P1-2 (turn timer and reconnect grace budget). Before it: Session 7, stage 7b [SONNET] (handoff: `docs/next-steps.md`; tag `milestone-a` pending the PR merge), the P1-1 fix [OPUS] (PR #15), 7a [FABLE] (the review), Session 6 (6a, 6b), and Sessions 2–5. Stages 2a–5c are in `docs/next-steps.md` under "History", the git log and the PRs.
  - P1-2 fix (B1): `packages/server/src/core.ts`. Turn timer: the deciding player has `turnTimeoutMs` (default 60 s) from the previous action, the game start, or an empty room's return; then the server plays **one** action with `chooseAutoAction` (`auto: true`), the player is not marked away and gets a fresh timer for the next decision. It runs connected or not, so a locked phone costs at most 60 s a decision (was up to ~90). Reconnect grace: still `reconnectGraceMs` (60 s) per drop, now within `reconnectBudgetMs` (2 min) per player per game; time while the room is empty is not charged; budget spent means away at once on a drop; on an empty room's return graces restart only from what is left. Timers are copied into each room at creation (`RoomInfo.timers`; `turnTimeoutMs: null` switches the timer off). Protocol (still v1, fields added): `RoomInfo.timers`, `SeatInfo.awayInMs`, `turnTimeLeftMs` in `GameSnapshot` and `update` (relative ms, the client adds its own receive time). Client: `store.ts` keeps `turnDeadline` and `roomAt` on the tab's clock (`ctx.now`), `turnSecondsLeft`/`awaySecondsLeft`; the turn text shows "N s left"; the offline tag says "disconnected: N s to come back" (no more fixed "60 s"). Tests: `turnTimer.test.ts` (timer fires, resets on an action, countdowns sent, locked phone, off switch, empty room, whole game with silent players: replay matches and nothing private sent; budget over repeated drops, late notice, empty rooms, lobby unaffected), `reconnect.test.ts` grace tests now run with the timer off, `store.test.ts` (countdowns on a skewed tab clock). Playtest script checks the turn countdown and the offline tag; clean with `GRACE=1`. Notes log (two rows), `docs/protocol.md` §4/§7/§8/§10, README, `docs/next-steps.md` updated. No engine or rule change. The choice (one action, not away) is flagged for the designer as question 4.
  - P1-1 fix: `apps/web/src/savedSeats.ts` (pure: saved seats in `localStorage`, one per room and seat, newest first, at most 10, 2 days; rejoin link `#rejoin=CODE.TOKEN` built and parsed), used by `useGame.ts` (save on `welcome`, remove on `left`/`bad-token`/`room-not-found`; `offers` and `rejoin`; on `replaced` forget the tab's `sessionStorage` seat). `App.tsx`: start-screen offers ("Rejoin room KTBM as Ann", only on click, link offer first), a "Rejoin link" box with copy and a do-not-share note in the lobby and at the table. `store.ts`: `replaced` sends the tab back to the start screen with `REPLACED_NOTICE`. Tests: `savedSeats.test.ts` (save, load, remove, two rooms, malformed entries and links, expiry, cap, throwing storage), `store.test.ts` (a second tab takes the seat with the token; the old one stops). `scripts/playtest-three-tabs.mjs` now also closes Bob's tab and rejoins from the offer in a new tab (a new tab rejoins nothing by itself; each tab is its own player), and opens Cy's rejoin link in a fresh browser context (fragment cleared; the old tab shows the message, does not fight, and a refresh of it only offers). Runs clean on seeds `playtest`, `a`, `b` and `c` with `GRACE=1`. Notes log, `docs/protocol.md` §2 and the README updated. No server, protocol or engine change. P1-2 and the rest of the review are not done.
  - 7a: `docs/review-2026-11-17.md`, a prioritised list with file references. No rule bug found. P1: a player who closes their tab cannot come back (the seat token is only in `sessionStorage`, and there is no rejoin by name); one player can hold the game up (no turn timer, and every disconnect restarts the 60 s grace). P2: the server's play for an away player sails to the top-left corner, keeps drawing cards and ends on about −$220 (measured); one room that throws stops `tick` for other rooms; a restart ends every game; design points for the designer (the left starting dock has one exit, a $0 player beats anyone with fine tokens). P3: engine and server hardening, `?server=` can send the seat token to another server, missing tests (`useGame.ts`, fuzz coverage of rare branches). Nothing was fixed.
  - 6b: `scripts/playtest-three-tabs.mjs` (Playwright, three tabs of one context; create, two join by code, host starts, the whole game played by clicking only board targets and enabled buttons; also a refresh mid-game, a double click, a 4th player joining and leaving the lobby on a 390 px phone context, phone-width table checks, and with `GRACE=1` a closed tab played for after 60 s; prints the result, clicks, console/page errors; exits 1 on any problem). Runs clean on seeds `playtest`, `a`, `b`, `c` (about 125 actions each; shop, both upgrades and the Helicopter exercised). Fixes: phone buttons under 44 px; on phones the turn and buttons were below a 900 px board (now first, via grid areas); "(auto)" was put on every line of an automatic update (now only the away player's events); there was no way to tell offline from away, so `SeatInfo.away` was added (server: set when the grace ends or on `leave`, cleared on rejoin and when an empty room resumes; a `room` message is sent; automatic actions now key off it; protocol §4/§7 and notes log updated). Added: round/event/game-over banner (`bannerFor` in `store.ts`), "Your turn: …" / "Waiting for X to … (offline/away)", offline/away tags in the player table, a Dock shop panel with what each upgrade does, a Helicopter button saying what it does and the fee, readable dock names, "reconnecting…", the lobby says who it waits for (Start is disabled while someone is disconnected, as the server requires). Tests: `reconnect.test.ts` (away: after the grace, at once on `leave`, never in the lobby, cleared on rejoin and on resume), `store.test.ts` (three tabs against the real core: double sends are quiet, a dropped tab shows offline then away and is played for to the end, "(auto)" only on that player's lines; banners). No engine change, no rule change.
  - 6a: `apps/web/src`: `content.ts` (bundles `content/*.json`, compiled by the engine), `store.ts` (pure client state and how each server message changes it: `seq` and `rev` rules, `needsSync` on a gap, content-hash mismatch flag), `describe.ts` (log text and button labels), `useGame.ts` (WebSocket, auto-rejoin with backoff, seat saved in `sessionStorage` so each tab is a player; `?server=` overrides the URL), `Board.tsx` (SVG grid, clickable move/dock targets, ships, Golden Fish), `App.tsx` (start, lobby, table with round bar, players, buttons, result, log). Tests: `store.test.ts` drives the real `ServerCore` with two simulated tabs through a whole game plus a rejoin, and checks the `seq`/`rev` rules. Checked in Chromium with two tabs (create, join, start, about 25 actions, reload rejoins, no console errors). Not done (for 6b): the round-start banner (only the "Round N/20" bar with event marks), animation, a Helicopter/shop-specific layout, touch tuning, `Origin`-style hardening.
- Next stage: Milestone B, phase B1 [OPUS], continued: review P2-4 (one room's error stops `tick` for all), then P2-3 (server play for an away player; needs designer question 3), then P2-5 (a restart ends every game). Not done in the P1-2 work, on purpose. P1-2 follow-ups wait on designer question 4. The plan, the open review items, the questions for the designer and the known issues by phase are in `docs/next-steps.md`.
- All rule questions in `docs/architecture.md` section 12 are decided (2026-11-11), logged in `docs/rulebook-engine-notes.md` and written into `docs/rulebook.md`.
- Known issues and gaps (found in 6b and 5b, not fixed) are listed by Milestone B phase in `docs/next-steps.md`.
- Card counts confirmed (now in `content/cards.json`). Risk deck is 16 cards including 2 Boots (confirmed 2026-11-12); rulebook card tables show the counts. Upgrade price $200 default, test $300 in simulation.
- `assets/board/board-zones.jpg` only defines the zones (teal=1, light blue=2, dark blue=3); all other tiles come from the original `board.webp`. Golden Fish cards are per fishing spot (independent of zones). Open: final zone names.
- Art is in `assets/art/` (see its README); board image in `assets/board/`.
- Board art updated 2026-11-12 (designer's `Left_dock.pdf`, same squares; `board.json` unchanged). Its zone labels all read "SAFE ZONE 3" (placeholder).
- Round display (decided 2026-11-12, for the web client: Session 6a's bare client can show the round number; the full version is Milestone B2): the digital board hides the printed 20-space round track. Instead show a banner when each round starts ("Round 6 of 20") and a small always-visible "Round N/20" display with a slim progress bar marking the three event points (after rounds 5, 10, 15). The engine's `roundStarted` and `eventDrawn` events are enough; no engine change. Pending from the designer: a PNG export of the board with the round-track layer hidden, ideally at 2× (2756×3938); until then the web client can crop or cover the left-hand track strip.
- `docs/rulebook.md` is the single source of truth for the rules. The claude.ai rulebook doc is a copy and may be out of date; the repo wins.
