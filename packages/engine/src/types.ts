/**
 * Fishing Jamboree engine types (Session 1, stage 1b).
 *
 * Types only: no runtime code lives here. See docs/architecture.md for the
 * reasoning. Everything in `GameState`, `PlayerView`, `Action`, `GameEvent`
 * and the content types is plain JSON (no classes, Maps, Sets, undefined or
 * functions), so it can be stored, replayed and sent over the network.
 */

// ---------------------------------------------------------------------------
// Ids and primitives
// ---------------------------------------------------------------------------

/** Chosen by the caller (the server uses seat ids such as "p1"). */
export type PlayerId = string;
/** Key into `CardsContent.cards`. */
export type CardId = string;
/** Dock id from `BoardContent.docks`, e.g. "start-left", "cruise". */
export type DockId = string;
/** Tile index: `y * board.width + x`. */
export type TileId = number;
/** Safe zone number (1, 2, 3 on the current board). */
export type ZoneId = number;
/** Fishing spot number (1, 2, 3 on the current board). */
export type SpotId = number;
/** Dollars. Always a whole number. */
export type Money = number;

export type DeckId = "safe" | "risk" | "event";
/** Decks a ship draws from when it ends a move. */
export type DrawDeckId = "safe" | "risk";
export type RiskAreaId = "shipwreck-bay" | "davy-jones-locker";
export type UpgradeId = "speed" | "capacity";
export type DockKind = "starting" | "cruise";

// ---------------------------------------------------------------------------
// Content: board (content/board.json)
// ---------------------------------------------------------------------------

/**
 * One character per tile in `BoardContent.terrain`:
 * `.` off-board, `~` open sea, `#` island, `D` dock,
 * `S` Shipwreck Bay, `J` Davy Jones' Locker.
 */
export type TerrainChar = "." | "~" | "#" | "D" | "S" | "J";

/**
 * One character per tile in `BoardContent.zones`:
 * `1`/`2`/`3` for a sea tile's safe zone, `-` for every other tile.
 */
export type ZoneChar = "1" | "2" | "3" | "-";

export interface DockContent {
  id: DockId;
  kind: DockKind;
  x: number;
  y: number;
}

export interface FishingSpotContent {
  spot: SpotId;
  x: number;
  y: number;
}

/**
 * The board as authored. Two character grids of identical size (row 0 is the
 * top of the board, column 0 the left) plus coordinate lists for the things
 * that need an id. A fishing spot is an overlay on a sea (or risk) tile: the
 * tile keeps its terrain and zone.
 */
