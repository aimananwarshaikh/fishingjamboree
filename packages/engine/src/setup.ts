/**
 * createGame: shuffles the decks, runs the turn-order roll-off and stops at
 * the first decision (player 1 choosing a starting dock).
 */
import { buildDeck } from "./decks";
import { rollDie, seedRng } from "./rng";
import type {
  Content,
  Deck,
  DeckId,
  Engine,
  GameEvent,
  GameSetup,
  GameState,
  PlayerId,
  PlayerState,
  RngState,
  RollOffRound,
} from "./types";

/** Decks are shuffled in this order, before the roll-off (rulebook setup steps 1 and 5). */
const DECK_ORDER: readonly DeckId[] = ["safe", "risk", "event"];

export interface RollOffResult {
  /** Turn order, first player first. */
  order: PlayerId[];
  rounds: RollOffRound[];
  rng: RngState;
}

/**
 * Everyone rolls in seat order; highest goes first. Each group of tied players
 * re-rolls among themselves, groups resolved from the highest roll down, until
 * every position is decided.
 */
export function rollOff(players: readonly PlayerId[], sides: number, rng: RngState): RollOffResult {
  const rounds: RollOffRound[] = [];
  let state = rng;

  const resolve = (group: readonly PlayerId[]): PlayerId[] => {
    const rolls = group.map((player) => {
      const [die, next] = rollDie(state, sides);
      state = next;
      return { player, die };
    });
    rounds.push({ rolls });
    const values = [...new Set(rolls.map((r) => r.die))].sort((a, b) => b - a);
    const order: PlayerId[] = [];
    for (const value of values) {
      const tied = rolls.filter((r) => r.die === value).map((r) => r.player);
      order.push(...(tied.length === 1 ? tied : resolve(tied)));
    }
    return order;
  };

  const order = resolve(players);
  return { order, rounds, rng: state };
}

function newPlayer(id: PlayerId, content: Content): PlayerState {
  return {
    id,
    cash: content.rules.startingCash,
    fish: [],
    fineTokens: 0,
    upgrades: { speed: false, capacity: false },
    position: null,
  };
}

export const createGame: Engine["createGame"] = (content, setup: GameSetup) => {
  const { rules } = content;
  const { players, seed } = setup;
  if (typeof seed !== "string") throw new Error("createGame: seed must be a string");
  if (players.length < rules.minPlayers || players.length > rules.maxPlayers) {
    throw new Error(
      `createGame: ${players.length} players; this content allows ${rules.minPlayers}-${rules.maxPlayers}`,
    );
  }
  if (players.some((p) => typeof p !== "string" || p.length === 0)) {
    throw new Error("createGame: player ids must be non-empty strings");
  }
  if (new Set(players).size !== players.length) {
    throw new Error("createGame: duplicate player ids");
  }

  let rng = seedRng(seed);
  const decks = {} as Record<DeckId, Deck>;
  for (const id of DECK_ORDER) {
    const built = buildDeck(content.cards.decks[id], rng);
    decks[id] = built.deck;
    rng = built.rng;
  }

  const rolled = rollOff(players, rules.dieSides, rng);
  rng = rolled.rng;

  // compileContent guarantees at least two starting docks, so player 1 always chooses.
  const startingDocks = content.board.docks.filter((d) => d.kind === "starting").map((d) => d.id);
  const first = rolled.order[0] as PlayerId;

  const state: GameState = {
    schemaVersion: 1,
    contentHash: content.hash,
    actionCount: 0,
    players: rolled.order.map((id) => newPlayer(id, content)),
    round: 1,
    turn: { playerIndex: 0, helicopterUsed: false },
    phase: { kind: "placeShip", reason: "setup", docks: startingDocks, actors: [first] },
    decks,
    activeEvent: null,
    goldenFish: null,
    result: null,
    rng,
  };

  const events: GameEvent[] = [
    { type: "gameStarted", players: [...players], contentHash: content.hash },
    { type: "turnOrderDecided", rollOff: rolled.rounds, order: rolled.order },
  ];
  return { state, events };
};
