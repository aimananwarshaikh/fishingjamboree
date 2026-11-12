/**
 * Who may act and what they may do. Uses public information only, so the
 * answer is the same for the full state and for a client view.
 */
import { affordableUpgrades, helicopterUsable } from "./modifiers";
import { destinationsFor } from "./movement";
import type { Action, Engine } from "./types";

export const getActors: Engine["getActors"] = (state) => [...state.phase.actors];

export const getLegalActions: Engine["getLegalActions"] = (content, state, player) => {
  const { phase } = state;
  if (!phase.actors.includes(player)) return [];
  const ship = state.players.find((p) => p.id === player);
  if (!ship) return [];
  const helicopter: Action[] = helicopterUsable(content, state, ship)
    ? [{ type: "useHelicopter", player }]
    : [];
  switch (phase.kind) {
    case "placeShip":
      return phase.docks.map((dock): Action => ({ type: "placeShip", player, dock }));
    case "roll":
      return [{ type: "roll", player }, ...helicopter];
    case "move":
      return destinationsFor(content, state, ship, phase.roll.steps).map((d): Action => ({
        type: "move",
        player,
        to: d.to,
      }));
    case "dockShop":
      return [
        ...affordableUpgrades(content, ship).map((upgrade): Action => ({
          type: "buyUpgrade",
          player,
          upgrade,
        })),
        { type: "endTurn", player },
      ];
    case "turnEnd":
      return [...helicopter, { type: "endTurn", player }];
    case "gameOver":
      return [];
  }
};