export interface BoardContent {
  width: number;
  height: number;
  /** `height` strings of `width` `TerrainChar`s. */
  terrain: string[];
  /** `height` strings of `width` `ZoneChar`s. */
  zones: string[];
  /** Every `D` tile must appear here exactly once. */
  docks: DockContent[];
  fishingSpots: FishingSpotContent[];
  /** Display names, e.g. { "1": "Pearl Shallows" }. Not used by the rules. */
  zoneNames: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Content: cards (content/cards.json)
// ---------------------------------------------------------------------------

/**
 * Fish catch. `count` tokens of `value` each. Boot is `count: 0`; +N Fish is
 * `count: N, value: 100`; Swordfish is `count: 1, value: 300`.
 */
export interface FishEffect {
  kind: "fish";
  count: number;
  value: Money;
}

export interface FineEffect {
  kind: "fine";
  amount: Money;
}

/** Lose `count` fish, cheapest first. */
export interface SharkEffect {
  kind: "shark";
  count: number;
}

/** Lose all fish and move to a free starting dock. */
export interface SinkingBoatEffect {
  kind: "sinkingBoat";
}

/** Effects of Safe and Risk cards. */
export type DrawEffect = FishEffect | FineEffect | SharkEffect | SinkingBoatEffect;

export interface GoldenFishEffect {
  kind: "goldenFish";
  spot: SpotId;
  value: Money;
}

/** Every fish card (including Boot) drawn in `zone` gives `count` extra fish of `value`. */
export interface CatchBonusEffect {
  kind: "catchBonus";
  zone: ZoneId;
  count: number;
  value: Money;
}

export interface MovementEffect {
  kind: "movement";
  delta: number;
}

/** While active: once per own turn a player may pay `fee` from cash, then sell all fish. */
export interface HelicopterEffect {
  kind: "helicopter";
  fee: Money;
}

export interface SharkRepellentEffect {
  kind: "sharkRepellent";
  area: RiskAreaId;
}

/** Tsunami: shuffle `deck`'s discard pile back into it when the event is drawn. */
export interface ReshuffleDiscardEffect {
  kind: "reshuffleDiscard";
  deck: DrawDeckId;
}

/** Effects of Event cards. */
export type EventEffect =
  | GoldenFishEffect
  | CatchBonusEffect
  | MovementEffect
  | HelicopterEffect
  | SharkRepellentEffect
  | ReshuffleDiscardEffect;

export type CardEffect = DrawEffect | EventEffect;

export interface CardDef<TEffect extends CardEffect = CardEffect> {
  id: CardId;
  name: string;
  effect: TEffect;
}

export type DrawCardDef = CardDef<DrawEffect>;
export type EventCardDef = CardDef<EventEffect>;

/** Copies of each card in a deck. */
export type DeckList = Record<CardId, number>;

/**
 * Card definitions and deck lists. A card id may appear in more than one deck
 * (Boot and +3 Fish are in both Safe and Risk). The safe and risk decks may
 * only list cards with a `DrawEffect`; the event deck only `EventEffect`s.
 */
export interface CardsContent {
  cards: Record<CardId, CardDef>;
  decks: Record<DeckId, DeckList>;
}

// ---------------------------------------------------------------------------
// Content: rules and prices (content/rules.json)
// ---------------------------------------------------------------------------

export interface SpeedUpgradeConfig {
  price: Money;
  rollBonus: number;
}

export interface CapacityUpgradeConfig {
  price: Money;
  /** Total capacity with the upgrade (8), not the increase. */
  capacity: number;
}

export interface RulesConfig {
  minPlayers: number;
  maxPlayers: number;
  rounds: number;
  /** An event card is drawn after each of these rounds, e.g. [5, 10, 15]. */
  eventAfterRounds: number[];
  dieSides: number;
  startingCash: Money;
  baseCapacity: number;
  fineTokenValue: Money;
  /** Online play: a player who misses this many turns in a row is removed from the game. */
  missedTurnsBeforeRemoval: number;
  upgrades: {
    speed: SpeedUpgradeConfig;
    capacity: CapacityUpgradeConfig;
  };
}

// ---------------------------------------------------------------------------
// Content: bundles
// ---------------------------------------------------------------------------

/** The three JSON files as loaded, before validation. */
export interface RawContent {
  board: BoardContent;
  cards: CardsContent;
  rules: RulesConfig;
}

interface TileBase {
  id: TileId;
  x: number;
  y: number;
}

export interface SeaTile extends TileBase {
  terrain: "sea";
  zone: ZoneId;
  fishingSpot: SpotId | null;
}

export interface RiskTile extends TileBase {
  terrain: "risk";
  area: RiskAreaId;
  fishingSpot: SpotId | null;
}

export interface DockTile extends TileBase {
  terrain: "dock";
  dock: DockId;
}

export interface IslandTile extends TileBase {
  terrain: "island";
}

export type Tile = SeaTile | RiskTile | DockTile | IslandTile;

export interface DockInfo {
  id: DockId;
  kind: DockKind;
  tile: TileId;
}

export interface FishingSpotInfo {
  spot: SpotId;
  tile: TileId;
}

/** The board compiled for the engine. Derived from `BoardContent`; never stored in state. */
export interface Board {
  width: number;
  height: number;
  /** Indexed by `TileId`; `null` is off-board. */
  tiles: (Tile | null)[];
  /**
   * Indexed by `TileId`: orthogonal neighbours a ship could ever step onto
   * (on-board, not island). Dock rules and other ships are applied at move time.
   */
  neighbours: TileId[][];
  docks: DockInfo[];
  fishingSpots: FishingSpotInfo[];
}

/** Validated content, passed to every engine function. Immutable. */
export interface Content {
  /** Hash of the raw JSON; stored in state so replays detect a content mismatch. */
  hash: string;
  board: Board;
  cards: CardsContent;
  rules: RulesConfig;
}

export interface ContentIssue {
  /** JSON path of the problem, e.g. "board.terrain[4]". */
  path: string;
  message: string;
}

export type ContentResult = { ok: true; content: Content } | { ok: false; issues: ContentIssue[] };

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

/** sfc32 state: four unsigned 32-bit integers. */
export type RngState = [number, number, number, number];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: PlayerId;
  cash: Money;
  /** Value of each fish token on the ship. Length is the fish count. */
  fish: Money[];
  fineTokens: number;
  upgrades: Record<UpgradeId, boolean>;
  /** `null` while waiting off the board (before setup placement or late entry), and once removed. */
  position: TileId | null;
  /** Turns missed in a row (online play); any action of the player's own resets it. */
  missedTurns: number;
  /** Removed from the game (by the host, or after too many missed turns): no more turns, cannot win. */
  removed: boolean;
}

