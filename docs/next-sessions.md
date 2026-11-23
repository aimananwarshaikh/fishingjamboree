# Next sessions: ready-to-paste prompts

Written 2026-11-23, after PR #34 (B7 part 1: the phone card fix and the playtest kit). Human playtests are on hold
for a while. These three sessions come next, in this order. Start each in a **fresh session** with the model named
in its heading, and paste the prompt as it is. Run them one at a time: each one opens a PR, and the next starts from
`origin/main` after that PR is merged.

When the human playtests happen, use the B7 part 2 prompt at the end of this file.

| Order | Session                                   | Model                        | Needs you?                                         |
| ----- | ----------------------------------------- | ---------------------------- | -------------------------------------------------- |
| 1     | Robot playtests and fixes                 | Opus                         | Only to confirm the plan and any rule change       |
| 2     | End-of-Milestone-B review, then its fixes | Fable (review), Opus (fixes) | Decisions on what the review finds                 |
| 3     | VM deploy                                 | Sonnet (networking → Opus)   | Yes: about an hour, signing up and following along |

After each session, delete its section here or mark it done, and update the CLAUDE.md Status.

## 1. Robot playtests and fixes [OPUS]

```text
This session is Milestone B, phase B7 [OPUS], part 2: robot playtests while human playtests are on hold.

Read first: CLAUDE.md (Status), docs/next-steps.md (B7), docs/playtest-b7.md ("What to watch for"), docs/rulebook.md ("Online play"), docs/protocol.md, docs/architecture.md §13–14, scripts/playtest-three-tabs.mjs, packages/sim/src/bots.ts.

Goal: find, with no people, the problems a 3–4 person online playtest would find (stuck games, lost seats, timer and missed-turn mistakes, wrong awards, broken phone layouts), and fix them by priority.

Before anything else, propose the plan and ask me to confirm it, including:
- A robot playtest script (Playwright) that plays whole games in real browser tabs against the built web client served by the server, with the sim bots choosing moves from what the UI offers (styles mixed), not random clicks.
- Scenarios: 2, 3 and 4 players; phones at 390 px (some with CPU throttling) and desktop; slow and flaky networks (latency, a dropped socket, offline for 20 s and 90 s, a locked phone); a closed tab rejoining from the offer and from the rejoin link; a player who stops playing (3 timed-out turns, removal); the host kicking a player and leaving; a rematch; a server restart mid-game with ROOMS_DIR.
- Checks per game: every tab ends on the same seq and result; nothing stuck longer than the turn timer allows; missed turns and removals match the rulebook; the awards in the result match the engine's replay of the game; no console errors; no horizontal scroll and buttons ≥ 44 px on phones; every drawn card shown on every phone.
- A soak run (e.g. 30+ games, several rooms at once) with a short report: what ran, what failed, timings.

Then:
- Run it, sort what it finds (P1 breaks a game or loses a seat, P2 wrong or confusing, P3 polish), reproduce each with a test, and fix by priority. Ask me before any rule, content or protocol change.
- Add the robot playtest to CI if it can run in a few minutes (a short profile), and document how to run the long one.

Rules:
- One PR from a new branch off origin/main; one commit per fix (the new script is its own commit). Run pnpm check and npx prettier --check . before each commit, and the playtest scripts (plain and GRACE=1) before the PR.
- Stay inside B7; note anything else under Status -> Next.
- Update docs/next-steps.md, docs/playtest-b7.md if it changes what humans should watch, docs/next-sessions.md (mark this session done) and the CLAUDE.md Status. Open the PR; do not merge.
```

## 2. End-of-Milestone-B review, then its fixes

Two sessions. The review is written by a model that did not build the code, so it reads with fresh eyes. The
fixes are a separate Opus session, after you have answered the review's questions.

### 2a. The review [FABLE]

