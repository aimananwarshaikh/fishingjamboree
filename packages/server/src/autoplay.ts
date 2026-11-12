/**
 * The action the server takes for a player who is away (docs/protocol.md,
 * "Disconnect policy"). It keeps the game moving and does as little as
 * possible on the player's behalf: it never spends their money.
 *
 * Deterministic and based on public information only, so it needs no
 * randomness and gives nothing away.
 */
import { getLegalActions } from "@fishingjamboree/engine";
import type { Action, AnyState, Content, PlayerId } from "@fishingjamboree/engine";

export function chooseAutoAction(
  content: Content,
  state: AnyState,
  player: PlayerId,
): Action | null {
  const legal = getLegalActions(content, state, player);
  const first = legal[0];
  if (!first) return null;
  switch (state.phase.kind) {
    case "roll":
      // Never the Helicopter: it costs a fee.
      return legal.find((a) => a.type === "roll") ?? first;
    case "move": {
      // Stay out of Shipwreck Bay and Davy Jones' Locker when there is another way.
      const calm = legal.find(
        (a) => a.type === "move" && content.board.tiles[a.to]?.terrain !== "risk",
      );
      return calm ?? first;
    }
    case "dockShop":
    case "turnEnd":
      // Never buys an upgrade or uses the Helicopter.
      return legal.find((a) => a.type === "endTurn") ?? first;
    default:
      // placeShip: the first free dock.
      return first;
  }
}
