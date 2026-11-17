/**
 * Balance simulator CLI (B6). Run from the repo root:
 *
 *   pnpm sim --games 1000 --players 2,3,4 --bots greedy,cautious,risk-taker,random
 *   pnpm sim --set rules.upgrades.speed.price=300 --set rules.upgrades.capacity.price=300
 *   pnpm sim --save runs/base.json             # keep the game records
 *   pnpm sim --load runs/base.json --awards proposal.json   # re-price awards, no replay
 *
 * Options:
 *   --games N          games per player count (default 1000)
 *   --players 2,3,4    player counts (default 2,3,4)
 *   --bots a,b,...     bot per seat, rotating each game (default greedy); known: random,
 *                      greedy, cautious, risk-taker
 *   --seed S           seed prefix (default "sim")
 *   --set path=value   content override, repeatable (rules.*, cards.decks.*, awards.budget,
 *                      awards.<id>.amount); content/*.json is never written
 *   --awards FILE      use this awards.json instead (only the report; play does not depend on it)
 *   --content DIR      content folder (default: the repo's content/)
 *   --workers N        worker threads (default: CPUs − 1, at most 8; 1 = no threads)
 *   --save FILE        write the game records as JSON
 *   --load FILE        read game records instead of playing (with --awards / award --set only)
 *   --json FILE        write the report as JSON
 *   --out FILE         write the report text to FILE as well as stdout
 */
import { availableParallelism } from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { AwardsContent, RawContent } from "@fishingjamboree/engine";
import { applyOverrides, makeSpecs, normaliseAwardPaths, runSpecs } from "./batch";
import { BOT_NAMES } from "./bots";
import { compileOrThrow, readRawContent } from "./content";
import type { GameRecord, GameSpec } from "./play";
import { buildReport, formatReport } from "./report";

const here = dirname(fileURLToPath(import.meta.url));
const userDir = process.env.INIT_CWD ?? process.cwd();
const fromUser = (p: string) => resolve(userDir, p);

interface Options {
  games: number;
  players: number[];
  bots: string[];
  seed: string;
  sets: string[];
  awards?: string;
  content: string;
  workers: number;
  save?: string;
  load?: string;
  json?: string;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    games: 1000,
    players: [2, 3, 4],
    bots: ["greedy"],
    seed: "sim",
    sets: [],
    content: resolve(here, "../../../content"),
    workers: Math.max(1, Math.min(8, availableParallelism() - 1)),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;
    if (flag === "--") continue;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--games":
        o.games = Number(value());
        break;
      case "--players":
        o.players = value().split(",").map(Number);
        break;
      case "--bots":
        o.bots = value().split(",");
        break;
      case "--seed":
        o.seed = value();
        break;
      case "--set":
        o.sets.push(value());
        break;
      case "--awards":
        o.awards = fromUser(value());
        break;
      case "--content":
        o.content = fromUser(value());
        break;
      case "--workers":
        o.workers = Number(value());
        break;
      case "--save":
        o.save = fromUser(value());
        break;
      case "--load":
        o.load = fromUser(value());
        break;
      case "--json":
        o.json = fromUser(value());
        break;
      case "--out":
        o.out = fromUser(value());
        break;
      default:
        throw new Error(
          `unknown option ${flag} (see the comment at the top of packages/sim/src/cli.ts)`,
        );
    }
  }
  if (!Number.isInteger(o.games) || o.games < 1)
    throw new Error("--games must be a positive whole number");
  if (!Number.isInteger(o.workers) || o.workers < 1)
    throw new Error("--workers must be at least 1");
  for (const b of o.bots) {
    if (!BOT_NAMES.includes(b))
      throw new Error(`unknown bot "${b}" (known: ${BOT_NAMES.join(", ")})`);
  }
  return o;
}

function runInWorkers(raw: RawContent, specs: GameSpec[], workers: number): Promise<GameRecord[]> {
  const chunks: GameSpec[][] = Array.from({ length: workers }, () => []);
  specs.forEach((s, i) => chunks[i % workers]?.push(s));
  const url = new URL("./worker.ts", import.meta.url);
  return Promise.all(
    chunks
      .filter((c) => c.length > 0)
      .map(
        (chunk) =>
          new Promise<GameRecord[]>((done, fail) => {
            const w = new Worker(url, {
              workerData: { raw, specs: chunk },
              execArgv: ["--import", "tsx"],
            });
            w.once("message", (records: GameRecord[]) => done(records));
            w.once("error", fail);
            w.once("exit", (code) => code !== 0 && fail(new Error(`worker exited with ${code}`)));
          }),
      ),
  ).then((parts) => {
    // Put the records back in spec order so a run is the same with any number of workers.
    const bySeed = new Map(parts.flat().map((r) => [r.seed, r]));
    return specs.map((s) => bySeed.get(s.seed) as GameRecord);
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const original = readRawContent(o.content);
  const sets = normaliseAwardPaths(original, o.sets);
  const raw = applyOverrides(original, sets);
  if (o.awards) raw.awards = JSON.parse(readFileSync(o.awards, "utf8")) as AwardsContent;
  compileOrThrow(raw);

  const started = performance.now();
  let records: GameRecord[];
  let note: string;
  if (o.load) {
    const playSets = sets.filter((s) => !s.startsWith("awards."));
    if (playSets.length > 0)
      throw new Error(`--load re-prices awards only; drop ${playSets.join(", ")}`);
    records = JSON.parse(readFileSync(o.load, "utf8")) as GameRecord[];
    note = `Records loaded from ${o.load}; awards re-evaluated.`;
  } else {
    const specs = makeSpecs(o);
    records =
      o.workers > 1 && specs.length >= 50
        ? await runInWorkers(raw, specs, o.workers)
        : runSpecs(compileOrThrow(raw), specs);
    note = `Played in ${((performance.now() - started) / 1000).toFixed(1)} s on ${o.workers} worker(s). Seed prefix "${o.seed}".`;
  }
  if (o.save) {
    mkdirSync(dirname(o.save), { recursive: true });
    writeFileSync(o.save, JSON.stringify(records));
  }
  const report = buildReport(records, raw.awards, o.bots.join(","));
  const header = [
    note,
    `Overrides: ${o.sets.length ? o.sets.join(" ") : "none"}${o.awards ? `; awards from ${o.awards}` : ""}.`,
  ];
  const text = formatReport(report, header);
  process.stdout.write(`${text}\n`);
  if (o.out) {
    mkdirSync(dirname(o.out), { recursive: true });
    writeFileSync(o.out, `${text}\n`);
  }
  if (o.json) {
    mkdirSync(dirname(o.json), { recursive: true });
    writeFileSync(o.json, JSON.stringify({ options: o, report }, null, 2));
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`sim: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