```text
This session is an independent review at the end of Milestone B (before release 1) [FABLE]. You have not seen this code before. Do not fix anything: write the review.

Read first: CLAUDE.md, docs/rulebook.md (the single source of truth), docs/rulebook-engine-notes.md, docs/architecture.md, docs/protocol.md, docs/deploy.md, docs/bonus-awards.md, docs/balance/b6-report.md, docs/next-steps.md, and the two earlier reviews (docs/review-2026-11-17.md, the oldest, and docs/review-2026-11-14.md, the end-of-B1 review) so you do not repeat what is already listed.

Scope: everything merged after the end-of-B1 review (PRs #24 onwards: the review fixes, B2a/B2b UI and animation, B3 rematch, B4 zoom and phone layout, B5 deploy and hardening, the B5 follow-up that serves the web client, B6 bots and balance content, B7 part 1 and later B7 work), plus the open P3 list of the end-of-B1 review (docs/next-steps.md, "P3, open"): say for each whether it still applies.

Look for, in this order:
1. Rule bugs against docs/rulebook.md and the notes log (engine, and anything the client or server decides).
2. Leaks of hidden information (seed, RNG, deck order, the secret awards and stats) to any client before the result, on every path: update, snapshot, welcome, rejoin, rematch, restore, logs.
3. Ways a game gets stuck, a seat is lost, or tabs disagree (seq/rev, animation queue vs view, timers, reconnect budget, rematch, restore after a restart).
4. Server safety for a public link: limits, Origin, the HTTP file handler, saved-room files, logs, what a hostile client can send.
5. Client problems on phones and desktop: layout, zoom, animation, reduced motion, the awards reveal, accessibility basics.
6. Tests that are missing or test the wrong thing; docs that drifted from the code.

Write docs/review-<today's date>.md: a summary, then P1 (breaks a game, loses a seat, leaks, unsafe), P2 (wrong or confusing, design points for the designer), P3 (hardening, polish, tests, docs), each with file:line references, how you found it (a test you ran, a trace, a reading), and a suggested fix. Measure where you can (run the tests, the playtest script, pnpm sim, small scripts in a scratch folder) and say what you could not check. End with a short list of questions for the designer.

Rules: no code changes except the review file and its line in CLAUDE.md "Read first" and Status (review written, nothing fixed). One PR from a new branch off origin/main with that commit. Mark this review session done in docs/next-sessions.md. Open the PR; do not merge.
```

### 2b. The fixes [OPUS]

```text
This session fixes the end-of-Milestone-B review [OPUS].

Read first: CLAUDE.md (Status), the newest docs/review-*.md (the end-of-Milestone-B review), docs/rulebook.md, docs/rulebook-engine-notes.md, docs/architecture.md, docs/protocol.md, docs/next-steps.md.

Before anything else, list the review's items with what you plan for each (fix, defer, or a question for me) and ask me:
- every question the review raises for the designer;
- every fix that would change a rule, content, or the protocol.

Then fix in priority order (all P1, then P2, then the P3 items I agree to): reproduce each with a failing test first, then fix. A rule change goes in the rulebook, the notes log and tests.

Rules:
- One PR from a new branch off origin/main; one commit per review item (P3 may be grouped by area). Run pnpm check and npx prettier --check . before each commit, and the playtest scripts (plain and GRACE=1, and the robot playtest if it exists) before the PR.
- Note what is deferred in docs/next-steps.md. Update the CLAUDE.md Status and mark this session done in docs/next-sessions.md. Open the PR; do not merge.
```

## 3. VM deploy [SONNET]

Needs you at the keyboard for about an hour: you sign up for the free VM and run the commands it gives you. If
`wss` does not connect through Caddy, or anything about the network fails, stop and hand it to an Opus session
(docs/build-plan.md).

