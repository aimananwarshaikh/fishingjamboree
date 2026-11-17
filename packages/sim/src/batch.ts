/**
 * Batches of games and content overrides. Pure (no I/O): the CLI and the
 * worker threads both call `runSpecs`.
 */
import type { Content, RawContent } from "@fishingjamboree/engine";
import { playGame, type GameRecord, type GameSpec } from "./play";

/**
 * One spec per game. With one bot name every seat plays it; with several, the
 * seats take them in turn and the list rotates by one each game, so every bot
 * plays every seat equally often.
 */
export function makeSpecs(options: {
  seed: string;
  players: readonly number[];
  games: number;
  bots: readonly string[];
}): GameSpec[] {
  const specs: GameSpec[] = [];
  for (const n of options.players) {
    for (let g = 0; g < options.games; g += 1) {
      const bots = Array.from(
        { length: n },
        (_, i) => options.bots[(i + g) % options.bots.length] as string,
      );
      specs.push({ seed: `${options.seed}-${n}p-${g}`, bots });
    }
  }
  return specs;
}

export function runSpecs(content: Content, specs: readonly GameSpec[]): GameRecord[] {
  return specs.map((spec) => playGame(content, spec).record);
}

/** Parses "path=value" (value as JSON, else as a string). */
export function parseOverride(text: string): { path: string[]; value: unknown } {
  const at = text.indexOf("=");
  if (at <= 0) throw new Error(`override "${text}" is not path=value`);
  const raw = text.slice(at + 1);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return { path: text.slice(0, at).split("."), value };
}

/**
 * A copy of `raw` with the overrides applied, e.g. `rules.upgrades.speed.price=300`
 * or `cards.decks.risk.shark=2`. The path must exist (a typo is an error),
 * except that a deck may get a card it did not list (`cards.decks.risk.fish+2=2`).
 * compileContent then decides whether the result is valid. The
 * original stays untouched, so the files in content/ are never changed.
 */
export function applyOverrides(raw: RawContent, overrides: readonly string[]): RawContent {
  const copy = JSON.parse(JSON.stringify(raw)) as RawContent;
  for (const text of overrides) {
    const { path, value } = parseOverride(text);
    let node: Record<string, unknown> = copy as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      const next = Array.isArray(node) ? node[Number(key)] : node[key];
      if (typeof next !== "object" || next === null) {
        throw new Error(`override "${text}": ${key} is not an object`);
      }
      node = next as Record<string, unknown>;
    }
    const last = path[path.length - 1] as string;
    const deckEntry = path.length === 4 && path[0] === "cards" && path[1] === "decks";
    if (!(last in node) && !deckEntry)
      throw new Error(`override "${text}": ${last} does not exist`);
    node[last] = value;
  }
  return copy;
}

/** Lets an override name an award by id (`awards.daredevil.amount=300`) instead of by index. */
export function normaliseAwardPaths(raw: RawContent, overrides: readonly string[]): string[] {
  return overrides.map((text) => {
    const m = /^awards\.([a-z][a-z0-9-]*)\.(\w+)=(.*)$/s.exec(text);
    if (!m || m[1] === "awards" || m[1] === "perGame") return text;
    const index = raw.awards.awards.findIndex((a) => a.id === m[1]);
    if (index < 0) throw new Error(`override "${text}": no award ${m[1]}`);
    return `awards.awards.${index}.${m[2]}=${m[3]}`;
  });
}
