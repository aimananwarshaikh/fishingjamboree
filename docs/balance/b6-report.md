# B6 balance report (2026-11-17)

What the simulator measured, what was changed in `content/*.json` (one commit each, numbers in each commit message) and what is left for the designer. The full output of the final run is in `sim-final-mix.md`. The content as it was before B6 is in `original-content/` (restore a file by copying it back, or revert its commit).

**Read these numbers as direction, not proof.** Bots are simple heuristics, not people. They never chase a secret award (nobody can see the awards), and they buy upgrades whenever their style says so. Upgrade awards (Stripped Down, One of Each?, Fully Loaded) and the style results depend most on how the bots were written. B7 playtests check this with people.

## Targets (designer, 2026-11-17)

| Target                                                                                                  | Source                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------- |
| Each seat wins within ±5 points of an even share                                                        | answer to question 1   |
| No single style wins more than 40% (mixed tables)                                                       | answer to question 1   |
| The winner usually ends above $0                                                                        | answer to question 1   |
| Each award about 10–15% of the median winning total; $100–$500; budget about $800–$900                  | `docs/bonus-awards.md` |
| Awards change the winner in 15–30% of games: often when the gap is under $400, almost never over $1,000 | `docs/bonus-awards.md` |
| A drawn award pays someone in most games (70%+)                                                         | answer to question 1   |
| Skill against luck, game length                                                                         | report only            |

## Method

- `packages/sim`: four bots, all deterministic from a seed. They see only the redacted `PlayerView` and choose from `getLegalActions`.
  - **random**: picks a legal action uniformly.
  - **greedy**: chooses the landing with the best expected value. The card odds are the deck lists minus the public discard pile. A catch counts only if the ship can still get home before the end. Goes home at $600 or with a full hold, and buys Capacity, then Speed, until round 14.
  - **cautious**: avoids Risk tiles and goes home at $300 or 60% full. Buys only Capacity, until round 10.
  - **risk-taker**: Risk landings are worth +$150 to it, it weighs losses at half and drifts towards the risk areas. Goes home at $800 or full. Buys Speed, then Capacity.
- Mixed tables: the bots `greedy,cautious,risk-taker` rotate over the seats each game (`makeSpecs`). With 4 players, one style sits twice. The roll-off decides turn order, so "seat" below means the place in turn order.
- Awards are priced on recorded games. Play never depends on the awards: they are secret, use their own RNG stream, and the bots can't see them. So any amounts, budget or definitions are resolved from the recorded stats with the engine's `resolveAward`, and each game is averaged exactly over every set the engine could draw (`awardsEval.ts`).
- Runs: 2,000 games per player count (2, 3, 4), about 25 s on 3 worker threads.

## What changed (all in content; no engine rule change)

| Commit                    | Before → after                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Raise both upgrade prices | $200 → **$300**                                                                              |
| Award amounts and budget  | $100–$500 → **$100–$300**; budget $900 → **$800** (amounts in the rulebook table)            |
| Landlubber                | "Fewest Risk cards drawn" (`least`) → **"Drew no Risk cards"** (`condition`, `max: 0`), $200 |
| Pool                      | 15 → **13** awards: Golden Touch and Clean Hands dropped                                     |
| Card counts               | **no change** (see the sensitivity check)                                                    |

## Results on the final content

`pnpm sim --games 2000 --bots greedy,cautious,risk-taker --seed b6-final` (full output: `sim-final-mix.md`), and `--bots greedy` for tables of equal players.

### Seats (target ±5 points): met

| Players | Mixed styles, win rate by turn order | Greedy only               |
| ------- | ------------------------------------ | ------------------------- |
| 2       | 50.6 / 49.4                          | 50.3 / 49.6               |
| 3       | 33.4 / 33.5 / 33.1                   | 33.6 / 32.8 / 33.6        |
| 4       | 24.8 / 26.4 / 25.2 / 23.6            | 27.6 / 24.8 / 24.5 / 23.1 |

The largest gap in any run was +4.4 (greedy only, 3 players, $300, an earlier seed). Going first is worth at most about 2–3 points.

### Styles (target: none above 40%): met

| Players (even share) | greedy | cautious | risk-taker |
| -------------------- | ------ | -------- | ---------- |
| 2 (50%)              | 51.7%  | 52.8%    | 45.6%      |
| 3 (33.3%)            | 34.7%  | 36.2%    | 29.0%      |
| 4 (25%)              | 25.2%  | 26.8%    | 23.0%      |

