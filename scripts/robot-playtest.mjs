#!/usr/bin/env node
/**
 * Robot playtests (Milestone B7, part 2): whole online games in real browser
 * tabs, with no people. Each player is its own browser context (a device:
 * a 390 px phone, some with a slowed CPU, or a desktop) behind its own network
 * proxy (latency, a dropped socket, no signal, a locked phone). The B6 bots
 * choose every move from what the page offers (`data-action` on each enabled
 * button and board target) and the tab's own view (`?robot=1`), and the
 * script clicks it. The server is the real one, serving the built web client,
 * with rooms saved in ROOMS_DIR; the checks replay each finished game from
 * its saved file with the engine.
 *
 *   pnpm --filter @fishingjamboree/web build
 *   pnpm robot                         # short profile (CI): 3 games, short timers
 *   PROFILE=soak GAMES=30 CONCURRENCY=4 pnpm robot
 *
 * Options (environment variables):
 *   PROFILE      short (default) or soak
 *   GAMES        soak: number of games (default 30)
 *   CONCURRENCY  games at once on one server (default 3; a restart game gets its own server)
 *   SCALE        timers and fault lengths as a share of the rulebook's (default 0.25: 90 s turn → 22.5 s)
 *   SEED         soak: picks the games (default "soak")
 *   ONLY         play only the games whose id contains this text
 *   REPORT       where to write the Markdown report (default robot-report.md in the scratch folder)
 *   OUT_DIR      folder for server logs and saved rooms (default a new temp folder)
 *   HEADED=1     show the browsers
 *
 * Checks per game: every tab still in the game ends on the same seq and the
 * engine's result (awards included, from the replay of the saved log); no
 * wait longer than the turn timer allows; missed turns and removals follow
 * the rulebook (robotChecks.ts); faults that should cost nothing cost
 * nothing; a kicked or removed player's tab is told; no console or page
 * errors; on phones no horizontal scroll, buttons at least 44 px, and every
 * drawn card shown inside the screen for its full length.
 *
 * Exits 1 on any failed check.
 */
