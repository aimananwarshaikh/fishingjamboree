# Fishing Jamboree — Rulebook

Source of truth for the game rules. Living version: https://claude.ai/artifact/5QLudbwBmnwjgoa1AQVbdg (if the two differ, the living doc wins; re-sync this file).

## Intro

Fishing Jamboree is a race for cash for 2–4 players (up to 6 with the variant), played over 20 rounds. Sail out, catch fish, and get them back to a dock before the sea takes them. The richest fisher at the end wins.

## Contents

| Component                | What it is                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Board                    | The sea, split into Safe Zones 1–3, with Shipwreck Bay, Davy Jones' Locker, the island and three docks |
| Safe deck (blue back)    | Everyday catches and small fines                                                                       |
| Risk deck (red back)     | Big fish and big dangers, drawn only in Shipwreck Bay and Davy Jones' Locker                           |
| Event deck (yellow back) | Drawn after rounds 5, 10 and 15                                                                        |
| Player ships             | One per player                                                                                         |
| Fish tokens              | $100, $300, $500, $700 and $1000                                                                       |
| Fine tokens              | $100 each, for fines you can't pay yet                                                                 |
| Upgrade tokens           | Speed and Capacity                                                                                     |
| Counter token            | Marks the current round on the round track                                                             |
| Money                    | $100 and $500 bills                                                                                    |
| Die                      | One six-sided die                                                                                      |

## The board

The board is a grid of square tiles. Most of it is open sea where you draw from the Safe deck; two outlined danger areas make you draw from the Risk deck instead.

| Area                         | What happens there                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Safe Zones 1, 2 and 3        | Open sea. End your move here and draw a Safe card. Buoy lines mark where one zone ends and the next begins; you can sail across them. |
| Fishing spots 1, 2 and 3     | The yellow-outlined tile in each zone. A Golden $1000 Fish appears here when its event is drawn.                                      |
| Shipwreck Bay                | The 2×4 area with the dark outline (labelled "Shark bay" on the current board art). End your move inside it and draw a Risk card.     |
| Davy Jones' Locker           | The 5×5 area with the dark outline. End your move inside it and draw a Risk card.                                                     |
| Island                       | Impassable. Sail around it.                                                                                                           |
| Starting docks (bottom pier) | Two docks. Ships start here. You can sell fish and buy upgrades here.                                                                 |
| Cruise ship dock (top right) | One dock. You can sell fish and buy upgrades here.                                                                                    |
| Round track (left edge)      | 20 spaces. The orange spaces (5, 10, 15) are event rounds.                                                                            |

A dock holds one ship. If a dock is taken, you can't end your move on it.

## Setup

Everyone starts with $0, a basic ship (speed = the die roll, capacity = 5 fish) and no upgrades.

1. Shuffle the Safe, Risk and Event decks separately and place each face down on its spot.
2. Put the Counter token on space 1 of the round track.
3. Put the fish tokens, fine tokens, upgrade tokens and money beside the board as the bank.
4. Each player picks a ship.
5. Everyone rolls the die. Highest roll goes first, then the next highest, and so on. Re-roll ties.
6. Player 1 places their ship on one starting dock. Player 2 places theirs on the other.
7. Players 3 and 4 wait off the board. Ships can only enter from a starting dock, never the cruise ship dock. At the start of your turn, if a starting dock is free, place your ship there, then roll and move out as normal. If neither dock is free, or every way out of the free dock is blocked, you miss that turn and try again next round.

## How to play

The game lasts 20 rounds. In a round, each player takes one turn in play order. Then move the Counter up one space, and after rounds 5, 10 and 15 draw an Event card.

### Your turn

1. **Roll** the die and add any bonuses (Speed upgrade, movement events).
2. **Move** exactly that many tiles.
3. **Resolve where you land:**
   - Open sea: draw a Safe card.
   - Inside Shipwreck Bay or Davy Jones' Locker: draw a Risk card.
   - A fishing spot with a Golden Fish on it: take the $1000 fish token instead of drawing.
   - A free dock: dock (see Docks).
