# Rulebook engine notes (decisions log)

Record every rule clarification the engine needs. Anything that changes how the game
plays also goes back into `docs/rulebook.md`.

| Date       | Question      | Answer                                                                                                                                                                                                                                        | Decided by    |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
|            |               |                                                                                                                                                                                                                                               |               |
| 2026-11-11 | Card counts   | Safe (18): Boot 4, +1 Fish 4, +2 Fish 4, +3 Fish 4, $100 fine 2. Risk (15): Boot 2, +3 Fish 2, $200 fine 2, $300 fish 3, $500 fish 2, $700 fish 1, Shark 3, Sinking Boat 1. Risk deck has no +1/+2 Fish. Saved in `content/card-counts.json`. | Game designer |
| 2026-11-11 | Upgrade price | $200 by default; simulations may push it to $300 (config value).                                                                                                                                                                              | Game designer |
| 2026-11-11 | Area names    | "Shark Bay" is **Shipwreck Bay**. "Davy Jones" is **Davy Jones' Locker**. Rulebook updated.                                                                                                                                                   | Game designer |

| 2026-11-11 | Zone structure | Three safe zones by colour on `assets/board/board-zones.jpg`: Teal = Zone 1, Light blue = Zone 2, Dark blue = Zone 3. Two risk zones: Shipwreck Bay and Davy Jones' Locker. Docks and fishing spots are tiles on this board. Names are proposals. | Game designer |
| 2026-11-11 | Art leftovers | Keep one Swordfish card and one $700 token; alternates deleted. Shipwreck Bay / Davy Jones' Locker have no art. | Game designer |
| 2026-11-11 | Fishing spots vs zones | Independent. Golden Fish cards are per **spot** (1/2/3, as numbered on the board); the +1 Catch cards are per **zone** (colour). Zone board image is used only to separate zones; all other tiles come from the original board. | Game designer |
| 2026-11-11 | Event deck counts | One copy of each of the 11 event cards. Three are drawn per game (after rounds 5, 10, 15). | Game designer |
