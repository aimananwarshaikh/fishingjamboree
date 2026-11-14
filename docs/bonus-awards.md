# Golden Hook Awards (design, decided 2026-11-14)

Status: **design decided by the designer on 2026-11-14; built in B1b (engine and server; amounts are placeholders until B6; the reveal UI is B2).** See "Decisions" below and "Built (B1b)" at the end. `docs/rulebook.md` "End of the game" has the rules as built. Until then "bonus awards" and "bonuses" in this doc mean the same thing as Golden Hook Awards.

## The idea

Mario Party style end-of-game stars. At setup the server picks 3 awards at random from a pool. Nobody is told which. At scoring time they are revealed and paid out as cash, then the winner is the player with the most cash as usual.

What it is for:

- Nudge players to take risks (Shipwreck Bay, Davy Jones' Locker) and discourage a leader from fishing safely.
- Make the upgrades a real decision (buy or not).
- Keep ships moving across the board.
- Give trailing players a chance (pity awards) and add a luck-flavoured reveal.

## How it works

1. **Setup:** pick 3 distinct awards from the pool with the seeded RNG in the state. Store them in the state, hidden from clients.
2. **During play:** the engine counts per-player stats (below). Players never see them.
3. **After round 20:** for each chosen award, work out the winner(s) from the stats, add the cash, and emit a `bonusAwarded` event. Only then are the three awards revealed to clients.
4. **Result:** the final result lists base cash, fines, and each bonus, so the screen can show a step-by-step reveal.

Fine tokens are subtracted as today. Bonus cash is added before the final ranking.

## Stats the engine must track

Plain JSON on each player, updated where the event already happens. This is the only part with a cost, and it is cheap, so it is worth doing before the awards themselves (the stats also help the balance simulator in B6).

| Stat                 | Counted when                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `fishCaught`         | Each fish token that actually goes onto the ship (a +3 is 3). Fish lost to capacity are not counted.    |
| `fishLostToCapacity` | Fish dropped because the ship was full.                                                                 |
| `fishLostToShark`    | Fish removed by a Shark card.                                                                           |
| `tilesMoved`         | Tiles actually moved on a turn (early dock stops count only the tiles travelled).                       |
| `riskDraws`          | Risk cards drawn by this player.                                                                        |
| `sharkDraws`         | Shark cards drawn (counted even when Shark Repellent cancels the effect; it was still drawn).           |
| `bootDraws`          | Boots drawn, from either deck.                                                                          |
| `dockVisits`         | Times the player docked (chosen docking only: Sinking Boat arrivals and Helicopter sales do not count). |
| `upgradesBought`     | Derived from `upgrades`, no counter needed. Note that the count can be 0, 1 or 2.                       |
| `finesPaid`          | Total money paid in fines, tokens included.                                                             |
| `goldenFishTaken`    | Golden Fish claimed.                                                                                    |
| `turnsMissed`        | Turns skipped because blocked. Not for awards: for the simulator only.                                  |

Since the online play rules (B1, P1-2), an away player's turns are missed, not played for them, so their stats only come from their own turns. A removed player (see `docs/rulebook.md`, Online play) leaves the board and cannot win, so they get no awards either. A player who is away when the game ends cannot win awards (decided).

## Candidate pool

Two kinds. **Race** awards go to whoever has the highest (or lowest) value. **Condition** awards go to every player who meets the condition.

### Race, "most"

| Award        | Rule                                       | Why it exists                                  |
| ------------ | ------------------------------------------ | ---------------------------------------------- |
| Big Haul     | Most `fishCaught`                          | Rewards volume, not only fat fish              |
| Sea Legs     | Most `tilesMoved`                          | Keeps ships moving                             |
| Daredevil    | Most `riskDraws`                           | Pulls the leader out of the safe water         |
| Shark Bait   | Most `sharkDraws` (a pity award)           | Softens bad luck                               |
| Boot Lord    | Most `bootDraws`                           | A pity award for dead draws                    |
| Overstuffed  | Most `fishLostToCapacity`                  | Pity for being full; hints at Capacity upgrade |
| Dock Regular | Most `dockVisits`                          | Rewards cashing in often                       |
| Fine Print   | Most `finesPaid`                           | Pity for Sad Dolphins                          |
| Golden Touch | Claimed a Golden Fish (any player who did) | Rewards chasing the event                      |

### Race, "least"

| Award      | Rule                | Why it exists                                       |
| ---------- | ------------------- | --------------------------------------------------- |
| Landlubber | Fewest `riskDraws`  | Rewards the cautious player (safe play has a price) |
| Homebody   | Fewest `tilesMoved` | Pity for a player who got blocked a lot             |

### Condition

| Award         | Rule                           | Why it exists                         |
| ------------- | ------------------------------ | ------------------------------------- |
| Stripped Down | Bought no upgrades             | Makes skipping upgrades viable        |
| One of Each?  | Bought exactly one upgrade     | Makes "just one" a real choice        |
| Fully Loaded  | Bought both upgrades           | Counterweight to the two above        |
| Clean Hands   | No fine tokens left at the end | Rewards paying off, not only avoiding |

Aim for roughly 12 to 16 awards so that 3 of them rarely repeat the same game and the pool still has some surprise after a few plays. Keep a few that push against each other (Daredevil vs Landlubber, Stripped Down vs Fully Loaded) so that, in aggregate, no single play style is always right. Do not draw two awards that are exact opposites in the same game (a `conflicts` list in the content file).

## Balance

The numbers below are placeholders. They need the simulator (B6) to set properly.

- **Scale:** a bonus should be big enough to change a close game, not so big that it decides every game. Start with the rule of thumb of about 10% to 15% of a typical winner's final cash. Measure the median winning total in simulation first; do not guess it.
- **Three awards at once** can pay one player three times. Cap the total bonus a single player can receive, or accept it as luck. Suggest: no cap at first, measure how often one player takes all three.
- **Price by difficulty and by how much it distorts play.** Behaviour-pushing awards (Daredevil, Sea Legs) can pay more. Pity awards (Shark Bait, Boot Lord, Fine Print) should pay less, or they turn a bad game into a good one for free.
- **Per-award tuning:** each award has its own `amount` in the content file so that the simulator can tune them independently.
- **Ties:** every tied player gets the full amount, unless the stat is 0 (nobody gets an award for 0 boots). For "least" awards a tie at 0 is common and shouldn't pay. Decided: tied players each get the full amount, and a stat of 0 never wins.
- **A secret goal changes little in the moment.** Players don't know which awards are live, so the behaviour effect is general ("risk could pay") rather than targeted. That is fine and intended: it nudges the average play, and the surprise at the end is the fun. If more steering is wanted, see the variants.

## Design goal and amount tiers (designer, 2026-11-14)

The ending should be exciting: anything could happen, and a close game can be decided by the awards. Like the longest train in Ticket to Ride or the most camels in Jaipur, an award is big enough to settle a close fight and not big enough to win the game for a player who did nothing.

- **Close games** (about $200 to $400 apart): the awards are often the deciding factor.
- **Wide gaps** (about $1000 or more): the awards should very rarely flip the result.
- Amounts are per award, from about $100 to $500, set by simulation (B6). The tiers below are placeholders.

| Tier        | Placeholder | Awards                                                                                 | Reason                                              |
| ----------- | ----------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Pity / luck | $100        | Boot Lord, Homebody                                                                    | Mostly luck, or rewards doing badly                 |
| Standard    | $200        | Sea Legs, Dock Regular, Overstuffed, Fine Print, Shark Bait, Clean Hands, Golden Touch | A side goal, or a softened bit of bad luck          |
| Strong      | $300        | Big Haul, Landlubber, One of Each?                                                     | Consistent play or a real trade-off                 |
| Major       | $500        | Daredevil, Stripped Down                                                               | Costly to chase (Sharks, Sinking Boat; no upgrades) |

- Keep a pity award below the loss it softens (a Shark costs about $300 of fish).
- **Budget rule:** when the 3 awards are drawn, cap their combined value (for example $800 to $900). Then the awards alone can never overturn a gap of about $1000.
- Simulation targets: share of games where a bonus flips the winner, flip rate by final gap (high under $400, near zero over $1000), and how often one player takes all three.

## Variants worth considering

- **Reveal one award at an event point** (after round 10, say). Players then play for it. More strategy, less surprise.
- **Reveal the count only** ("3 awards in play"), so that people know the pot exists.
- **Reveal the pool** (all candidates, not which three), so players can reason about what might be live. Cheap, adds the "what do they have" conversation.
- **Fixed number of race, fixed number of condition** (e.g. 2 race + 1 condition) so the mix feels consistent.
- **Optional rule on the lobby screen** for players who want the plain game (rulebook as today).

## Engine and server notes

- Stats and the chosen awards live in the state as plain JSON. Selection uses the seeded RNG at setup. No `Math.random`.
- Award definitions go in a new `content/bonuses.json` (id, name, text, stat, kind, amount, conflicts). Resolution logic is code, keyed by `kind` and `stat`, not per-award code, so new awards are content only.
- The state the server sends to clients must **hide the chosen awards until the game is over**. The same applies to the per-player stats. Add that to the client view projection and test it (a client must never see an award in `welcome`, `state` or `rejoin` before `gameOver`).
- `bonusAwarded` and the final result's breakdown are the only new protocol messages (`docs/protocol.md`).
- The seed is the room's, so a replay shows the same awards. If a debug tool shows the awards, it must not reach a normal client.
- Tests: each stat counts where it should (including the Repellent and capacity cases), each award picks the right winner, ties, zero stats, `conflicts`, hidden until the end, determinism by seed, and a fuzz check that bonuses never change the sum rule `final = cash − fines + bonuses`.
- The rulebook changes at "End of the game" and the notes log (`docs/rulebook-engine-notes.md`) gets each decision.

## Plan

1. ~~Decide the open questions~~ done 2026-11-14 (see Decisions). Build is phase **B1b** in `docs/build-plan.md`, after B1 and before the UI (B2); amounts are tuned in B6.
2. Track the stats in the engine (small, no rule change, useful for the simulator). This can happen in B1 or B6 without waiting for the awards.
3. Add the pool and the resolution at the end of the game, hidden state, protocol, tests.
4. Tune amounts with the balance simulator (B6): median winning total, how often a bonus flips the winner (aim for a minority of games, perhaps 15% to 30%), how often one player takes all three.
5. UI (B2): the end-of-game reveal, one award at a time, with the stat that won it.
6. Playtest (B7) and adjust.

## Decisions (designer, 2026-11-14)

1. **Fully secret.** Players are told nothing about which awards are in play, or how many, until the reveal after round 20. No mid-game reveal, no pool shown. (The count and pool variants above are rejected.)
2. **3 awards for 3 or 4 players, 2 awards for 2 players.** (The designer accepted the recommendation.)
3. **Ties:** every tied player gets the full amount. A stat of 0 never wins (nobody wins Boot Lord with no boots).
4. **Pool:** keep Landlubber, and keep Homebody at the smallest tier ($100). **Light Catch is dropped** (it rewards doing badly). Everything else in the pool stays as drafted. The pool is still a draft and can be edited in `content/awards.json`.
5. **Amounts are per award**, from about $100 to $500, tiered as above and tuned in simulation (B6).
6. **Away players cannot win awards.** A player who is away when the game ends is not eligible, and a removed player already cannot win. Their stats still count for comparison, so they can still be the "winner" of a race and the award then goes unpaid (no second place).
7. **A Sinking Boat arrival does not count as a dock visit** for Dock Regular. Neither does a Helicopter sale: only a chosen docking counts.
8. **No cap on how many awards one player wins.** The budget rule (a combined value cap on the 3 drawn awards) does the job instead.
9. **Name: Golden Hook Awards.** Chosen because it sounds like a trophy at a fishing contest, and it doesn't clash with the Golden Fish ($1000 token). In the UI, each award is "the Golden Hook for Daredevil" and so on. The content file is `content/awards.json` and the engine event is `awardGiven`. (The designer asked for a name that works for the project; change it if it doesn't feel right.)

