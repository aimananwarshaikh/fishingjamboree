# Bonus awards (design proposal)

Status: **idea, not decided, not built.** Proposed 2026-11-14 by the designer. Nothing here changes `docs/rulebook.md` until the open questions at the end are answered.

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

| Stat                 | Counted when                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `fishCaught`         | Each fish token that actually goes onto the ship (a +3 is 3). Fish lost to capacity are not counted. |
| `fishLostToCapacity` | Fish dropped because the ship was full.                                                              |
| `fishLostToShark`    | Fish removed by a Shark card.                                                                        |
| `tilesMoved`         | Tiles actually moved on a turn (early dock stops count only the tiles travelled).                    |
| `riskDraws`          | Risk cards drawn by this player.                                                                     |
| `sharkDraws`         | Shark cards drawn (counted even when Shark Repellent cancels the effect; it was still drawn).        |
| `bootDraws`          | Boots drawn, from either deck.                                                                       |
| `dockVisits`         | Times the player docked (including Sinking Boat arrivals? decide, see questions).                    |
| `upgradesBought`     | Derived from `upgrades`, no counter needed. Note that the count can be 0, 1 or 2.                    |
| `finesPaid`          | Total money paid in fines, tokens included.                                                          |
| `goldenFishTaken`    | Golden Fish claimed.                                                                                 |
| `turnsMissed`        | Turns skipped because blocked. Not for awards: for the simulator only.                               |

Cards the server plays for an away player count like any other play. That is a known weakness: an away player's stats are not "chosen". Awards should be skipped for a player who ended the game away (open question 6).

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

| Award       | Rule                | Why it exists                                       |
| ----------- | ------------------- | --------------------------------------------------- |
| Landlubber  | Fewest `riskDraws`  | Rewards the cautious player (safe play has a price) |
| Homebody    | Fewest `tilesMoved` | Pity for a player who got blocked a lot             |
| Light Catch | Fewest `fishCaught` | A weak pity award; keep it small                    |

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
- **Price by difficulty and by how much it distorts play.** Behaviour-pushing awards (Daredevil, Sea Legs) can pay more. Pity awards (Shark Bait, Boot Lord, Fine Print, Light Catch) should pay less, or they turn a bad game into a good one for free.
- **Per-award tuning:** each award has its own `amount` in the content file so that the simulator can tune them independently.
- **Ties:** every tied player gets the full amount, unless the stat is 0 (nobody gets an award for 0 boots). For "least" awards a tie at 0 is common and shouldn't pay. Alternative: split the amount between tied players. Decide before building (question 3).
- **A secret goal changes little in the moment.** Players don't know which awards are live, so the behaviour effect is general ("risk could pay") rather than targeted. That is fine and intended: it nudges the average play, and the surprise at the end is the fun. If more steering is wanted, see the variants.

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

1. Decide the open questions below (designer).
2. Track the stats in the engine (small, no rule change, useful for the simulator). This can happen in B1 or B6 without waiting for the awards.
3. Add the pool and the resolution at the end of the game, hidden state, protocol, tests.
4. Tune amounts with the balance simulator (B6): median winning total, how often a bonus flips the winner (aim for a minority of games, perhaps 15% to 30%), how often one player takes all three.
5. UI (B2): the end-of-game reveal, one award at a time, with the stat that won it.
6. Playtest (B7) and adjust.

## Open questions for the designer

1. **Secret, or partly revealed?** Fully secret (as proposed), count only, whole pool, or one award revealed mid-game.
2. **Number of awards per game.** 3 as proposed, or scale with players (2 players: 2 awards)?
3. **Ties:** everyone gets the full amount, or split? And is a stat of 0 ever a winner?
4. **Which awards stay in the pool.** The lists above are a draft. "Least" awards (Light Catch, Homebody) reward doing poorly; keep them small or drop them?
5. **Amounts:** one flat figure for all, or per award? Placeholder: $300 for behaviour awards, $200 for pity awards, to be tuned.
6. **Away players:** can a player the server played for win an award? Suggest no.
7. **`dockVisits`:** does a Sinking Boat arrival count as a visit?
8. **Cap:** limit one player to winning at most 2 of the 3?
9. **Name:** "Bonus awards", "Stars", "Jamboree Awards"? (Name is cosmetic; `bonuses` in content for now.)
