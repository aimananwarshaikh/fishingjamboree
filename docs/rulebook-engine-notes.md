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
| 2026-11-11 | **OPEN** Fishing spots vs zones | On the zone board, spot 1 is in dark blue (Zone 3), spots 2 and 3 are both light blue (Zone 2), and teal (Zone 1) has none. Golden Fish and +1 Catch events are per zone. Which spot belongs to which zone? | Pending |