The two choices the designer left to me, for the record: the budget rule instead of a cap (8), and Homebody kept small while Light Catch is dropped (4).

## Built (B1b, 2026-11-14)

What the build decided where this doc left room (all in `docs/rulebook-engine-notes.md`):

- **Stats are counted from the engine's own events** (`awards.ts`, `countStats`), after every action and once more at the end before scoring, so the last turn counts. They live in `state.awards.stats`, not on the public player state. `turnsMissed` is named `turnsBlocked` (it counts `blocked` and `turnSkipped`), so it is not confused with the online play missed turns. `fishCaught` does not include the Golden Fish (that is `goldenFishTaken`); a Golden Fish lost to a full ship counts in `fishLostToCapacity`.
- **The draw** picks uniformly among every valid set (no conflicting pair, within the budget), then shuffles it for the reveal order. It uses its own RNG stream, so the dice and decks are the same with or without awards.
- **"Away at the end"** (decision 6): the engine does not know who is connected, so it reads it as "missed their last turn" (`missedTurns > 0` at the end). An away player's turns are always missed, so they are covered; a connected player whose last turn ran out of time is also not paid.
- **Payout:** award money goes into the score (`PlayerScore.awards`, added to `total`), not into `cash`, so it does not pay off fine tokens and `cash` stays what was earned.
- **Golden Touch** is a condition (took at least one Golden Fish). **Fully Loaded** was not in the tier table: placed at $200 (standard).
- **Budget:** $900 for 2 and 3 awards alike. **Conflicts:** Daredevil/Landlubber, Sea Legs/Homebody, Stripped Down/Fully Loaded.
- **The last player left** (everyone else removed) is still paid the awards they qualify for; they win anyway.

## Still open (small, for the build)

- Exact pool size and final amounts: set in B6.
- The combined budget for the 3 drawn awards (suggested $800 to $900): set in B6.
- Reveal order and wording in the UI (B2).
- Whether a replay or the sim tool should be able to show the awards early (a debug flag, never for a normal client).
