# Fishing Jamboree — Rulebook

This file is the single source of truth for the game rules. Rule decisions are logged in `docs/rulebook-engine-notes.md`. The claude.ai doc (https://claude.ai/artifact/5QLudbwBmnwjgoa1AQVbdg) is a copy; if the two differ, this file wins.

## Intro

Fishing Jamboree is a race for cash for 2–4 players (up to 6 with the variant), played over 20 rounds. Sail out, catch fish, and get them back to a dock before the sea takes them. The richest fisher at the end wins.

Welcome to the fishing town for this year's season. Grab your gear, get your best bait and raise anchor to sail its rich seas. Compete against your fellow fishers to catch the best fish, and don't forget to cash in.

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

| Area                         | What happens there                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safe Zones 1, 2 and 3        | Open sea. End your move here and draw a Safe card. Buoy lines mark where one zone ends and the next begins; you can sail across them.                                                                                           |
| Fishing spots 1, 2 and 3     | Three yellow-outlined tiles, numbered 1–3. They are independent of the zones. A Golden $1000 Fish appears on spot N when the Golden Fish – Spot N event is drawn.                                                               |
| Shipwreck Bay                | The 2×4 area with the dark outline (labelled "Shark bay" on the current board art). End your move inside it and draw a Risk card.                                                                                               |
| Davy Jones' Locker           | The 5×5 area with the dark outline. End your move inside it and draw a Risk card.                                                                                                                                               |
| Island                       | Impassable. Sail around it.                                                                                                                                                                                                     |
| Starting docks (bottom pier) | Two docks. Ships start here. You can sell fish and buy upgrades here.                                                                                                                                                           |
| Cruise ship dock (top right) | One dock. You can sell fish and buy upgrades here.                                                                                                                                                                              |
| Round track (left edge)      | 20 spaces, from "First Round" at the bottom to "Final Round" at the top. The EVENT spaces are 6, 11 and 16: when the Counter moves onto one (at the end of rounds 5, 10 and 15), draw an Event card. Each event lasts 5 rounds. |

A dock holds one ship. If a dock is taken, you can't end your move on it.

## Setup

Everyone starts with $0, a basic ship (speed = the die roll, capacity = 5 fish) and no upgrades.

1. Shuffle the Safe, Risk and Event decks separately and place each face down on its spot.
2. Put the Counter token on space 1 of the round track.
3. Put the fish tokens, fine tokens, upgrade tokens and money beside the board as the bank.
4. Each player picks a ship.
5. Everyone rolls the die. Highest roll goes first, then the next highest, and so on. Tied players re-roll among themselves.
6. Player 1 places their ship on one starting dock. Player 2 places theirs on the other.
7. Players 3 and 4 wait off the board. Ships can only enter from a starting dock, never the cruise ship dock. At the start of your turn, if a starting dock is free, place your ship there (your choice if both are free), then roll and move out as normal. If neither dock is free, you miss that turn and try again next round. If you were placed but every way out of the dock is blocked, your ship stays on the dock and you miss the rest of that turn.

   Only two ships are placed before the game starts. With 4 players, round 1 goes: player 1 sails out from their dock, then player 2 sails out from theirs. Player 3 then places on a free starting dock (their choice if both are free), rolls and sails out. Then player 4 does the same. If player 1 or 2 couldn't leave their dock, there is one fewer free dock, and player 3 or 4 may have to wait.

## How to play

The game lasts 20 rounds. In a round, each player takes one turn in play order. Then move the Counter up one space, and after rounds 5, 10 and 15 draw an Event card.

### Your turn

1. **Roll** the die and add any bonuses (Speed upgrade, movement events).
2. **Move** exactly that many tiles. The one exception is docking: you may stop on a free dock early (see Movement).
3. **Resolve where you land:**
   - Open sea: draw a Safe card.
   - Inside Shipwreck Bay or Davy Jones' Locker: draw a Risk card.
   - A fishing spot with a Golden Fish on it: take the $1000 fish token instead of drawing. If your ship is full, the Golden Fish is lost: you don't get it and neither does anyone else.
   - A free dock: dock (see Docks).
4. **Resolve the card**, then put it face up on that deck's discard pile. Your turn ends.

### Movement

- Move tile by tile, up, down, left or right. No diagonals.
- You must use your whole roll, plus or minus any bonuses. Bonuses are not optional. A total of 0 or less means you don't move and your turn ends.
- You can't move through another ship or end your move on one. You can't move through the island.
- A dock can only be the last tile of your move: you can't sail through a dock, and you can't end on one someone is already using.
- You don't need the exact roll to dock. If your roll is at least the number of tiles to a free dock, you may stop there and the rest of the roll is lost. Everywhere else you must use the whole roll.
- You can't move straight from one dock to another. Go out to sea first (from the left starting dock to the right one is up, right, down: a roll of 3 or more).
- You can't step back onto the tile you just left. You may loop round and cross a tile you passed earlier in the same move, including the tile you started on.
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

To cash in you must end your move on a free dock. You need a roll that is enough to reach it, not the exact number. You don't need to be carrying fish. Docking takes your turn: you draw no card. While docked:

1. **Sell your fish.** Return every fish token to the bank and take its value in cash.
2. **Pay off fine tokens** ($100 each) from your cash, as many as it covers.
3. **Buy upgrades** if you want them.

On your next turn, sail out as normal. You can't stay docked turn after turn; if every way out is blocked, you miss that turn and nothing more happens at the dock. While you sit on a dock, no one else can land there.

### Upgrades

Buy upgrades while docked. Each costs $200 (may change to $300 after simulation; it is a config value). You can own one of each; they don't stack.

| Upgrade  | Effect                    |
| -------- | ------------------------- |
| Speed    | Move the die roll +2      |
| Capacity | Carry 8 fish instead of 5 |

### Fines

Pay a fine at once from your cash. If you can't pay all of it, pay what you can and take $100 fine tokens for the rest. Fine tokens are paid off the next time you dock. Any fine tokens left at the end of the game come off your final total.

## Card reference

The Safe deck is mostly small catches. The Risk deck mixes big fish with the worst losses in the game. Copy counts below match `content/cards.json` (`decks`).

### Safe deck (blue back)

18 cards. These copy counts are the designer's (confirmed 2026-11-11) and match `content/cards.json`.

| Card          | Effect                               | Copies |
| ------------- | ------------------------------------ | ------ |
| Boot          | 0 fish. Nothing happens.             | 4      |
| Goldfish      | +1 Fish: take one $100 fish token    | 4      |
| Headache fish | +2 Fish: take two $100 fish tokens   | 4      |
| Circus fish   | +3 Fish: take three $100 fish tokens | 4      |
| Sad Dolphin   | $100 fine                            | 2      |

### Risk deck (red back)

16 cards. There are no +1 or +2 Fish cards in the Risk deck.

| Card           | Effect                                                                                                                              | Copies |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Boot           | 0 fish. Nothing happens.                                                                                                            | 2      |
| Circus fish    | +3 Fish: take three $100 fish tokens                                                                                                | 2      |
| Swordfish      | Take one $300 fish token                                                                                                            | 3      |
| Yellowfin Tuna | Take one $500 fish token                                                                                                            | 2      |
| Red Dragon     | Take one $700 fish token                                                                                                            | 1      |
| Sadder Dolphin | $200 fine                                                                                                                           | 2      |
| Shark          | Lose 3 fish, cheapest first. With fewer than 3, lose them all.                                                                      | 3      |
| Sinking Boat   | Lose all your fish and move your ship to a free starting dock (your choice if both are free). You may buy upgrades when you arrive. | 1      |

### Event deck (yellow back)

11 cards, one copy of each.

An event's effect lasts until the next event is drawn. The round 15 event lasts until the end of the game.

| Card                                                  | Effect                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Golden Fish – Spot 1, 2 or 3 (one card each)          | Put a $1000 fish token on that numbered fishing spot. The first player to land there takes it. It counts as one fish; a full ship that lands there loses it for everyone. If no one claims it, it's removed when the next event is drawn (or at the end of the game).       |
| +1 Fish to All Catch – Zone 1, 2 or 3 (one card each) | Every fish card or Boot drawn in that zone gives one extra $100 fish (a Boot gives one fish). Capacity still applies. Fines and other cards get no bonus, and Risk cards never do: Shipwreck Bay and Davy Jones' Locker are not part of any zone.                           |
| +1 Movement                                           | Every player adds 1 to their roll                                                                                                                                                                                                                                           |
| −1 Movement                                           | Every player subtracts 1 from their roll. A roll of 1 becomes 0: you don't move, and your turn ends.                                                                                                                                                                        |
| Helicopter                                            | Lasts until the next event (or the end of the game). Once on each of your turns, either before you roll or at the end of the turn, you may pay a $200 fee and then sell all your fish without docking. You must have the $200 in cash first; it can't come out of the sale. |
| Shark Repellent                                       | Shark cards have no effect in Shipwreck Bay (they still bite in Davy Jones' Locker)                                                                                                                                                                                         |
| Tsunami                                               | Shuffle the Risk discard pile back into the Risk deck. It happens once, when drawn, and still ends the previous event                                                                                                                                                       |

## End of the game

The game ends after round 20. Each player counts their cash and subtracts $100 for every fine token they still hold. Fish still on your ship are worth nothing. Then the Golden Hook Awards are revealed and paid (below). Most money wins. If tied, it's a tie. A player removed from the game (see Online play) cannot win.

### Golden Hook Awards

At setup, without telling anyone, the game draws secret awards: **3** with 3 or 4 players, **2** with 2 players. Nobody knows which awards are in play, or how many, until the end. Two opposite awards (such as Daredevil and Landlubber) are never in the same game, and the awards in one game are worth $900 at most together.

After round 20 each award is revealed in turn and paid:

- **"Most" and "fewest" awards** go to the player with the highest (or lowest) count. Every tied player gets the full amount. A count of 0 never wins: nobody is the Boot Lord with no Boots, and nobody wins Landlubber with no Risk cards drawn.
- **Condition awards** go to every player who meets the condition.
- A player removed from the game, or one who missed their last turn (online play: away at the end), cannot be paid. If they had the winning count, that award goes unpaid: there is no second place.
- Award money is added to the final total. It does not pay off fine tokens.

| Award         | Goes to                                                        | Amount |
| ------------- | -------------------------------------------------------------- | ------ |
| Big Haul      | Most fish caught (each fish token that went onto the ship)     | $300   |
| Sea Legs      | Most tiles sailed                                              | $200   |
| Daredevil     | Most Risk cards drawn                                          | $500   |
| Shark Bait    | Most Sharks drawn (Shark Repellent or not)                     | $200   |
| Boot Lord     | Most Boots drawn, from either deck                             | $100   |
| Overstuffed   | Most fish lost to a full ship (the Golden Fish included)       | $200   |
| Dock Regular  | Most times docked (not a Sinking Boat arrival or a Helicopter) | $200   |
| Fine Print    | Most money fined (fine tokens included)                        | $200   |
| Golden Touch  | Took a Golden Fish                                             | $200   |
| Landlubber    | Fewest Risk cards drawn                                        | $300   |
| Homebody      | Fewest tiles sailed                                            | $100   |
| Stripped Down | Bought no upgrades                                             | $500   |
| One of Each?  | Bought exactly one upgrade                                     | $300   |
| Fully Loaded  | Bought both upgrades                                           | $200   |
| Clean Hands   | No fine tokens left at the end                                 | $200   |

The amounts are placeholders until the balance simulation (Milestone B6). The awards live in `content/awards.json`.

## Online play

These rules apply to the online game (decided with the designer, 2026-11-13).

- **Turn timer:** you have 90 seconds for your whole turn (rolling, moving and shopping). The screen shows how long you have left.
- **Missed turn:** if time runs out, nothing more happens that turn. Your ship stays where it is, you draw no card and buy nothing, and play passes to the next player. If you had to place a ship (at setup, entering late, or after a Sinking Boat), it goes on the first free dock.
- **Disconnected players:** a player who loses their connection has up to 60 seconds to come back (2 minutes in all per game). After that their turns are missed straight away until they return.
- **Removed players:** miss 3 turns in a row and you are removed from the game. The host can also remove a player at any time. A removed player's ship leaves the board; they get no more turns, cannot win, and cannot rejoin.
- **Last player left:** if every other player has been removed, the game ends at once and the last player wins.

## Special cases

- **Blocked:** If no legal move uses your full roll and you can't reach a free dock, you stay put and your turn ends without a card.
- **Taken dock:** You can't end your move on a dock another ship is using. Plan your roll around it.
- **Golden Fish under a ship:** If a ship is sitting on the fishing spot when the Golden Fish appears, that player doesn't get it. They must leave and land on it again.
- **Sinking Boat with both starting docks taken:** Go to the cruise ship dock. If that is taken too, stay where you are. You still lose your fish. You may buy upgrades at whichever dock you reach, on arrival only. Fine tokens stay with you. (To be playtested; should be rare.)
- **Shark with fewer than 3 fish:** Lose everything you're carrying.
- **Empty deck:** Shuffle that deck's discard pile to make a new deck.
- **Helicopter with no fish or no cash:** You can't use it. A player holding fine tokens has no cash, so can't use it either.
- **Golden Fish and a full ship:** Land on it with a full ship and it is removed. Nobody gets it.
- **Capacity:** Fish over your limit are lost, even a big one. Bonus fish from events count towards the limit.

## Example turns

**A catch.** Sam has no upgrades and carries 4 fish. He rolls a 3 and ends in open sea in Zone 1, so he draws a Safe card: +2 Fish. His ship holds 5, so he takes one $100 token and the second fish is lost.

**Docking.** Next turn the free starting dock is 3 tiles away and Sam rolls a 5, more than enough to reach it. He docks and draws no card. He holds one fine token, so he pays $100 from his fish sale. His fish were worth $1,200, so he banks $1,100, then buys the Speed upgrade for $200 and finishes with $900. From now on he moves his roll +2.

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

## Zones (from `assets/board/board-zones.jpg`)

`assets/board/board-zones.jpg` is used only to tell the three zones apart (colours below). Everything else (tiles, island, docks, fishing spots, risk areas) is traced from the original board art. Zones apply to the +1 Fish to All Catch events. Names chosen 2026-11-13 at the designer's request (calm, risk-free fishing spots); the designer may still edit them.

| Zone | Colour     | Area                                                                    | Name           |
| ---- | ---------- | ----------------------------------------------------------------------- | -------------- |
| 1    | Teal       | Shallows by the beach and the starting docks (bottom)                   | Pearl Shallows |
| 2    | Light blue | Middle: around the island and Shipwreck Bay, and the right-hand channel | Coral Haven    |
| 3    | Dark blue  | Deep water: top and top-left, around the cruise ship dock               | Sapphire Deep  |

Shipwreck Bay and Davy Jones' Locker are the two risk areas (grey). Other names considered: Kelp Reach, Windward Deep, Gull Banks, Lagoon Glades, Silverfin Sound, Open Fathoms.