At the old $200 price greedy led by up to 10 points (3 players: 37.8 / 27.4 / 34.7). At $300 the gap is 4–7 points (3–4 on the seeds used for the price commit). That is why the price moved: a cheap upgrade pays back fastest for the player who fishes hardest.

### Scores (target: winner above $0): met

| Players | Winner's final total, median (p10–p90) | Winner above $0 | Results below $0 | Shared wins |
| ------- | -------------------------------------- | --------------- | ---------------- | ----------- |
| 2       | $1,800 ($1,200–$2,600)                 | 100%            | 0.6%             | 4.1%        |
| 3       | $2,000 ($1,500–$2,700)                 | 100%            | 0.9%             | 5.4%        |
| 4       | $2,000 ($1,500–$2,700)                 | 100%            | 1.1%             | 7.9%        |

Random bots, for contrast: median player total −$100, about 30% of results below $0, and the winner is above $0 in 83–98% of games.

### Skill and length (report only)

- **Skill matters a lot.** Greedy against random wins 97.8% of 2-player games. With 4 players, greedy (2 seats) wins 49.7% and random wins 0.3%.
- **Length:** 88 / 132 / 175 actions per game for 2 / 3 / 4 players (about 4.4 actions per turn: roll, move, sometimes the shop or the Helicopter). A ship is stuck (no legal move) on 0.2–0.3 turns per game.
- **Play per player (mixed, 3 players):** Capacity bought by 89%, Speed by 57%, none by 5%. 4.2 dock visits, 3.2 Risk cards, $212 fined, 0.06 fine tokens left at the end. Helicopter used 0.23 times. Per game: 0.8 Golden Fish placed, 0.5 taken, almost never lost to a full ship; 0.4 Sinking Boats.

### Golden Hook Awards

The median winning total before awards is $1,650 (2 players) and $1,800 (3 and 4), so 10–15% is $165–$270. The amounts are $100–$300 (three at $300, seven at $200, three at $100).

| Award         | Amount | 2p drawn / pays | 3p drawn / pays | 4p drawn / pays |
| ------------- | ------ | --------------- | --------------- | --------------- |
| Big Haul      | $300   | 16% / 100%      | 25% / 100%      | 25% / 100%      |
| Sea Legs      | $200   | 15% / 100%      | 21% / 100%      | 21% / 100%      |
| Daredevil     | $300   | 15% / 83%       | 21% / 100%      | 21% / 100%      |
| Shark Bait    | $200   | 16% / 60%       | 25% / 85%       | 25% / 90%       |
| Boot Lord     | $100   | 16% / 100%      | 25% / 100%      | 25% / 100%      |
| Overstuffed   | $200   | 16% / 84%       | 25% / 96%       | 25% / 99%       |
| Dock Regular  | $200   | 16% / 100%      | 25% / 100%      | 25% / 100%      |
| Fine Print    | $200   | 16% / 100%      | 25% / 100%      | 25% / 100%      |
| Landlubber    | $200   | 15% / 84%       | 21% / 98%       | 21% / 99%       |
| Homebody      | $100   | 15% / 100%      | 21% / 100%      | 21% / 100%      |
| Stripped Down | $300   | 15% / 9%        | 21% / 16%       | 21% / 26%       |
| One of Each?  | $200   | 16% / 74%       | 25% / 98%       | 25% / 97%       |
| Fully Loaded  | $100   | 15% / 85%       | 21% / 95%       | 21% / 96%       |

| Players | Award money per game | Winner changed (target 15–30%) | One player paid by every drawn award |
| ------- | -------------------- | ------------------------------ | ------------------------------------ |
| 2       | $351                 | 11.3% (below)                  | 39.9%                                |
| 3       | $631                 | 17.4%                          | 12.3%                                |
| 4       | $713                 | 19.1%                          | 9.6%                                 |

Winner changed, by the gap between first and second before awards:

| Gap       | 2 players | 3 players | 4 players |
| --------- | --------- | --------- | --------- |
| $0 (tied) | 82%       | 85%       | 82%       |
| $100–$200 | 35%       | 39%       | 39%       |
| $300–$400 | 12%       | 15%       | 13%       |
| $500–$900 | 1%        | 2%        | 1%        |
| $1,000+   | 0%        | 0%        | 0%        |

