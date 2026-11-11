/**
 * compileContent: validates the three content files and builds the indexed
 * board (docs/architecture.md section 7). Never throws on bad content; every
 * problem found is reported as a `ContentIssue`.
 */
import { hashJson } from "./hash";
import type {
  Board,
  CardsContent,
  Content,
  ContentIssue,
  DeckId,
  DockContent,
  DockInfo,
  Engine,
  FishingSpotContent,
  FishingSpotInfo,
  RawContent,
  RiskAreaId,
  RulesConfig,
  Tile,
  TileId,
} from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const RISK_AREAS: Record<string, RiskAreaId> = { S: "shipwreck-bay", J: "davy-jones-locker" };
const TERRAIN_CHARS = new Set([".", "~", "#", "D", "S", "J"]);
const ZONE_CHARS = new Set(["1", "2", "3", "-"]);
const DOCK_KINDS = new Set(["starting", "cruise"]);
const DRAW_KINDS = new Set(["fish", "fine", "shark", "sinkingBoat"]);
const EVENT_KINDS = new Set([
  "goldenFish",
  "catchBonus",
  "movement",
  "helicopter",
  "sharkRepellent",
  "reshuffleDiscard",
]);
const DECK_IDS: readonly DeckId[] = ["safe", "risk", "event"];

/** Neighbour order (up, right, down, left). Later stages rely on it for deterministic paths. */
const DIRECTIONS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