```text
This session is the VM deploy for Milestone B [SONNET]: the route in docs/deploy.md (§1 server on a free VM with Docker, Caddy and a volume; §2 web on Cloudflare Pages), never run yet.

Read first: CLAUDE.md (Status), docs/deploy.md (all of it, especially §1, §2, §3 Variables, §4 Logs, §5 "Not checked"), Dockerfile, deploy/compose.yaml, deploy/Caddyfile, deploy/.env.example, .github/workflows/ci.yml.

I will do the steps on my side (sign-ups, the VM's terminal, DNS); you cannot reach the VM. Before anything else, ask me:
1. Which free VM provider I want (docs/deploy.md's options), and whether I already have a domain or want a free one (DuckDNS).
2. Whether the web client goes on Cloudflare Pages (as planned) or is served by the server itself (one address, as with the tunnel).
3. Which OS I am on, so the commands fit.

Then walk me through it one step at a time: give me one block of commands, wait for me to paste the output, check it, then the next. Cover: creating the VM and opening ports 80/443; installing Docker; getting the repo onto the VM (it is private); filling deploy/.env from .env.example (ALLOWED_ORIGINS, TRUST_PROXY, ROOMS_DIR on the volume); docker compose up --build; Caddy getting a certificate; /health over https; a wss connection through Caddy; the web client pointing at it (VITE_SERVER_URL if on Pages); one full game from a phone on mobile data plus a desktop; a container restart that keeps the room (ROOMS_DIR); the logs.

Verify each of these explicitly and record the result: docker compose up, Caddy TLS, wss through Caddy (and through Cloudflare if it sits in front), the Origin check (a foreign Origin gets 403), restore after restart.

If wss does not connect, or any network step fails in a way the runbook does not cover, stop and write down exactly what happened (commands, output, config) in docs/next-steps.md for an Opus session; do not guess at networking changes.

Fix in the repo only what the run proves wrong (runbook steps, compose, Caddyfile, env example), one commit per fix. Update docs/deploy.md (§5 becomes "Checked on the VM", with the date and what was verified), docs/playtest-b7.md (the host steps for the deployed address), docs/next-steps.md, docs/next-sessions.md (mark this session done) and the CLAUDE.md Status. Run pnpm check and npx prettier --check . before each commit. One PR from a new branch off origin/main. Open the PR; do not merge. Never commit secrets or the filled .env.
```

## Later: B7 part 2, fixes from the human playtests [OPUS]

Use this once the human playtests have happened. Paste your notes at the end.

```text
This session is Milestone B, phase B7 [OPUS]: fixes from the 3–4 person online playtests.

Read first: CLAUDE.md (Status), docs/next-steps.md (B7), docs/playtest-b7.md, docs/rulebook.md, docs/protocol.md, docs/architecture.md §13–14, docs/balance/b6-report.md ("Left for the designer", with my 2026-11-19 answers).

Context: the phone card fix and the playtest kit are merged (PR #34), plus whatever docs/next-sessions.md marks done. Awards unchanged (3 with 3–4 players, 2 with 2); Stripped Down and Shark Bait kept, to be judged from these playtests. No engine rule change and no protocol change unless I approve it.

My playtest notes are below. First:
1. Sort them into a prioritised list (P1 breaks a game or loses a seat, P2 confusing or unfair, P3 polish), each with the likely cause and file, and mark which are rule or content questions for me (including Stripped Down, Shark Bait at 2 players, and the money paid in awards).
2. Ask me about anything unclear and every rule, content or protocol change before you touch it.

Then fix by priority: reproduce each one (a test, or the playtest script at 390 px with SHOT_DIR) before fixing it, and add a test with the fix. A rule change goes in the rulebook, docs/rulebook-engine-notes.md and tests.

Rules:
- One PR from a new branch off origin/main; one commit per fix. Run pnpm check and npx prettier --check . before each commit, and the playtest scripts (plain and GRACE=1) before the PR.
- Stay inside B7; note anything else under Status -> Next. The board PNG without the round track is still to be asked of the designer just before release 1.
- Update docs/next-steps.md and the CLAUDE.md Status. Open the PR; do not merge.

Playtest notes:
<paste here, one block per game, using the template in docs/playtest-b7.md>
```