/** A deck as the engine holds it. `draw[0]` is the top card. */
export interface Deck {
  draw: CardId[];
  /** Face up; last element is the most recent discard. */
  discard: CardId[];
}

/** A deck as a client sees it: order hidden, size and discards public. */
export interface DeckView {
  drawCount: number;
  discard: CardId[];
}

export interface ActiveEvent {
  card: CardId;
  /** The round after which it was drawn (5, 10 or 15). */
  drawnAfterRound: number;
}

/** A Golden Fish token waiting on the board. */
export interface GoldenFishState {
  spot: SpotId;
  tile: TileId;
  value: Money;
}

export interface TurnState {
  /** Index into `players` (which is in turn order). */
  playerIndex: number;
  /** The Helicopter may be used once per turn. */
  helicopterUsed: boolean;
}

/** How the roll became a step count. `steps = max(0, die + speedBonus + eventModifier)`. */
export interface RollResult {
  die: number;
  speedBonus: number;
  eventModifier: number;
  steps: number;
}

// --- Phases ---------------------------------------------------------------

interface PhaseBase {
  /** Players who may act now. One player in every current phase; empty when the game is over. */
  actors: PlayerId[];
}

export type PlaceShipReason = "setup" | "entry" | "sinking-boat";

/** The actor chooses one of several free docks. Skipped when only one is free. */
export interface PlaceShipPhase extends PhaseBase {
  kind: "placeShip";
  reason: PlaceShipReason;
  docks: DockId[];
}

/** Start of a turn: roll, or use the Helicopter first if it is available. */
export interface RollPhase extends PhaseBase {
  kind: "roll";
}

/** The actor chooses a destination for `roll.steps`. Only entered when at least one exists. */
export interface MovePhase extends PhaseBase {
  kind: "move";
  roll: RollResult;
}

export type DockShopReason = "docked" | "sinking-boat";

/** The actor may buy upgrades, then ends the turn. Skipped when nothing is affordable. */
export interface DockShopPhase extends PhaseBase {
  kind: "dockShop";
  reason: DockShopReason;
  dock: DockId;
}

/** End of a turn, entered only when the actor could still use the Helicopter. */
export interface TurnEndPhase extends PhaseBase {
  kind: "turnEnd";
}

export interface GameOverPhase extends PhaseBase {
  kind: "gameOver";
}

export type Phase =
  PlaceShipPhase | RollPhase | MovePhase | DockShopPhase | TurnEndPhase | GameOverPhase;

export type PhaseKind = Phase["kind"];

// --- Result ---------------------------------------------------------------

export interface PlayerScore {
  player: PlayerId;
  cash: Money;
  fineTokens: number;
  /** `cash - fineTokens * fineTokenValue`. May be negative. */
  total: Money;
  /** The player was removed from the game, so cannot win. */
  removed: boolean;
}

/** `rounds`: the last round was played. `last-player`: every other player was removed. */
export type GameEndReason = "rounds" | "last-player";

export interface GameResult {
  /** In turn order. */
  scores: PlayerScore[];
  /** Highest total among players not removed. More than one player means a shared win. */
  winners: PlayerId[];
  reason: GameEndReason;
}

// --- State and view -------------------------------------------------------

/** Everything the full state and a client view have in common. */
export interface PublicState<TDeck> {
  schemaVersion: 1;
  contentHash: string;
  /** Number of actions applied so far. The server uses it as a sequence number. */
  actionCount: number;
  /** In turn order (decided by the roll-off in `createGame`). */
  players: PlayerState[];
  /** 1-based. Stays at `rules.rounds` once the game is over. */
  round: number;
  turn: TurnState;
  phase: Phase;
  decks: Record<DeckId, TDeck>;
  activeEvent: ActiveEvent | null;
  goldenFish: GoldenFishState | null;
  result: GameResult | null;
}

