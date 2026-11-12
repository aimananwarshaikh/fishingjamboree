/**
 * Who may act and what they may do. Uses public information only, so the
 * answer is the same for the full state and for a client view.
 */
import { destinationsFor } from "./movement";
import type { Action, Engine } from "./types";

export const getActors: Engine["getActors"] = (state) => [...state.phase.actors];

export const getLegalActions: Engine["getLegalActions"] = (content, state, player) => {
  const { phase } = state;
  if (!phase.actors.includes(player)) return [];
  switch (phase.kind) {
    case "placeShip":
      return phase.docks.map((dock): Action => ({ type: "placeShip", player, dock }));
    case "roll":
      // TODO(Session 4): `useHelicopter` while the Helicopter event is usable.
      return [{ type: "roll", player }];
    case "move": {
      const ship = state.players.find((p) => p.id === player);
      if (!ship) return [];
      return destinationsFor(content, state, ship, phase.roll.steps).map((d): Action => ({
        type: "move",
        player,
        to: d.to,
      }));
    }
    case "dockShop":
    case "turnEnd":
      // TODO(Session 4): `buyUpgrade`, `useHelicopter`, `endTurn`. Not entered before then.
      return [];
    case "gameOver":
      return [];
  }
};