/* global setTimeout, document, window, performance, URL */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditGame,
  botByName,
  compareShownResult,
  compileOrThrow,
  readRawContent,
} from "../packages/sim/src/index.ts";
import { createProxy } from "./robot/proxy.mjs";
import { freePort, startServer } from "./robot/server.mjs";
import { finishGame, shortProfile, soakProfile } from "./robot/scenarios.mjs";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error('Playwright not found. Try: NODE_PATH="$(npm root -g)" pnpm robot');
  process.exit(2);
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const content = compileOrThrow(readRawContent(join(ROOT, "content")));
const PROFILE = process.env.PROFILE ?? "short";
const SCALE = Number(process.env.SCALE ?? "0.25");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "3");
const OUT_DIR = process.env.OUT_DIR ?? mkdtempSync(join(tmpdir(), "fj-robot-"));
mkdirSync(OUT_DIR, { recursive: true });
const REPORT = process.env.REPORT ?? join(OUT_DIR, "robot-report.md");
const TIMERS = {
  turnTimeoutMs: Math.round(90_000 * SCALE),
  reconnectGraceMs: Math.round(60_000 * SCALE),
  reconnectBudgetMs: Math.round(120_000 * SCALE),
  heartbeatMs: Math.max(1000, Math.round(15_000 * SCALE)),
};
/** Fixed in the server (not scaled): an away turn waits 2 s; a fresh drop is never missed within 10 s. */
const AUTO_ACTION_MS = 2_000;
const DISCONNECT_FLOOR_MS = 10_000;
/** Longest wait for any update while someone is deciding: the turn timer and the floor, plus slack. */
const STALL_LIMIT_MS = TIMERS.turnTimeoutMs + DISCONNECT_FLOOR_MS + AUTO_ACTION_MS + 8_000;
const GAME_LIMIT_MS = 40 * 60_000;
const DESKTOP = { viewport: { width: 1200, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

if (!existsSync(join(ROOT, "apps/web/dist/index.html"))) {
  console.error("Build the web client first: pnpm --filter @fishingjamboree/web build");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scaled = (secs) => Math.round(secs * 1000 * SCALE);
/** Network noise in the console while a fault is on (a socket that could not connect). */
const NETWORK_NOISE = /WebSocket connection to|net::ERR_|Failed to load resource/;

function within(promise, ms, fallback = null) {
  return Promise.race([promise.catch(() => fallback), sleep(ms).then(() => fallback)]);
}

// ---------------------------------------------------------------------------
// One robot player.

class Robot {
  constructor(game, spec, index) {
    this.game = game;
    this.spec = spec;
    this.index = index;
    this.name = spec.name;
    this.bot = botByName(spec.style);
    /** playing | kicked | removed | left (host left for good) */
    this.status = "playing";
    this.idle = false;
    this.frozen = false;
    this.busy = false;
    this.pageSwaps = 0;
    this.faulted = false;
    this.fired = new Set();
    this.decisions = 0;
    this.slowestClickMs = 0;
    this.recoveries = [];
    this.phone = { minButton: Infinity, hScroll: 0, flips: [] };
    this.seat = null;
  }

  label() {
    return `${this.game.id}/${this.name}`;
  }

  async init(browser, serverPort) {
    this.proxy = await createProxy(serverPort);
    const latency = this.spec.faults.find((f) => f.kind === "latency");
    if (latency) this.proxy.setLatency(latency.ms, latency.jitter ?? 0);
    this.browser = browser;
    this.context = await this.newContext();
    this.page = await this.openPage(this.context, this.url());
  }

  url() {
    return `http://127.0.0.1:${this.proxy.port}/?robot=1`;
  }

  async newContext() {
    const ctx = await this.browser.newContext(this.spec.device === "phone" ? PHONE : DESKTOP);
    if (this.spec.device === "phone") await ctx.addInitScript(watchCards);
    return ctx;
  }

  async openPage(context, url) {
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (NETWORK_NOISE.test(m.text())) this.game.networkNoise++;
      else this.game.problem(`[${this.name}] console: ${m.text()}`);
    });
    page.on("pageerror", (e) => this.game.problem(`[${this.name}] page error: ${e.message}`));
    page.on("dialog", (d) => d.accept().catch(() => {}));
    if (this.spec.cpu) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: this.spec.cpu });
      page.__cdp = cdp;
    }
    await page.goto(url);
    return page;
  }

  async snap() {
    if (this.frozen || !this.page || this.page.isClosed()) return null;
    return within(
      this.page.evaluate(() => window.__fjRobot ?? null),
      3000,
    );
  }

  /** Cards seen on this phone so far (kept across page swaps). */
  async collectFlips() {
    if (this.spec.device !== "phone" || !this.page || this.page.isClosed() || this.frozen) return;
    const flips = await within(
      this.page.evaluate(() => (window.__cards ? window.__cards.flips.splice(0) : [])),
      3000,
      [],
    );
    this.phone.flips.push(...flips);
  }

  async phoneChecks() {
    if (this.spec.device !== "phone") return;
    const r = await within(
      this.page.evaluate(() => {
        const sizes = [...document.querySelectorAll(".actions button")]
          .map((b) => b.getBoundingClientRect())
          .filter((b) => b.width > 0)
          .map((b) => Math.min(b.height, b.width));
        return {
          min: sizes.length ? Math.min(...sizes) : Infinity,
          hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      }),
      3000,
    );
    if (!r) return;
    this.phone.minButton = Math.min(this.phone.minButton, r.min);
    if (r.hScroll) this.phone.hScroll++;
  }

  /** The faults due now. `mine`: it is this player's decision. */
  due(snap, mine) {
    const round = snap.view?.round ?? 0;
    return this.spec.faults.filter((f, i) => {
      if (this.fired.has(i) || f.kind === "latency" || round < f.at) return false;
      const anyTime = f.kind === "kick" || f.kind === "hostLeave";
      if (!anyTime && !mine) return false;
      this.fired.add(i);
      return true;
    });
  }

  async fault(f) {
    this.busy = true;
    this.faulted = this.faulted || !["latency", "kick"].includes(f.kind);
    const t0 = Date.now();
    this.game.note(
      `${this.name}: ${f.kind}${f.secs ? ` ${f.secs} s (scaled ${scaled(f.secs) / 1000} s)` : ""} in round ${f.at}`,
    );
    try {
      if (f.kind === "drop") {
        this.proxy.drop();
        await this.waitBack(t0, "drop");
      } else if (f.kind === "offline") {
        this.proxy.hold();
        await sleep(scaled(f.secs));
        this.proxy.release();
        await this.waitBack(Date.now(), `offline ${f.secs} s`);
      } else if (f.kind === "lock") {
        const cdp = this.page.__cdp ?? (await this.context.newCDPSession(this.page));
        this.page.__cdp = cdp;
        this.proxy.hold();
        this.frozen = true;
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
        await sleep(scaled(f.secs));
        await cdp.send("Page.setWebLifecycleState", { state: "active" });
        this.frozen = false;
        this.proxy.release();
        await this.waitBack(Date.now(), `lock ${f.secs} s`);
      } else if (f.kind === "closeTab") {
        await this.collectFlips();
        await this.page.close();
        this.pageSwaps++;
        await sleep(scaled(f.secs));
        const page = await this.openPage(this.context, this.url());
        const offer = page.getByRole("button", {
          name: `Rejoin room ${this.game.code} as ${this.name}`,
        });
        const offered = await offer
          .waitFor({ timeout: 10000 })
          .then(() => true)
          .catch(() => false);
        if (!offered) this.game.problem(`${this.name}: no rejoin offer in a new tab`);
        else await offer.click();
        this.page = page;
        await this.waitBack(Date.now(), "close tab, rejoin from the offer");
      } else if (f.kind === "link") {
        const link = await this.page.getByLabel("Your rejoin link").inputValue();
        const old = this.page;
        const oldCtx = this.context;
        await this.collectFlips();
        this.context = await this.newContext();
        const url = link.includes("robot=1") ? link : link.replace("#", "?robot=1#");
        this.page = await this.openPage(this.context, url);
        this.pageSwaps++;
        await this.waitBack(Date.now(), "rejoin link on another device");
        const told = await old
          .getByText("Your seat was opened in another tab or on another device")
          .waitFor({ timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        if (!told) this.game.problem(`${this.name}: the old device was not told its seat moved`);
        await oldCtx.close();
      } else if (f.kind === "idle") {
        this.idle = true;
        this.faulted = true;
      } else if (f.kind === "kick") {
        const target = this.game.robots[f.target];
        if (target && target.status === "playing") {
          const button = this.page.getByTitle(`Remove ${target.name}`);
          target.expectKick = true;
          const ok = await button
            .click({ timeout: 5000 })
            .then(() => true)
            .catch(() => false);
          if (!ok) this.game.problem(`${this.name}: no Remove button for ${target.name}`);
          else await target.waitTold("kicked");
        }
      } else if (f.kind === "hostLeave") {
        this.status = "left";
        await this.collectFlips();
        await this.context.close();
      }
    } catch (e) {
      this.game.problem(`${this.name}: fault ${f.kind} failed: ${e.message}`);
    } finally {
      this.busy = false;
    }
  }

  /** After a fault: how long until this tab is connected and caught up with the others. */
  async waitBack(t0, what) {
    const end = Date.now() + STALL_LIMIT_MS * 2;
    while (Date.now() < end) {
      const s = await this.snap();
      if (s && s.connection === "open" && s.seq !== null) {
        const others = await this.game.maxSeq(this);
        if (s.seq >= others) {
          this.recoveries.push({ what, ms: Date.now() - t0 });
          return;
        }
      }
      if (this.status !== "playing") return;
      await sleep(200);
    }
    this.game.problem(
      `${this.name}: not back ${Math.round((Date.now() - t0) / 1000)} s after ${what}`,
    );
  }

  /** A removed player's tab must say so and go back to the start screen. */
  async waitTold(why) {
    const told = await this.page
      .getByText("You have been removed from this room.")
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!told) this.game.problem(`${this.name}: removed (${why}) but the tab was not told`);
    this.status = why === "kicked" ? "kicked" : "removed";
  }

  /** Plays until the game ends for this player. */
  async loop() {
    while (!this.game.over) {
      if (this.status !== "playing") return;
      if (this.busy) {
        await sleep(200);
        continue;
      }
      const s = await this.snap();
      if (!s) {
        await sleep(200);
        continue;
      }
      this.seat = s.seat ?? this.seat;
      if (s.view?.result) return;
      if (s.notice === "You have been removed from this room.") {
        if (!this.expectKick && !this.idle)
          this.game.problem(`${this.name}: removed without a reason`);
        this.status = this.expectKick ? "kicked" : "removed";
        return;
      }
      const mine = !!s.view && s.view.phase.actors[0] === s.seat;
      for (const f of this.due(s, mine)) {
        if (f.kind === "kick" || f.kind === "hostLeave") void this.fault(f);
        else await this.fault(f);
      }
      if (this.status !== "playing" || this.busy) continue;
      if (!mine || s.pending || s.connection !== "open" || this.idle) {
        await sleep(150);
        continue;
      }
      await this.decide(s);
    }
  }

  async decide(s) {
    const page = this.page;
    if (this.spec.pace === "human") {
      // Watch the animation through, then think a little (as people do).
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        const busy = await within(
          page.locator("[data-animating]").first().getAttribute("data-animating"),
          1000,
        );
        if (busy !== "yes") break;
        await sleep(150);
      }
      await sleep(300 + Math.random() * 1200);
    } else {
      await sleep(60);
    }
    const now = await this.snap();
    if (!now || now.seq !== s.seq || now.pending) return;
    const offered = await within(
      page.evaluate(() => {
        const svg = document.querySelector("svg.board");
        const box = svg?.getBoundingClientRect();
        return [...document.querySelectorAll("[data-action]")].map((el, i) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const target = el.classList.contains("target");
          return {
            i,
            action: el.getAttribute("data-action"),
            disabled: el.disabled === true,
            target,
            inside:
              !target ||
              (box && cx > box.left && cx < box.right && cy > box.top && cy < box.bottom),
          };
        });
      }),
      3000,
      [],
    );
    const usable = offered.filter((o) => !o.disabled);
    if (usable.length === 0) return;
    const byKey = new Map();
    for (const o of usable) if (!byKey.has(o.action)) byKey.set(o.action, o);
    const legal = [...byKey.keys()].map((k) => JSON.parse(k));
    const action = this.bot.choose({
      content,
      view: now.view,
      legal,
      seed: `${this.game.id}|${this.name}`,
    });
    let pick = byKey.get(JSON.stringify(action));
    if (!pick) {
      this.game.problem(`${this.name}: bot chose an action the page did not offer`);
      return;
    }
    await this.phoneChecks();
    if (!pick.inside) {
      // Zoomed in and the target is off the shown part: back to the whole board, as a player would.
      await page
        .locator('[data-zoom="fit"]')
        .click()
        .catch(() => {});
      await sleep(400);
    }
    const t0 = Date.now();
    const ok = await page
      .locator("[data-action]")
      .nth(pick.i)
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) return; // The page changed under the click (an update came in); look again.
    this.decisions++;
    this.game.actionsClicked++;
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const after = await this.snap();
      if (!after || after.seq !== s.seq) break;
      await sleep(50);
    }
    this.slowestClickMs = Math.max(this.slowestClickMs, Date.now() - t0);
  }
}