/** The authoritative state. Lives on the server and in the simulator only. */
export interface GameState extends PublicState<Deck> {
  rng: RngState;
}

export type Viewer = PlayerId | "spectator";

/** What a client receives: no deck order and no RNG state. */
export interface PlayerView extends PublicState<DeckView> {
  viewer: Viewer;
}

/** Functions that only need public information accept either. */
export type AnyState = GameState | PlayerView;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface GameSetup {
  /** Any string. The same seed, content and actions always give the same game. */
  seed: string;
  /** Seat order as joined; turn order is decided by the roll-off. */
  players: PlayerId[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ActionBase {
  /** The player sending the action. The server overwrites this with the seat's id. */
  player: PlayerId;
}

export interface PlaceShipAction extends ActionBase {
  type: "placeShip";
  dock: DockId;
}

export interface RollAction extends ActionBase {
  type: "roll";
}

/** Destination only: nothing happens along the path, so the engine picks one for display. */
export interface MoveAction extends ActionBase {
  type: "move";
  to: TileId;
}

export interface BuyUpgradeAction extends ActionBase {
  type: "buyUpgrade";
  upgrade: UpgradeId;
}

/** Legal in `roll` and `turnEnd` while a Helicopter event is active. */
export interface UseHelicopterAction extends ActionBase {
  type: "useHelicopter";
}

/** Legal in `dockShop` and `turnEnd`. */
export interface EndTurnAction extends ActionBase {
  type: "endTurn";
}

/** What a player can choose (`getLegalActions` returns these). */
export type PlayerAction =
  | PlaceShipAction
  | RollAction
  | MoveAction
  | BuyUpgradeAction
  | UseHelicopterAction
  | EndTurnAction;

/**
 * Online play, decided by the server and never by a client: the deciding
 * player ran out of time, so their turn is missed (nothing more happens; a
 * ship that has to be placed goes on the first dock offered).
 */
export interface MissTurnAction extends ActionBase {
  type: "missTurn";
}

/** Online play, decided by the server (host kick): `player` leaves the game for good. */
export interface RemovePlayerAction extends ActionBase {
  type: "removePlayer";
}

export type SystemAction = MissTurnAction | RemovePlayerAction;

export type Action = PlayerAction | SystemAction;

export type ActionType = Action["type"];

export type ActionErrorCode =
  "game-over" | "unknown-player" | "not-your-turn" | "wrong-phase" | "illegal-action";

export interface ActionError {
  code: ActionErrorCode;
  message: string;
}

export interface GameUpdate {
  state: GameState;
  events: GameEvent[];
}

export type ApplyResult = ({ ok: true } & GameUpdate) | { ok: false; error: ActionError };

// ---------------------------------------------------------------------------
// Events (the public log of what happened; not Event cards)
// ---------------------------------------------------------------------------

export interface RollOffRound {
  /** Players rolling in this round (everyone first, then only tied players). */
  rolls: { player: PlayerId; die: number }[];
}

export type TurnSkipReason = "no-free-starting-dock";
export type RemovalReason = "kicked" | "missed-turns";
export type BlockedReason = "zero-steps" | "no-legal-move";
export type FishLossReason = "shark" | "sinking-boat" | "overflow";
export type SaleVia = "dock" | "helicopter";
export type ReshuffleReason = "empty" | "tsunami";
export type GoldenFishRemovedReason = "event-expired" | "game-end";

export type GameEvent =
  | { type: "gameStarted"; players: PlayerId[]; contentHash: string }
  | { type: "turnOrderDecided"; rollOff: RollOffRound[]; order: PlayerId[] }
  | { type: "shipPlaced"; player: PlayerId; dock: DockId; tile: TileId; reason: PlaceShipReason }
  | { type: "roundStarted"; round: number }
  | { type: "turnStarted"; player: PlayerId; round: number }
  | { type: "turnSkipped"; player: PlayerId; reason: TurnSkipReason }
  /** The player ran out of time (online play). */
  | { type: "turnMissed"; player: PlayerId }
  /** The player is out of the game; their ship has left the board. */
  | { type: "playerRemoved"; player: PlayerId; reason: RemovalReason }
  | { type: "rolled"; player: PlayerId; roll: RollResult }
  | { type: "blocked"; player: PlayerId; reason: BlockedReason }
  /** `path` starts at `from` and ends at `to`; one legal path chosen deterministically. */
  | { type: "moved"; player: PlayerId; from: TileId; to: TileId; path: TileId[] }
  | { type: "cardDrawn"; player: PlayerId; deck: DrawDeckId; card: CardId }
  /** `kept` and `lost` include any event bonus; `bonus` says how many of the fish were bonus fish. */
  | { type: "fishGained"; player: PlayerId; kept: Money[]; lost: Money[]; bonus: number }
  | { type: "fishLost"; player: PlayerId; fish: Money[]; reason: FishLossReason }
  | { type: "sharkRepelled"; player: PlayerId; card: CardId }
  | { type: "fined"; player: PlayerId; amount: Money; paid: Money; tokensTaken: number }
  | { type: "shipRelocated"; player: PlayerId; from: TileId; to: TileId; dock: DockId }
  /** Sinking Boat with every dock taken: the ship stays where it is. */
  | { type: "relocationFailed"; player: PlayerId }
  | { type: "cardDiscarded"; deck: DrawDeckId; card: CardId }
  | { type: "docked"; player: PlayerId; dock: DockId }
  | { type: "fishSold"; player: PlayerId; fish: Money[]; total: Money; via: SaleVia }
  | { type: "fineTokensPaid"; player: PlayerId; tokens: number; amount: Money }
  | { type: "upgradeBought"; player: PlayerId; upgrade: UpgradeId; price: Money }
  | { type: "helicopterUsed"; player: PlayerId; fee: Money }
  | { type: "goldenFishPlaced"; spot: SpotId; tile: TileId; value: Money }
  | { type: "goldenFishTaken"; player: PlayerId; spot: SpotId; value: Money }
  /** A full ship landed on it: the fish is gone and nobody gets it. */
  | { type: "goldenFishLost"; player: PlayerId; spot: SpotId }
  | { type: "goldenFishRemoved"; spot: SpotId; reason: GoldenFishRemovedReason }
  | { type: "turnEnded"; player: PlayerId }
  | { type: "roundEnded"; round: number }
  | { type: "eventExpired"; card: CardId }
  | { type: "eventDrawn"; card: CardId; afterRound: number }
  | { type: "deckReshuffled"; deck: DeckId; reason: ReshuffleReason; drawCount: number }
  | { type: "gameEnded"; result: GameResult };

export type GameEventType = GameEvent["type"];

// ---------------------------------------------------------------------------
// Replays
// ---------------------------------------------------------------------------

/** Enough to reproduce a whole game: `replay(content, log)`. */
export interface ReplayLog {
  schemaVersion: 1;
  contentHash: string;
  setup: GameSetup;
  actions: Action[];
}

// ---------------------------------------------------------------------------
// Engine contract (implemented from stage 1c onwards)
// ---------------------------------------------------------------------------

export interface Engine {
  /** Validates the raw JSON and builds the indexed board. */
  compileContent(raw: RawContent): ContentResult;

  /**
   * Builds and shuffles the decks, runs the turn-order roll-off and stops at
   * the first decision (player 1 choosing a starting dock).
   * Throws only on a programming error (bad player count, duplicate ids).
   */
  createGame(content: Content, setup: GameSetup): GameUpdate;

  /** Players who may act now (`state.phase.actors`). */
  getActors(state: AnyState): PlayerId[];

  /**
   * Every action `player` may take now, fully formed; empty if it is not
   * their decision. Uses public information only, so it gives the same
   * answer for the full state and for any player's view.
   */
  getLegalActions(content: Content, state: AnyState, player: PlayerId): PlayerAction[];

  /**
   * Validates and applies one action, then runs every automatic step up to
   * the next decision. Never mutates `state` and never throws for an illegal
   * action. Also takes the system actions (`missTurn`, `removePlayer`).
   */
  applyAction(content: Content, state: GameState, action: Action): ApplyResult;

  /** Hides deck order and the RNG. Every viewer currently gets the same information. */
  redactForClient(state: GameState, viewer: Viewer): PlayerView;

  /** Re-runs a logged game. Throws if the content hash differs or an action is illegal. */
  replay(content: Content, log: ReplayLog): GameUpdate;
}