4. **Resolve the card**, then put it face up on that deck's discard pile. Your turn ends.

### Movement

- Move tile by tile, up, down, left or right. No diagonals.
- You must use your whole roll, plus or minus any bonuses.
- You can't move through another ship, through the island, or onto a dock someone is already using.
- You can't step back onto the tile you just left.
- You can't end your turn on the tile you started on.
- If you can't make a legal move, you stay where you are and miss the rest of your turn.

### Catching fish

When a card gives you fish, take the matching fish tokens and keep them on your ship until you reach a dock.

- **+1, +2 or +3 Fish:** take that many $100 fish tokens.
- **$300, $500 or $700 Fish:** take one fish token of that value.
- Each token counts as one fish, whatever it is worth.

### Capacity

Your ship holds 5 fish (8 with the Capacity upgrade). If a catch would take you over, the extra fish are lost. You keep what you already had; you don't get to swap a cheap fish for a better one.

### Docks

To cash in you must land exactly on a free dock. Docking takes your turn: you draw no card. While docked:

1. **Pay off fine tokens first** ($100 each) from what you earn.
2. **Sell your fish.** Return every fish token to the bank and take its value in cash.
3. **Buy upgrades** if you want them.

On your next turn, sail out as normal. You can't stay docked turn after turn. While you sit on a dock, no one else can land there.

### Upgrades

Buy upgrades while docked. Each costs $200 (may change to $300 after simulation; it is a config value). You can own one of each; they don't stack.

| Upgrade  | Effect                    |
| -------- | ------------------------- |
| Speed    | Move the die roll +2      |
| Capacity | Carry 8 fish instead of 5 |

### Fines

Pay a fine at once from your cash. If you can't pay all of it, pay what you can and take $100 fine tokens for the rest. Fine tokens are paid off the next time you dock. Any fine tokens left at the end of the game come off your final total.

## Card reference

The Safe deck is mostly small catches. The Risk deck mixes big fish with the worst losses in the game. Copy counts are in `content/card-counts.json`.

### Safe deck (blue back)

| Card          | Effect                               | Copies |
| ------------- | ------------------------------------ | ------ |
| Boot          | 0 fish. Nothing happens.             | TBC    |
| Goldfish      | +1 Fish: take one $100 fish token    | TBC    |
| Headache fish | +2 Fish: take two $100 fish tokens   | TBC    |
| Circus fish   | +3 Fish: take three $100 fish tokens | TBC    |
| Sad Dolphin   | $100 fine                            | TBC    |

### Risk deck (red back)

| Card              | Effect                                                         | Copies |
| ----------------- | -------------------------------------------------------------- | ------ |
| Swordfish         | Take one $300 fish token                                       | TBC    |
| Yellowfin Tuna    | Take one $500 fish token                                       | TBC    |
| Red Dragon        | Take one $700 fish token                                       | TBC    |
| +1 / +2 / +3 Fish | As in the Safe deck                                            | TBC    |
| Sadder Dolphin    | $200 fine                                                      | TBC    |
| Shark             | Lose 3 fish, cheapest first. With fewer than 3, lose them all. | TBC    |
| Sinking Boat      | Lose all your fish and move your ship to a free starting dock  | TBC    |

### Event deck (yellow back)

An event's effect lasts until the next event is drawn. The round 15 event lasts until the end of the game.

