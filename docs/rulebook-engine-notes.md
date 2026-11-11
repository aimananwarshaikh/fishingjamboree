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
| 2026-11-11 | Helicopter | A lasting event (until the next event or game end), not instant. Once per own turn, at the start or the end of the turn, a player may pay $200 and sell all their fish. The fee must be paid from cash on hand first; it cannot come out of the sale. | Game designer |
| 2026-11-11 | Sinking Boat | Lose all fish and move to a starting dock. The player may buy upgrades there before sailing out. | Game designer |
| 2026-11-11 | Docking | Exact landing, no fish needed. A ship cannot move straight from one dock to another; it must go out to sea first (left starting dock to right starting dock is up, right, down: 3 steps). | Game designer |
| 2026-11-11 | End of game | Only money decides the winner. A tie is a tie; fine tokens are not a tie-break. Rulebook needs updating. | Game designer |
| 2026-11-11 | Empty deck | Shuffle the discard pile back in. Deck and discard cannot both be empty. | Game designer |
| 2026-11-11 | Golden Fish, full ship | A full ship that lands on the Golden Fish picks it up and loses it; nobody gets it. | Game designer |
| 2026-11-11 | Ending on another ship | A move cannot end on a tile with another ship. | Game designer |
| 2026-11-11 | Open rule questions | Proposed answers awaiting the designer are in `docs/architecture.md` section 12. | Engine design (1b) |