class Issues {
  readonly list: ContentIssue[] = [];
  add(path: string, message: string): void {
    this.list.push({ path, message });
  }
  /** Reports and returns false unless `v` is an integer >= `min`. */
  int(path: string, v: unknown, min = Number.NEGATIVE_INFINITY): v is number {
    if (!isInt(v)) {
      this.add(path, "must be an integer");
      return false;
    }
    if (v < min) {
      this.add(path, `must be at least ${min}`);
      return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

interface BoardSummary {
  board: Board;
  spots: Set<number>;
  zones: Set<number>;
}

function compileBoard(raw: unknown, issues: Issues): BoardSummary | null {
  if (!isObj(raw)) {
    issues.add("board", "must be an object");
    return null;
  }
  const { width, height, terrain, zones } = raw;
  if (!issues.int("board.width", width, 1) || !issues.int("board.height", height, 1)) return null;

  const gridOk = (name: string, grid: unknown, allowed: Set<string>): grid is string[] => {
    if (!Array.isArray(grid) || grid.length !== height) {
      issues.add(`board.${name}`, `must be an array of ${height} strings`);
      return false;
    }
    let ok = true;
    grid.forEach((row: unknown, y) => {
      if (typeof row !== "string" || row.length !== width) {
        issues.add(`board.${name}[${y}]`, `must be a string of ${width} characters`);
        ok = false;
        return;
      }
      for (let x = 0; x < width; x++) {
        if (!allowed.has(row[x] as string)) {
          issues.add(`board.${name}[${y}]`, `unknown character "${row[x]}" at x=${x}`);
          ok = false;
        }
      }
    });
    return ok;
  };
  if (!gridOk("terrain", terrain, TERRAIN_CHARS) || !gridOk("zones", zones, ZONE_CHARS)) {
    return null;
  }

  const tileId = (x: number, y: number): TileId => y * width + x;
  const charAt = (grid: string[], x: number, y: number): string => (grid[y] as string)[x] as string;
  const inBounds = (x: unknown, y: unknown): boolean =>
    isInt(x) && isInt(y) && x >= 0 && x < width && y >= 0 && y < height;

  // Docks.
  const docksByTile = new Map<TileId, DockContent>();
  const docks: DockInfo[] = [];
  const dockIds = new Set<string>();
  if (!Array.isArray(raw.docks)) {
    issues.add("board.docks", "must be an array");
  } else {
    raw.docks.forEach((d: unknown, i) => {
      const path = `board.docks[${i}]`;
      if (!isObj(d)) return issues.add(path, "must be an object");
      if (!isNonEmptyString(d.id)) return issues.add(`${path}.id`, "must be a non-empty string");
      if (dockIds.has(d.id)) return issues.add(`${path}.id`, `duplicate dock id "${d.id}"`);
      dockIds.add(d.id);
      if (typeof d.kind !== "string" || !DOCK_KINDS.has(d.kind)) {
        return issues.add(`${path}.kind`, 'must be "starting" or "cruise"');
      }
      if (!inBounds(d.x, d.y)) return issues.add(path, "x/y must be a tile on the board");
      const dock = d as unknown as DockContent;
      if (charAt(terrain, dock.x, dock.y) !== "D") {
        return issues.add(path, `tile (${dock.x},${dock.y}) is not a "D" tile`);
      }
      const id = tileId(dock.x, dock.y);
      if (docksByTile.has(id)) return issues.add(path, `second dock on tile (${dock.x},${dock.y})`);
      docksByTile.set(id, dock);
      docks.push({ id: dock.id, kind: dock.kind, tile: id });
    });
  }
  if (docks.filter((d) => d.kind === "starting").length < 2) {
    issues.add("board.docks", "needs at least two starting docks");
  }

  // Fishing spots.
  const spotsByTile = new Map<TileId, number>();
  const spots = new Set<number>();
  const fishingSpots: FishingSpotInfo[] = [];
  if (!Array.isArray(raw.fishingSpots)) {
    issues.add("board.fishingSpots", "must be an array");
  } else {
    raw.fishingSpots.forEach((s: unknown, i) => {
      const path = `board.fishingSpots[${i}]`;
      if (!isObj(s)) return issues.add(path, "must be an object");
      if (!issues.int(`${path}.spot`, s.spot, 1)) return;
      if (spots.has(s.spot)) return issues.add(`${path}.spot`, `duplicate spot ${s.spot}`);
      if (!inBounds(s.x, s.y)) return issues.add(path, "x/y must be a tile on the board");
      const spot = s as unknown as FishingSpotContent;
      const t = charAt(terrain, spot.x, spot.y);
      if (t !== "~" && t !== "S" && t !== "J") {
        return issues.add(path, `tile (${spot.x},${spot.y}) is not a sea or risk tile`);
      }
      const id = tileId(spot.x, spot.y);
      if (spotsByTile.has(id)) return issues.add(path, `second spot on tile (${spot.x},${spot.y})`);
      spots.add(spot.spot);
      spotsByTile.set(id, spot.spot);
      fishingSpots.push({ spot: spot.spot, tile: id });
    });
  }

  if (!isObj(raw.zoneNames) || !Object.values(raw.zoneNames).every((v) => typeof v === "string")) {
    issues.add("board.zoneNames", "must be an object of strings");
  }

  // Tiles.
  const tiles: (Tile | null)[] = [];
  const zoneSet = new Set<number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = tileId(x, y);
      const t = charAt(terrain, x, y);
      const z = charAt(zones, x, y);
      const fishingSpot = spotsByTile.get(id) ?? null;
      if (t === "~") {
        if (z === "-") issues.add(`board.zones[${y}]`, `sea tile at x=${x} has no zone`);
        const zone = Number(z);
        zoneSet.add(zone);
        tiles.push({ id, x, y, terrain: "sea", zone, fishingSpot });
        continue;
      }
      if (z !== "-") issues.add(`board.zones[${y}]`, `non-sea tile at x=${x} must have zone "-"`);
      if (t === ".") {
        tiles.push(null);
      } else if (t === "#") {
        tiles.push({ id, x, y, terrain: "island" });
      } else if (t === "D") {
        const dock = docksByTile.get(id);
        if (!dock) issues.add(`board.terrain[${y}]`, `dock tile at x=${x} has no docks entry`);
        tiles.push({ id, x, y, terrain: "dock", dock: dock?.id ?? "" });
      } else {
        tiles.push({ id, x, y, terrain: "risk", area: RISK_AREAS[t] as RiskAreaId, fishingSpot });
      }
    }
  }

  const passable = (t: Tile | null | undefined): boolean => !!t && t.terrain !== "island";
  const neighbours: TileId[][] = tiles.map((tile) => {
    if (!passable(tile)) return [];
    const { x, y } = tile as Tile;
    const out: TileId[] = [];
    for (const [dx, dy] of DIRECTIONS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (passable(tiles[tileId(nx, ny)])) out.push(tileId(nx, ny));
    }
    return out;
  });

  return {
    board: { width, height, tiles, neighbours, docks, fishingSpots },
    spots,
    zones: zoneSet,
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function checkEffect(path: string, e: unknown, issues: Issues, summary: BoardSummary | null): void {
  if (!isObj(e)) return issues.add(path, "must be an object");
  const money = (k: string) => issues.int(`${path}.${k}`, e[k], 0);
  switch (e.kind) {
    case "fish":
      issues.int(`${path}.count`, e.count, 0);
      money("value");
      return;
    case "fine":
      issues.int(`${path}.amount`, e.amount, 1);
      return;
    case "shark":
      issues.int(`${path}.count`, e.count, 1);
      return;
    case "sinkingBoat":
      return;
    case "goldenFish":
      if (issues.int(`${path}.spot`, e.spot, 1) && summary && !summary.spots.has(e.spot)) {
        issues.add(`${path}.spot`, `no fishing spot ${e.spot} on the board`);
      }
      money("value");
      return;
    case "catchBonus":
      if (issues.int(`${path}.zone`, e.zone, 1) && summary && !summary.zones.has(e.zone)) {
        issues.add(`${path}.zone`, `no zone ${e.zone} on the board`);
      }
      issues.int(`${path}.count`, e.count, 1);
      money("value");
      return;
    case "movement":
      issues.int(`${path}.delta`, e.delta);
      return;
    case "helicopter":
      money("fee");
      return;
    case "sharkRepellent":
      if (e.area !== "shipwreck-bay" && e.area !== "davy-jones-locker") {
        issues.add(`${path}.area`, 'must be "shipwreck-bay" or "davy-jones-locker"');
      }
      return;
    case "reshuffleDiscard":
      if (e.deck !== "safe" && e.deck !== "risk") {
        issues.add(`${path}.deck`, 'must be "safe" or "risk"');
      }
      return;
    default:
      issues.add(`${path}.kind`, `unknown effect kind ${JSON.stringify(e.kind)}`);
  }
}

function checkCards(raw: unknown, issues: Issues, summary: BoardSummary | null): void {
  if (!isObj(raw)) return issues.add("cards", "must be an object");
  const cards = raw.cards;
  if (!isObj(cards)) return issues.add("cards.cards", "must be an object");
  for (const [key, card] of Object.entries(cards)) {
    const path = `cards.cards.${key}`;
    if (!isObj(card)) {
      issues.add(path, "must be an object");
      continue;
    }
    if (card.id !== key) issues.add(`${path}.id`, `must equal its key "${key}"`);
    if (!isNonEmptyString(card.name)) issues.add(`${path}.name`, "must be a non-empty string");
    checkEffect(`${path}.effect`, card.effect, issues, summary);
  }

  const decks = raw.decks;
  if (!isObj(decks)) return issues.add("cards.decks", "must be an object");
  for (const key of Object.keys(decks)) {
    if (!(DECK_IDS as readonly string[]).includes(key)) {
      issues.add(`cards.decks.${key}`, "unknown deck");
    }
  }
  for (const deckId of DECK_IDS) {
    const path = `cards.decks.${deckId}`;
    const list = decks[deckId];
    if (!isObj(list)) {
      issues.add(path, "must be an object of card id to copies");
      continue;
    }
    const allowed = deckId === "event" ? EVENT_KINDS : DRAW_KINDS;
    let total = 0;
    for (const [cardId, copies] of Object.entries(list)) {
      if (!issues.int(`${path}.${cardId}`, copies, 1)) continue;
      total += copies;
      const card = cards[cardId];
      if (!isObj(card)) {
        issues.add(`${path}.${cardId}`, "unknown card");
        continue;
      }
      const kind = isObj(card.effect) ? card.effect.kind : undefined;
      if (typeof kind === "string" && !allowed.has(kind)) {
        issues.add(`${path}.${cardId}`, `a "${kind}" card cannot be in the ${deckId} deck`);
      }
    }
    if (total === 0) issues.add(path, "must contain at least one card");
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function checkRules(raw: unknown, issues: Issues): void {
  if (!isObj(raw)) return issues.add("rules", "must be an object");
  const r = raw;
  const minOk = issues.int("rules.minPlayers", r.minPlayers, 1);
  if (issues.int("rules.maxPlayers", r.maxPlayers, 1) && minOk) {
    if ((r.maxPlayers as number) < (r.minPlayers as number)) {
      issues.add("rules.maxPlayers", "must be at least minPlayers");
    }
  }
  const roundsOk = issues.int("rules.rounds", r.rounds, 1);
  if (!Array.isArray(r.eventAfterRounds)) {
    issues.add("rules.eventAfterRounds", "must be an array of round numbers");
  } else {
    let prev = 0;
    r.eventAfterRounds.forEach((n: unknown, i) => {
      const path = `rules.eventAfterRounds[${i}]`;
      if (!issues.int(path, n, 1)) return;
      if (n <= prev) issues.add(path, "must be in increasing order");
      if (roundsOk && n > (r.rounds as number)) issues.add(path, "must not exceed rules.rounds");
      prev = n;
    });
  }
  issues.int("rules.dieSides", r.dieSides, 2);
  issues.int("rules.startingCash", r.startingCash, 0);
  issues.int("rules.baseCapacity", r.baseCapacity, 1);
  issues.int("rules.fineTokenValue", r.fineTokenValue, 1);
  const up = r.upgrades;
  if (!isObj(up)) return issues.add("rules.upgrades", "must be an object");
  const speed = up.speed;
  if (!isObj(speed)) {
    issues.add("rules.upgrades.speed", "must be an object");
  } else {
    issues.int("rules.upgrades.speed.price", speed.price, 0);
    issues.int("rules.upgrades.speed.rollBonus", speed.rollBonus);
  }
  const cap = up.capacity;
  if (!isObj(cap)) {
    issues.add("rules.upgrades.capacity", "must be an object");
  } else {
    issues.int("rules.upgrades.capacity.price", cap.price, 0);
    issues.int("rules.upgrades.capacity.capacity", cap.capacity, 1);
  }
}

// ---------------------------------------------------------------------------

/** Deep copy of a JSON value, so the compiled content shares nothing with the caller. */
const copyJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const compileContent: Engine["compileContent"] = (raw: RawContent) => {
  const issues = new Issues();
  const input: unknown = raw;
  if (!isObj(input)) {
    return { ok: false, issues: [{ path: "", message: "content must be an object" }] };
  }
  const summary = compileBoard(input.board, issues);
  checkCards(input.cards, issues, summary);
  checkRules(input.rules, issues);
  if (issues.list.length > 0 || !summary) return { ok: false, issues: issues.list };

  const content: Content = {
    hash: hashJson({ board: input.board, cards: input.cards, rules: input.rules }),
    board: summary.board,
    cards: copyJson(input.cards) as CardsContent,
    rules: copyJson(input.rules) as RulesConfig,
  };
  return { ok: true, content };
};