| Card                                                  | Effect                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Golden Fish – Zone 1, 2 or 3 (one card each)          | Put a $1000 fish token on that zone's fishing spot. The first player to land there takes it. It counts as one fish. If no one claims it, it's removed when the next event is drawn (or at the end of the game). |
| +1 Fish to All Catch – Zone 1, 2 or 3 (one card each) | Every fish card or Boot drawn in that zone gives one extra $100 fish. Fines and other cards get no bonus.                                                                                                       |
| +1 Movement                                           | Every player adds 1 to their roll                                                                                                                                                                               |
| −1 Movement                                           | Every player subtracts 1 from their roll. A roll of 1 becomes 0: you don't move, and your turn ends.                                                                                                            |
| Helicopter                                            | Each player may pay a $200 fee first, then sell all their fish now without docking                                                                                                                              |
| Shark Repellent                                       | Shark cards have no effect in Shipwreck Bay                                                                                                                                                                     |
| Tsunami                                               | Shuffle the Risk discard pile back into the Risk deck                                                                                                                                                           |

## End of the game

The game ends after round 20. Each player counts their cash and subtracts $100 for every fine token they still hold. Fish still on your ship are worth nothing. Most cash wins. If tied, the player with fewer fine tokens wins. If still tied, share the win.

## Special cases

- **Blocked:** If no legal move uses your full roll, you stay put and your turn ends without a card.
- **Taken dock:** You can't end your move on a dock another ship is using. Plan your roll around it.
- **Golden Fish under a ship:** If a ship is sitting on the fishing spot when the Golden Fish appears, that player doesn't get it. They must leave and land on it again.
- **Sinking Boat with both starting docks taken:** Go to the cruise ship dock. If that is taken too, stay where you are. You still lose your fish. (To be playtested; should be rare.)
- **Shark with fewer than 3 fish:** Lose everything you're carrying.
- **Empty deck:** Shuffle that deck's discard pile to make a new deck.
- **Helicopter with fine tokens:** Pay off your fine tokens from the sale first.

## Example turns

**A catch.** Sam has no upgrades and carries 4 fish. He rolls a 3 and ends in open sea in Zone 1, so he draws a Safe card: +2 Fish. His ship holds 5, so he takes one $100 token and the second fish is lost.

**Docking.** Next turn Sam rolls a 5, exactly enough to reach the free starting dock. He docks and draws no card. He holds one fine token, so he pays $100 from his fish sale. His fish were worth $1,200, so he banks $1,100, then buys the Speed upgrade for $300 and finishes with $800. From now on he moves his roll +2.

## Player variants

- **2–4 players (standard):** Use the board as printed.
- **5–6 players:** Add a second dock on the top-right-most square, above the cruise ship platform, so there are four docks in total. Everything else is the same.
- There are no teams. Every fisher is out for themselves.

## Open questions

- [x] **Card counts:** confirmed 2026-11-11 (see tables)
- [ ] **Upgrade price:** $200 for now; test $300 in simulation
- [ ] **Playtest:** players 3–4 entering from the starting docks. Do too many turns get missed?
- [ ] **Playtest:** Sinking Boat when both starting docks are taken (should be rare)
- [ ] **Board art:** relabel the three "Safe zone 3" signs as Zones 1, 2 and 3 (with the names below), rename "Shark bay" to Shipwreck Bay, "Davey Jones" to Davy Jones' Locker, and mark the 5–6 player dock square
- [ ] **Fishing spot vs zone:** see the question in the decisions log (spots 1–3 vs zones 1–3)

## Zones (from `assets/board/board-zones.jpg`)

The simplified zone board is the reference for the grid and zones (colours below). Names are proposed, not final.

| Zone | Colour     | Area                                                                    | Working name   |
| ---- | ---------- | ----------------------------------------------------------------------- | -------------- |
| 1    | Teal       | Shallows by the beach and the starting docks (bottom)                   | Pearl Shallows |
| 2    | Light blue | Middle: around the island and Shipwreck Bay, and the right-hand channel | Kelp Reach     |
| 3    | Dark blue  | Deep water: top and top-left, around the cruise ship dock               | Windward Deep  |

Shipwreck Bay and Davy Jones' Locker are the two risk areas (grey). Alternate names: Gull Banks, Mistral Run, Coral Narrows, Saltmarsh Sound, Open Fathoms.