/** Runs in phone pages: every card flip, its scheduled length and whether it was inside the screen. */
function watchCards() {
  const seen = (window.__cards = { flips: [] });
  let cur = null;
  const tick = () => {
    const stage = document.querySelector(
      '.step-stage[data-step="card"], .step-stage[data-step="event"], .step-stage[data-step="repelled"]',
    );
    if (cur && (!stage || stage.dataset.id !== cur.id)) {
      cur.seen = Math.round(performance.now() - cur.t0);
      seen.flips.push(cur);
      cur = null;
    }
    if (stage && !cur) {
      const r = (stage.querySelector(".card-stage") ?? stage).getBoundingClientRect();
      cur = {
        id: stage.dataset.id,
        step: stage.dataset.step,
        ms: Number(stage.dataset.ms),
        t0: performance.now(),
        outside: r.top < -1 || r.bottom > window.innerHeight + 1,
      };
    }
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// One game.

class Game {
  constructor(spec, server) {
    this.spec = spec;
    this.id = spec.id;
    this.server = server;
    this.problems = [];
    this.notes = [];
    this.networkNoise = 0;
    this.actionsClicked = 0;
    this.over = false;
    this.maxStallMs = 0;
    this.stalls = [];
  }

  problem(text) {
    this.problems.push(text);
    console.log(`FAIL [${this.id}] ${text}`);
  }

  note(text) {
    this.notes.push(text);
    console.log(`.... [${this.id}] ${text}`);
  }

  live() {
    return this.robots.filter((r) => r.status === "playing");
  }

  async maxSeq(except) {
    const seqs = await Promise.all(
      this.live()
        .filter((r) => r !== except && !r.busy)
        .map((r) => r.snap().then((s) => s?.seq ?? -1)),
    );
    return Math.max(-1, ...seqs);
  }

  async run(browser) {
    const t0 = Date.now();
    this.robots = this.spec.players.map((p, i) => new Robot(this, p, i));
    try {
      for (const r of this.robots) await r.init(browser, this.server.port);
      await this.lobby();
      this.startedAt = Date.now();
      await this.playOnce(true);
      if (this.spec.rematch && this.problems.length === 0) await this.rematch();
    } finally {
      this.over = true;
      this.durationMs = Date.now() - t0;
      for (const r of this.robots) {
        await r.proxy?.close().catch(() => {});
        await r.context?.close().catch(() => {});
      }
    }
  }

  async lobby() {
    const [host, ...others] = this.robots;
    await host.page.getByLabel("Your name").fill(host.name);
    await host.page.getByRole("button", { name: "Create a room" }).click();
    this.code = (await host.page.locator(".code").first().innerText({ timeout: 10000 })).trim();
    for (const r of others) {
      await r.page.getByLabel("Your name").fill(r.name);
      await r.page.getByLabel("Room code").fill(this.code);
      await r.page.getByRole("button", { name: "Join room" }).click();
      await r.page.locator(".seats").waitFor({ timeout: 10000 });
    }
    await this.start();
  }

  async start() {
    const host = this.robots[0];
    const n = this.live().length;
    await host.page.waitForFunction(
      (count) => document.querySelectorAll(".seats li").length === count,
      n,
      {
        timeout: 15000,
      },
    );
    const start = host.page.getByRole("button", { name: "Start game" });
    await host.page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some(
          (b) => b.innerText.includes("Start game") && !b.disabled,
        ),
      null,
      { timeout: 15000 },
    );
    await start.click();
  }

  async playOnce(withFaults) {
    if (!withFaults) for (const r of this.robots) r.spec = { ...r.spec, faults: [] };
    this.over = false;
    const loops = this.live().map((r) => r.loop());
    const monitor = this.monitor(withFaults);
    await Promise.all(loops);
    await this.finish();
    this.over = true;
    await monitor;
  }

  /** Watches for stalls and runs the game-wide events (a server restart). */
  async monitor(withFaults) {
    let lastSeq = -1;
    let lastChange = Date.now();
    let restarted = !withFaults || !this.spec.restart;
    const started = Date.now();
    while (!this.over) {
      await sleep(300);
      const snaps = (
        await Promise.all(
          this.live()
            .filter((r) => !r.busy)
            .map((r) => r.snap()),
        )
      ).filter(Boolean);
      const seq = Math.max(-1, ...snaps.map((s) => s.seq ?? -1));
      const round = Math.max(0, ...snaps.map((s) => s.view?.round ?? 0));
      if (snaps.some((s) => s.view?.result)) {
        lastChange = Date.now();
        continue;
      }
      if (seq !== lastSeq) {
        const gap = Date.now() - lastChange;
        if (lastSeq >= 0) this.maxStallMs = Math.max(this.maxStallMs, gap);
        lastSeq = seq;
        lastChange = Date.now();
      } else if (Date.now() - lastChange > STALL_LIMIT_MS) {
        this.problem(
          `stuck: no update for ${Math.round((Date.now() - lastChange) / 1000)} s at seq ${seq} (limit ${STALL_LIMIT_MS / 1000} s)`,
        );
        lastChange = Date.now();
      }
      if (!restarted && round >= this.spec.restart.at) {
        restarted = true;
        this.note(`server restart (killed, ${this.spec.restart.secs} s down) in round ${round}`);
        await this.server.kill();
        await sleep(this.spec.restart.secs * 1000);
        await this.server.start();
        lastChange = Date.now();
      }
      if (Date.now() - started > GAME_LIMIT_MS) {
        this.problem("the game did not end within the time limit");
        this.over = true;
        for (const r of this.robots) r.status = r.status === "playing" ? "stopped" : r.status;
      }
    }
  }

  async finish() {
    const live = this.live();
    // Every tab still in the game shows the result card after the reveal, on the same seq.
    const shown = [];
    for (const r of live) {
      const card = await r.page
        .locator(".result")
        .waitFor({ timeout: 90000 })
        .then(() => true)
        .catch(() => false);
      if (!card) this.problem(`${r.name}: the result card did not show`);
      const s = await r.snap();
      shown.push({ r, s });
      await r.collectFlips();
      await r.phoneChecks();
    }
    if (this.robots[0].status === "left" && live.length > 0) {
      // The host closed their tab for good: can anyone still start a rematch?
      await sleep(2000);
      const can = await Promise.all(
        live.map((r) => r.page.getByRole("button", { name: "Play again" }).count()),
      );
      if (can.every((n) => n === 0)) {
        this.problem("the host left mid-game: nobody left in the room can start a rematch");
      }
    }
    const seqs = new Set(shown.map((x) => x.s?.seq));
    if (seqs.size !== 1)
      this.problem(
        `tabs end on different seqs: ${shown.map((x) => `${x.r.name} ${x.s?.seq}`).join(", ")}`,
      );

    const file = join(this.server.roomsDir, `${this.code}.json`);
    let saved = null;
    try {
      saved = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      this.problem(`cannot read the saved room ${file}: ${e.message}`);
      return;
    }
    const audit = auditGame(content, saved.game);
    for (const p of audit.problems) this.problem(`rules: ${p}`);
    this.audit = audit;
    if (audit.result) {
      for (const { r, s } of shown)
        for (const p of compareShownResult(audit.result, s?.view?.result, r.name)) this.problem(p);
    }
    this.checkPlayers(audit, saved);
  }

  checkPlayers(audit, saved) {
    const rounds = content.rules.rounds;
    for (const r of this.robots) {
      const seat = saved.seats.find((x) => x.name === r.name)?.id ?? r.seat;
      const a = audit.players[seat];
      if (!a) continue;
      r.audit = a;
      const kinds = r.spec.faults.map((f) => f.kind);
      const idle = r.spec.faults.find((f) => f.kind === "idle");
      if (r.expectKick) {
        if (a.removed !== "kicked")
          this.problem(`${r.name}: kicked by the host but removed=${a.removed}`);
      } else if (idle) {
        if (
          idle.at <= rounds - 3 &&
          a.removed !== "missed-turns" &&
          audit.result?.reason !== "last-player"
        ) {
          this.problem(
            `${r.name}: stopped playing in round ${idle.at} but was not removed (misses: ${a.timeoutMisses} timed out, ${a.awayMisses} away)`,
          );
        }
        if (a.removed === "missed-turns" && r.status !== "removed") {
          this.problem(`${r.name}: removed for missed turns but the tab was not told`);
        }
      } else {
        if (a.removed)
          this.problem(`${r.name}: removed (${a.removed}) with faults [${kinds.join(", ")}]`);
        const clean = kinds.every((k) => k === "latency" || k === "drop" || k === "kick");
        if (clean && (a.timeoutMisses > 0 || a.awayMisses > 0 || a.timedOut > 0)) {
          this.problem(
            `${r.name}: missed turns with no reason (${a.timeoutMisses} timed out, ${a.awayMisses} away, ${a.timedOut} ended by the server) [${kinds.join(", ") || "no faults"}]`,
          );
        }
      }
      if (r.spec.device === "phone") this.checkPhone(r, audit);
    }
  }

  checkPhone(r, audit) {
    if (r.phone.minButton < 44)
      this.problem(`${r.name} (phone): a button ${Math.round(r.phone.minButton)} px (< 44)`);
    if (r.phone.hScroll > 0)
      this.problem(`${r.name} (phone): horizontal scroll seen ${r.phone.hScroll} times`);
    const short = r.phone.flips.filter((f) => f.ms < 2000);
    const outside = r.phone.flips.filter((f) => f.outside);
    if (short.length)
      this.problem(
        `${r.name} (phone): ${short.length} card flips scheduled under 2 s (${short.map((f) => f.ms).join(", ")} ms)`,
      );
    if (outside.length)
      this.problem(`${r.name} (phone): ${outside.length} card flips outside the screen`);
    const expected = audit.events.filter(
      (e) => e.type === "cardDrawn" || e.type === "eventDrawn" || e.type === "sharkRepelled",
    ).length;
    r.phone.expectedCards = expected;
    const untouched = r.pageSwaps === 0 && !r.faulted && r.status === "playing";
    if (untouched && r.phone.flips.length < expected) {
      this.problem(`${r.name} (phone): ${r.phone.flips.length} of ${expected} drawn cards shown`);
    }
  }

  async rematch() {
    this.note("rematch");
    const host = this.robots[0];
    if (host.status !== "playing") return;
    const firstAudit = this.audit;
    await host.page.getByRole("button", { name: "Play again" }).click();
    for (const r of this.live()) {
      const back = await r.page
        .locator(".seats")
        .waitFor({ timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!back) this.problem(`${r.name}: not back in the lobby after Play again`);
      r.phone.flips = [];
      r.pageSwaps = 0;
      r.faulted = false;
    }
    await this.start();
    await this.playOnce(false);
    this.rematchAudit = this.audit;
    this.audit = firstAudit;
  }
}

// ---------------------------------------------------------------------------
// Run.

const games = (
  PROFILE === "soak"
    ? soakProfile(Number(process.env.GAMES ?? "30"), process.env.SEED)
    : shortProfile()
)
  .map(finishGame)
  .filter((g) => !process.env.ONLY || g.id.includes(process.env.ONLY));

console.log(
  `robot playtest: ${games.length} games, profile ${PROFILE}, scale ${SCALE}, timers ${JSON.stringify(TIMERS)}`,
);
console.log(`server logs and rooms in ${OUT_DIR}`);
const browser = await playwright.chromium.launch({ headless: process.env.HEADED !== "1" });
const shared = await startServer({
  port: await freePort(),
  roomsDir: join(OUT_DIR, "rooms-shared"),
  timers: TIMERS,
  logFile: join(OUT_DIR, "server-shared.log"),
});

const t0 = Date.now();
const done = [];
const queue = [...games];
async function worker() {
  for (;;) {
    const spec = queue.shift();
    if (!spec) return;
    let server = shared;
    if (spec.restart) {
      server = await startServer({
        port: await freePort(),
        roomsDir: join(OUT_DIR, `rooms-${spec.id}`),
        timers: TIMERS,
        logFile: join(OUT_DIR, `server-${spec.id}.log`),
      });
    }
    const game = new Game(spec, server);
    console.log(`>>>> [${spec.id}] ${describePlayers(spec)}`);
    try {
      await game.run(browser);
    } catch (e) {
      game.problem(`crashed: ${e.stack ?? e.message}`);
    }
    if (server !== shared) await server.stop();
    console.log(
      `<<<< [${spec.id}] ${game.problems.length ? `${game.problems.length} problems` : "ok"} in ${Math.round((game.durationMs ?? 0) / 1000)} s`,
    );
    done.push(game);
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
await shared.stop();
await browser.close();

function describePlayers(spec) {
  return (
    spec.players
      .map((p) => {
        const faults = p.faults.map((f) =>
          f.kind === "latency"
            ? `latency ${f.ms}±${f.jitter}`
            : `${f.kind}@${f.at}${f.secs ? `/${f.secs}s` : ""}`,
        );
        return `${p.name} ${p.device}${p.cpu ? `×${p.cpu}cpu` : ""} ${p.style} ${p.pace}${faults.length ? ` [${faults.join(", ")}]` : ""}`;
      })
      .join("; ") +
    (spec.restart ? `; restart@${spec.restart.at}` : "") +
    (spec.rematch ? "; rematch" : "")
  );
}

const report = writeReport(done, Date.now() - t0);
writeFileSync(REPORT, report);
console.log(`\nreport: ${REPORT}`);
const failed = done.filter((g) => g.problems.length > 0);
console.log(`${done.length - failed.length}/${done.length} games passed`);
process.exit(failed.length > 0 ? 1 : 0);

function writeReport(list, ms) {
  const lines = [];
  const ok = list.filter((g) => g.problems.length === 0).length;
  lines.push(`# Robot playtest report`, "");
  lines.push(
    `Profile ${PROFILE}, ${list.length} games, ${ok} passed, ${Math.round(ms / 60000)} min in all, concurrency ${CONCURRENCY}.`,
  );
  lines.push(
    `Timers at scale ${SCALE}: turn ${TIMERS.turnTimeoutMs / 1000} s, grace ${TIMERS.reconnectGraceMs / 1000} s, budget ${TIMERS.reconnectBudgetMs / 1000} s, heartbeat ${TIMERS.heartbeatMs / 1000} s; stall limit ${STALL_LIMIT_MS / 1000} s.`,
    "",
  );
  lines.push(
    "| Game | Players | Min | Actions | Longest wait (s) | Recoveries (s) | Cards on phones | Result |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const g of [...list].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))) {
    const rec =
      g.robots?.flatMap((r) =>
        r.recoveries.map((x) => `${r.name} ${x.what}: ${(x.ms / 1000).toFixed(1)}`),
      ) ?? [];
    const cards =
      g.robots
        ?.filter((r) => r.spec.device === "phone")
        .map((r) => `${r.name} ${r.phone.flips.length}/${r.phone.expectedCards ?? "?"}`) ?? [];
    const res = g.audit?.result
      ? `${g.audit.result.reason}, won by ${g.audit.result.winners.join(",")}${g.rematchAudit ? "; rematch ok" : ""}`
      : "no result";
    lines.push(
      `| ${g.id} | ${describePlayers(g.spec).replaceAll("|", "/")} | ${((g.durationMs ?? 0) / 60000).toFixed(1)} | ${g.audit?.actions ?? "?"} | ${(g.maxStallMs / 1000).toFixed(1)} | ${rec.join("; ")} | ${cards.join("; ")} | ${g.problems.length ? `**${g.problems.length} problems**` : res} |`,
    );
  }
  lines.push("");
  const missed = list.flatMap((g) =>
    (g.robots ?? [])
      .filter((r) => r.audit && (r.audit.timeoutMisses || r.audit.awayMisses || r.audit.removed))
      .map(
        (r) =>
          `- ${g.id}/${r.name} [${r.spec.faults.map((f) => f.kind).join(", ")}]: ${r.audit.timeoutMisses} timed out, ${r.audit.awayMisses} away, ${r.audit.timedOut} ended by the server, removed: ${r.audit.removed ?? "no"}`,
      ),
  );
  if (missed.length) lines.push("## Missed turns and removals", "", ...missed, "");
  const probs = list.filter((g) => g.problems.length);
  if (probs.length) {
    lines.push("## Problems", "");
    for (const g of probs) {
      lines.push(
        `### ${g.id}`,
        "",
        ...g.problems.map((p) => `- ${p}`),
        "",
        "Notes:",
        ...g.notes.map((n) => `- ${n}`),
        "",
      );
    }
  }
  return lines.join("\n") + "\n";
}
