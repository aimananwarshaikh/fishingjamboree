# B7 playtest kit

For the 3–4 person online playtests of Milestone B7. Hosting is the tunnel from the host's own computer
(`docs/deploy.md` §0, decided 2026-11-19); the VM route (§5) stays for later. Feedback comes back as notes
pasted into the Claude session (template at the end).

## Host: before the session

1. On your computer, from the repo, on the commit being tested:

   ```bash
   pnpm install
   pnpm --filter @fishingjamboree/web build
   ROOMS_DIR=./rooms-data pnpm start:server
   ```

   `ROOMS_DIR` keeps games across a server restart. The folder holds seat tokens: do not share it.

2. In a second terminal: `cloudflared tunnel --url http://localhost:8787`. Copy the `https://….trycloudflare.com`
   link it prints. It changes every time the tunnel starts, so keep this terminal open for the whole session.
3. Open the link yourself, enter a name, **Create a room**. Send everyone the link and the four-letter code.
4. Keep your computer awake (no sleep, lid open, on power). If it sleeps, everyone is disconnected.
5. When everyone is in the lobby and shown as connected, press **Start game**. Only the host can.

## Players: the short version (send this)

- Open the link, type your name, type the room code, **Join room**. One device or tab per player.
- Phones work. Hold the phone upright. Your turn and your buttons are at the top. The board is below them.
  Pinch or double-tap to zoom. **My ship** and **Whole board** jump the view. "Follow my turn" moves the view
  to your ship when it is your turn.
- You have **90 seconds per turn**. The timer is next to "Your turn". Run out of time before moving 3 turns in a
  row and you are removed from the game.
- If you get cut off (locked phone, closed tab, lost signal), open the link again. The start screen offers
  "Rejoin room ABCD as <name>". Tap it. You have 60 seconds per drop, 2 minutes in all per game, before your
  turns start being skipped. You can always come back after that: you only miss the turns in between.
- The **Rejoin link** box under the table is your personal way back in, for example from another device. Do not
  share it: whoever opens it takes your seat.
- When a card is drawn it flips over the middle of the board. It then stays next to the turn as "Last card".
- At the end of the game, secret **Golden Hook Awards** are revealed one at a time before the results. Wait for
  the reveal to finish.

## What to watch for

Note the round and what you saw. A screenshot helps most on phones.

| Area                           | What to check                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drawn cards (fixed in B7)**  | On a phone, while someone else plays: is the card flip easy to see and long enough to read? Does "Last card" next to the turn match it? Does waiting for the card ever feel slow?                                                                                 |
| **Turn timer**                 | Is 90 s enough on a phone, including the shop? Does the countdown match for everyone? Does anyone get a missed turn they did not expect?                                                                                                                          |
| **Missed turns and removal**   | If someone is slow or steps away: is it clear their turn was missed? After 3 timed-out turns in a row they are removed. Try it once on purpose if the group agrees. Host: try **Remove** on a player once (in the lobby or the game).                             |
| **Dropping out and rejoining** | Lock a phone for 30 s mid-game, then unlock it: does it come back by itself? Close the tab and rejoin from the start-screen offer. Try the Rejoin link on a second device once.                                                                                   |
| **Shop at $300**               | Do people buy upgrades, and when (round)? Does $300 feel too cheap or too dear? Does anyone skip both on purpose? Note who bought what. That feeds the Stripped Down / One of Each? / Fully Loaded question.                                                      |
| **Awards reveal**              | Does it feel like a payoff or a delay? Is it clear who got what and why? Did an award change the winner (note the totals before and after)? Do the amounts feel fair? Note any award that felt wrong. Kept as is for now: Stripped Down, Shark Bait at 2 players. |
| **Events and the Helicopter**  | Is the event card visible after rounds 5, 10, 15? Is the Helicopter button clear about its fee?                                                                                                                                                                   |
| **Phones in general**          | Anything cut off, too small to tap, or needing sideways scrolling. Does the board zoom get in the way?                                                                                                                                                            |
| **The game**                   | Length (minutes), who won and by how much, the moment people enjoyed most, any rule that confused someone.                                                                                                                                                        |

## Notes to paste back (one block per game)

```text
Game N — date, players (device each), minutes, winner and totals
Awards revealed: name → who (did it change the winner?)
Upgrades: who bought what, in which round
Problems: round, device, what happened, what was expected (screenshot?)
Liked / disliked:
Rule confusion:
```