Against the placeholders on the same games: money per game was $395 / $720 / $835 (2/3/4 players), and the winner changed in 11.4% / 18.2% / 18.8% of games. The budget drew Daredevil and Stripped Down about half as often as the others (draw rate 11–24%); it is now 21–25% for every award with 3–4 players. Landlubber paid in 1–16% of games, Golden Touch in 37–48%, and Clean Hands paid almost every player in every game.

### Card counts: no change

Mixed styles, $300 upgrades, 1,500 games each with 3 and 4 players. The values are the largest seat gap from an even share and the win rates greedy / cautious / risk-taker:

| Variant          | 3 players               | 4 players               |
| ---------------- | ----------------------- | ----------------------- |
| as is            | 1.6; 33.5 / 34.9 / 31.6 | 2.1; 22.5 / 26.6 / 25.9 |
| Sharks 3 → 2     | 2.7; 33.6 / 30.9 / 35.5 | 1.5; 24.4 / 24.6 / 26.0 |
| Sharks 3 → 4     | 2.6; 32.3 / 36.8 / 30.9 | 2.3; 24.7 / 27.3 / 23.0 |
| Safe Boots 4 → 3 | 0.7; 32.8 / 34.1 / 33.0 | 1.8; 24.4 / 26.6 / 23.9 |
| Safe Boots 4 → 5 | 1.7; 32.5 / 31.2 / 36.3 | 2.7; 25.4 / 24.1 / 25.5 |
| $200 fines 2 → 1 | 0.9; 32.5 / 31.5 / 36.1 | 1.2; 24.0 / 22.4 / 28.6 |

Every variant meets the targets, and the shifts are within noise (about ±1.7 points at 1,500 games). The designer's counts stay. More Sharks favour the careful player and fewer favour the risk-taker, as expected. (A deck entry cannot be set to 0: `compileContent` requires at least 1.)

## Left for the designer (not changed)

Designer's answers (2026-11-19, B7): 1 kept as is (3 awards with 3–4 players, 2 with 2); 2 Stripped Down kept, to be watched in the playtests; 3 Shark Bait kept at 2 players.

1. **2-player games: the awards change the winner in only 11%** (target 15–30%), and one player takes both awards in 40% of games. Drawing 3 awards with 2 players as well (`awards.perGame.2: 3`, content only) gives 12.5%, with one player taking all of them in 17% (money per game $528). The rulebook decision is 2 awards with 2 players, so this was not changed. Bigger amounts would raise the flip rate but go past the 10–15% rule.
2. **Stripped Down pays in 9–26% of games.** The bots almost always buy Capacity. People may not; playtests will show. Options: keep it ($300, a real trade-off), make it "Bought no Speed upgrade", or drop it.
3. **Shark Bait pays in 60% of 2-player games** (85–90% with 3–4). Two players draw fewer Risk cards between them. Keep it, or leave it out of 2-player draws (that needs per-count pools: an engine change).
4. **Golden Touch could return** if the Golden Fish became more common (more Golden Fish event cards, a card-count change). As is, about a third of games have no Golden Fish at all.
5. **A total of about $630–$710 is paid per 3–4 player game.** Each award is 6–18% of the median winner's total, but several awards pay more than one player (ties, conditions). That is within the design ("big enough to change a close game"). Flag it if it feels like too much money at the table.
6. **Removed players and "fewest" awards** (review P2-4): unchanged. A removed player still counts in Homebody, so an early removal makes Homebody pay nobody. Landlubber is now a condition, so it is no longer affected.

## Reproduce

```bash
pnpm sim --games 2000 --bots greedy,cautious,risk-taker --seed b6-final --save runs/final.json
```

```bash
pnpm sim --games 2000 --content docs/balance/original-content --bots greedy,cautious,risk-taker
```

```bash
pnpm sim --load runs/final.json --set awards.big-haul.amount=250 --set awards.budget=700
```

`--set` takes any content path (`rules.upgrades.speed.price=300`, `cards.decks.risk.shark=2`, `awards.<id>.amount=…`, `awards.budget=…`), `--awards FILE` replaces the whole awards file, and `--load` re-prices awards on saved games without replaying them. `runs/` is git-ignored. All options are listed at the top of `packages/sim/src/cli.ts`.
