# Rulebook engine notes (decisions log)

Record every rule clarification the engine needs. Anything that changes how the game
plays also goes back into `docs/rulebook.md`.

| Date       | Question       | Answer                                                                                                                                                                                                                                        | Decided by    |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
|            |                |                                                                                                                                                                                                                                               |               |
| 2026-11-11 | Card counts    | Safe (18): Boot 4, +1 Fish 4, +2 Fish 4, +3 Fish 4, $100 fine 2. Risk (15): Boot 2, +3 Fish 2, $200 fine 2, $300 fish 3, $500 fish 2, $700 fish 1, Shark 3, Sinking Boat 1. Risk deck has no +1/+2 Fish. Saved in `content/card-counts.json`. | Game designer |
| 2026-11-11 | Upgrade price  | $200 by default; simulations may push it to $300 (config value).                                                                                                                                                                              | Game designer |
| 2026-11-11 | Area names     | "Shark Bay" is **Shipwreck Bay**. "Davy Jones" is **Davy Jones' Locker**. Rulebook updated.                                                                                                                                                   | Game designer |
| 2026-11-11 | Zone structure | Buoy lines divide the board into 3 safe zones and 2 risk zones (Shipwreck Bay and Davy Jones' Locker). Zone 1, 2, 3 get natural ocean names (see Zone names in `docs/rulebook.md`, proposed).                                                 | Game designer |
