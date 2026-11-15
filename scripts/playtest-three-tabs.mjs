#!/usr/bin/env node
/**
 * Plays a whole game in a real browser with three tabs of one browser context,
 * clicking only what the UI offers (board targets and action buttons).
 *
 * Needs the server and the web client running:
 *   pnpm start:server
 *   pnpm dev:web
 * Then:
 *   node scripts/playtest-three-tabs.mjs
 * If Playwright is installed globally: NODE_PATH="$(npm root -g)" node scripts/playtest-three-tabs.mjs
 *
 * Options (environment variables):
 *   WEB_URL      default http://localhost:5173
 *   SEED         default "playtest" (picks among the offered choices)
 *   GRACE=1      also close a tab and wait out the reconnect grace (60 s by default)
 *   HEADED=1     show the browser
 *   SHOT_DIR     folder for 390 px pictures of the shop, the Helicopter button and a move (layout review)
 *
 * Besides the game it also checks: a refresh mid-game keeps the seat, a double
 * click on a button is quiet, a 4th player can join a lobby, and a phone-width
 * tab (390 px) has no horizontal scroll and tappable buttons; the host removes
 * the 4th player from the lobby. With GRACE=1 the closed tab's turns are missed
 * (away: they do not count towards removal), and after three of them the host
 * removes that player from the game. Rejoining (P1-1):
 * a closed tab's player opens a new tab and rejoins from the start-screen offer
 * (a new tab never rejoins by itself, so the three tabs stay three players);
 * and a player opens their rejoin link in a fresh browser context, while the
 * old tab is told its seat was opened elsewhere and does not take it back.
 *
 * Exits 1 on any failed check or any console/page error.
 */
/* global setTimeout, URL, document, window -- document and window are used inside page.evaluate */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.error('Playwright not found. Try: NODE_PATH="$(npm root -g)" node ' + process.argv[1]);
  process.exit(2);
}

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const SEED = process.env.SEED ?? "playtest";
const GRACE = process.env.GRACE === "1";
const MAX_ACTIONS = 3000;

// Small seeded PRNG (mulberry32) so a run can be repeated.
let rngState = [...SEED].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
function rand() {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];

const problems = [];
const checks = [];
function check(ok, what) {
  checks.push({ ok, what });
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
}

const browser = await playwright.chromium.launch({ headless: process.env.HEADED !== "1" });
const extraContexts = [];
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[${label}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${label}] page error: ${e.message}`));
}

async function openTab(label) {
  const page = await context.newPage();
  watch(page, label);
  await page.goto(WEB_URL);
  return page;
}

async function seqOf(page) {
  const v = await page
    .locator("[data-seq]")
    .first()
    .getAttribute("data-seq", { timeout: 200 })
    .catch(() => null);
  return v === null ? -1 : Number(v);
}

async function seatOf(page) {
  return page
    .locator("[data-me]")
    .first()
    .getAttribute("data-me", { timeout: 200 })
    .catch(() => null);
}

/** Waits until every page shows at least `seq`. */
async function waitAllSeq(pages, seq, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const seqs = await Promise.all(pages.map(seqOf));
    if (seqs.every((s) => s >= seq)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** What this page offers: enabled action buttons and board targets. */
async function offers(page) {
  const buttons = await page.locator(".actions button:not([disabled])").all();
  let targets = await page.locator("svg.board .target").all();
  if (targets.length > 0 && (await page.locator('svg.board[data-zoomed="yes"]').count()) > 0) {
    // Zoomed (B4): a target outside the shown part cannot be tapped. If none is
    // inside, go back to the whole board, as a player would.
    let inside = await reachableTargets(page);
    if (inside.length === 0) {
      await page.locator('[data-zoom="fit"]').click();
      await page.waitForTimeout(400);
      inside = await reachableTargets(page);
      zoomStats.fellBackToFit++;
    }
    targets = inside.map((i) => targets[i]).filter(Boolean);
  }
  return { buttons, targets };
}

const zoomStats = { fellBackToFit: 0, followedTurns: 0, tileSizes: [], misses: [] };

/** Indexes of the targets whose centre is inside the board's window on screen. */
async function reachableTargets(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg.board");
    if (!svg) return [];
    const box = svg.getBoundingClientRect();
    const out = [];
    document.querySelectorAll("svg.board .target").forEach((t, i) => {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx > box.left && cx < box.right && cy > box.top && cy < box.bottom) out.push(i);
    });
    return out;
  });
}

/** Tile size on screen in CSS px, and whether the board is zoomed. */
async function tileSize(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg.board");
    const vb = svg.viewBox.baseVal;
    return {
      zoomed: svg.getAttribute("data-zoomed") === "yes",
      tile: (svg.getBoundingClientRect().width / vb.width) * (1969 / 20),
      vb: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
    };
  });
}

/** The tab that plays the rest of the game at 390 px with "Follow my turn" on. */
let phonePage = null;
const shots = new Set();

const stats = { actions: 0, byKind: {} };
function count(kind) {
  stats.actions++;
  stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
}

/** Makes one choice on whichever tab has something to do. Returns false if nobody does. */
async function step(pages, opts = {}) {
  const before = Math.max(...(await Promise.all(pages.map(seqOf))));
  for (const page of pages) {
    if (page === phonePage && (await page.locator("svg.board .target").count()) > 0) {
      // The phone tab follows its own turn (B4): let the view settle, then measure.
      await page.waitForTimeout(350);
      const t = await tileSize(page);
      zoomStats.tileSizes.push(t.tile);
      if (t.zoomed) zoomStats.followedTurns++;
    }
    if (process.env.SHOT_DIR) {
      // Layout review: one full-page picture of the shop, of the Helicopter button and of a move at 390 px.
      for (const [name, sel] of [
        ["shop", ".shop"],
        ["helicopter", "button.helicopter"],
        ["move", "svg.board .target"],
      ]) {
        if (!shots.has(name) && (await page.locator(sel).count())) {
          shots.add(name);
          const size = page.viewportSize();
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
          if (size) await page.setViewportSize(size);
        }
      }
    }
    const { buttons, targets } = await offers(page);
    if (buttons.length === 0 && targets.length === 0) continue;
    const labels = await Promise.all(buttons.map((b) => b.innerText()));
    // Prefer the board when a move is offered; otherwise a button. Buy and
    // helicopter are offered as buttons, so a uniform pick exercises them too.
    let clicked;
    if (targets.length > 0 && (buttons.length === 0 || rand() < 0.85)) {
      const target = pick(targets);
      if (opts.doubleClick) await target.dblclick();
      else await target.click();
      clicked = "board";
    } else {
      const i = Math.floor(rand() * buttons.length);
      const label = labels[i];
      if (opts.doubleClick) await buttons[i].dblclick();
      else await buttons[i].click();
      clicked = label
        .split("\n")[0]
        .replace(/\(.*\)/, "")
        .trim();
    }
    count(clicked);
    const ok = await waitAllSeq(pages, before + 1);
    if (!ok) {
      const notice = await page
        .locator(".notice")
        .allInnerTexts()
        .catch(() => []);
      problems.push(
        `no update after clicking "${clicked}" at seq ${before} (${notice.join(" | ")})`,
      );
      return false;
    }
    return true;
  }
  return false;
}

async function waitForAnyOffer(pages, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const p of pages) {
      const { buttons, targets } = await offers(p);
      if (buttons.length || targets.length) return true;
    }
    if (await pages[0].locator(".result").count()) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

// ---------------------------------------------------------------------------
// Lobby: one creates, two join, plus a 4th joins and leaves again.
const names = ["Ann", "Bob", "Cy"];
const pages = [];
for (const n of names) pages.push(await openTab(n));

await pages[0].getByLabel("Your name").fill(names[0]);
await pages[0].getByRole("button", { name: "Create a room" }).click();
const code = (await pages[0].locator(".code").first().innerText({ timeout: 5000 })).trim();
check(/^[A-Z]{4}$/.test(code), `room created with code ${code}`);

for (let i = 1; i < 3; i++) {
  await pages[i].getByLabel("Your name").fill(names[i]);
  await pages[i].getByLabel("Room code").fill(code.toLowerCase());
  await pages[i].getByRole("button", { name: "Join room" }).click();
  await pages[i].locator(".seats").waitFor({ timeout: 5000 });
}
const lobbyCount = await pages[0].locator(".seats li").count();
check(lobbyCount === 3, `host sees 3 seats in the lobby (${lobbyCount})`);

// A 4th player on a phone-width viewport joins the lobby, then leaves.
const phoneCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const phone = await phoneCtx.newPage();
watch(phone, "Dee(phone)");
await phone.goto(WEB_URL);
check(await noHorizontalScroll(phone), "phone: start screen has no horizontal scroll");
await phone.getByLabel("Your name").fill("Dee");
await phone.getByLabel("Room code").fill(code);
await phone.getByRole("button", { name: "Join room" }).click();
await phone.locator(".seats").waitFor({ timeout: 5000 });
await pages[0].waitForFunction(() => document.querySelectorAll(".seats li").length === 4, null, {
  timeout: 5000,
});
check(true, "a 4th player joins (host sees 4 seats)");
check(await noHorizontalScroll(phone), "phone: lobby has no horizontal scroll");
// The host removes the 4th player (the Remove button asks first).
pages[0].once("dialog", (d) => d.accept());
await pages[0].getByRole("button", { name: "Remove" }).last().click();
await pages[0].waitForFunction(() => document.querySelectorAll(".seats li").length === 3, null, {
  timeout: 5000,
});
check(true, "the host removes the 4th player (host sees 3 seats)");
await phone.getByText("You have been removed from this room.").waitFor({ timeout: 5000 });
check(true, "the removed player is told and is back on the start screen");
await phoneCtx.close();

// Start.
await pages[0].getByRole("button", { name: "Start game" }).click();
check(await waitAllSeq(pages, 0), "game started on all three tabs");
{
  const seats = await Promise.all(pages.map(seatOf));
  check(
    new Set(seats).size === 3 && !seats.includes(null),
    `each tab is its own player (${seats.join(", ")})`,
  );
  // P1-2: the turn text shows the turn timer on every tab.
  const timers = await Promise.all(pages.map((p) => p.locator(".turn .timer").innerText()));
  check(
    timers.every((t) => /^\d+ s left/.test(t.trim())),
    `the turn text shows the time left (${timers.map((t) => t.trim()).join(" | ")})`,
  );
}

/** A new tab in the same browser: offers the saved seats, rejoins none by itself. */
async function closeAndRejoinFromOffer(i) {
  const old = pages[i];
  const seat = await seatOf(old);
  const name = names[i];
  await old.close();
  console.log(`.... closed ${name}'s tab (${seat}); opening a new tab`);
  const page = await openTab(`${name}(new tab)`);
  const offer = page.getByRole("button", { name: `Rejoin room ${code} as ${name}` });
  await offer.waitFor({ timeout: 5000 });
  const offered = await page.locator(".rejoin-offers button").allInnerTexts();
  await page.waitForTimeout(800);
  check(
    (await page.locator("[data-seq]").count()) === 0,
    `a new tab offers saved seats (${offered.join(" / ")}) and rejoins none by itself`,
  );
  await offer.click();
  await page.locator("[data-seq]").waitFor({ timeout: 8000 });
  const after = await seatOf(page);
  const seq = Math.max(...(await Promise.all(pages.filter((p) => p !== old).map(seqOf))));
  check(
    after === seat && (await seqOf(page)) >= seq,
    `${name} rejoins from the offer in a new tab (${seat} → ${after})`,
  );
  pages[i] = page;
  // The others see the seat connected again.
  const others = pages.filter((p) => p !== page);
  const back = await others[0]
    .waitForFunction(
      () => document.querySelectorAll(".players .disconnected, .players .away").length === 0,
      null,
      { timeout: 5000 },
    )
    .then(() => true)
    .catch(() => false);
  check(back, `the others see ${name} back online`);
}

/** The rejoin link, opened in a fresh browser context (another browser or device). */
async function rejoinByLink(i) {
  const old = pages[i];
  const seat = await seatOf(old);
  const name = names[i];
  const link = await old.getByLabel("Your rejoin link").inputValue();
  check(
    link.includes(`#rejoin=${code}.`) && !link.split("#")[0].includes(code),
    "the rejoin link carries the seat in the fragment only",
  );
  const fresh = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  extraContexts.push(fresh);
  const page = await fresh.newPage();
  watch(page, `${name}(link)`);
  await page.goto(link);
  const offer = page.getByRole("button", { name: `Rejoin room ${code}` });
  await offer.waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  check(
    (await page.locator("[data-seq]").count()) === 0 &&
      (await page.locator(".rejoin-offers button").count()) === 1,
    "opening the rejoin link offers the seat and waits for a click",
  );
  await offer.click();
  await page.locator("[data-seq]").waitFor({ timeout: 8000 });
  check((await seatOf(page)) === seat, `${name} rejoins by link in another browser (${seat})`);
  check(
    new URL(page.url()).hash === "",
    `the link is removed from the address bar (${page.url()})`,
  );
  // The old tab is replaced: start screen, a clear message, and it stays put.
  await old.locator(".notice").waitFor({ timeout: 5000 });
  const notice = await old.locator(".notice").innerText();
  await old.waitForTimeout(3000);
  check(
    /opened in another tab or on another device/.test(notice) &&
      (await old.locator("[data-seq]").count()) === 0,
    `the old tab says its seat was opened elsewhere and leaves the table ("${notice.split(".")[0]}")`,
  );
  check(
    (await seatOf(page)) === seat && (await page.locator(".notice").count()) === 0,
    "the old tab does not take the seat back",
  );
  // A refresh of the old tab offers the seat but does not take it.
  await old.reload();
  await old.locator(".rejoin-offers").waitFor({ timeout: 5000 });
  await old.waitForTimeout(800);
  check(
    (await old.locator("[data-seq]").count()) === 0 && (await seatOf(page)) === seat,
    "a refresh of the old tab offers the seat and does not take it",
  );
  await old.close();
  pages[i] = page;
}

/** Pinch, drag, double tap and the buttons on a 390 px tab (B4). Chromium touch events through CDP. */
async function phoneZoomChecks(p) {
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((pt, i) => ({ x: pt.x, y: pt.y, id: i + 1 })),
    });
  const svg = p.locator("svg.board");
  await svg.scrollIntoViewIfNeeded();
  if (await p.locator('[data-zoom="fit"]:not([disabled])').count()) {
    await p.locator('[data-zoom="fit"]').click();
    await p.waitForTimeout(400);
  }
  let t = await tileSize(p);
  check(
    !t.zoomed && t.tile < 44,
    `phone zoom: the whole board is shown first (tile ${t.tile.toFixed(0)} px)`,
  );
  check(
    (await p.locator('input[type="checkbox"]').count()) === 1,
    'phone zoom: the "Follow my turn" switch is there',
  );

  const box = await svg.boundingBox();
  const mid = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 300) };
  // Pinch out with two fingers.
  await touch("touchStart", [
    { x: mid.x - 30, y: mid.y },
    { x: mid.x + 30, y: mid.y },
  ]);
  for (let d = 40; d <= 140; d += 20) {
    await touch("touchMove", [
      { x: mid.x - d, y: mid.y },
      { x: mid.x + d, y: mid.y },
    ]);
  }
  await touch("touchEnd", []);
  await p.waitForTimeout(150);
  t = await tileSize(p);
  check(t.zoomed && t.tile > 44, `phone zoom: a pinch zooms in (tile ${t.tile.toFixed(0)} px)`);
  check(await noHorizontalScroll(p), "phone zoom: no horizontal scroll while zoomed");

  // Drag with one finger: the shown part moves.
  const before = t.vb;
  await touch("touchStart", [{ x: mid.x, y: mid.y }]);
  for (let d = 10; d <= 90; d += 20) await touch("touchMove", [{ x: mid.x - d, y: mid.y - d }]);
  await touch("touchEnd", []);
  await p.waitForTimeout(150);
  t = await tileSize(p);
  check(
    Math.abs(t.vb.x - before.x) > 1 || Math.abs(t.vb.y - before.y) > 1,
    "phone zoom: a one-finger drag pans the board",
  );
  check(Math.abs(t.vb.width - before.width) < 1e-6, "phone zoom: a drag does not change the zoom");
  check(await noHorizontalScroll(p), "phone zoom: no horizontal scroll after a drag");

  // Whole board, then My ship, then a double tap.
  await p.locator('[data-zoom="fit"]').click();
  await p.waitForTimeout(400);
  t = await tileSize(p);
  check(!t.zoomed, "phone zoom: the Whole board button goes back to the full view");
  if (await p.locator('[data-zoom="ship"]:not([disabled])').count()) {
    await p.locator('[data-zoom="ship"]').click();
    await p.waitForTimeout(400);
    t = await tileSize(p);
    check(
      t.zoomed && t.tile >= 44,
      `phone zoom: My ship zooms in (tile ${t.tile.toFixed(0)} px ≥ 44)`,
    );
    await p.locator('[data-zoom="fit"]').click();
    await p.waitForTimeout(400);
  }
  // Double tap on the art's left strip (no targets there).
  const spot = { x: box.x + box.width * 0.08, y: box.y + box.height * 0.5 };
  for (let k = 0; k < 2; k++) {
    await touch("touchStart", [spot]);
    await touch("touchEnd", []);
    await p.waitForTimeout(60);
  }
  await p.waitForTimeout(400);
  t = await tileSize(p);
  check(
    t.zoomed && t.tile >= 44,
    `phone zoom: a double tap zooms in (tile ${t.tile.toFixed(0)} px ≥ 44)`,
  );
  await p.locator('[data-zoom="fit"]').click();
  await p.waitForTimeout(400);
  check(await noHorizontalScroll(p), "phone zoom: no horizontal scroll at the whole board");

  // Follow my turn on for the rest of the game on this tab.
  await p.locator('input[type="checkbox"]').check();
  await p.waitForTimeout(400);
  check(true, "phone zoom: Follow my turn is switched on; this tab plays on at 390 px");
}

// ---------------------------------------------------------------------------
// Play. Mid-game checks happen at fixed action numbers.
let refreshed = false;
let doubleClicked = false;
let phoneChecked = false;
let graceDone = !GRACE;
let offerRejoined = false;
let linkRejoined = false;
let lastSeq = 0;

while (stats.actions < MAX_ACTIONS) {
  if (await pages[0].locator(".result").count()) break;

  // Refresh a tab mid-game: the seat must be kept.
  if (!refreshed && stats.actions >= 20) {
    refreshed = true;
    const seatBefore = await seatOf(pages[1]);
    const seqBefore = await seqOf(pages[1]);
    await pages[1].reload();
    await pages[1].locator("[data-seq]").waitFor({ timeout: 8000 });
    const seatAfter = await seatOf(pages[1]);
    const seqAfter = await seqOf(pages[1]);
    check(
      seatBefore !== null && seatBefore === seatAfter && seqAfter >= seqBefore,
      `refresh mid-game keeps the seat (${seatBefore} → ${seatAfter}, seq ${seqBefore} → ${seqAfter})`,
    );
  }

  // Close a tab and rejoin from the offer in a new tab of the same browser.
  if (!offerRejoined && stats.actions >= 25) {
    offerRejoined = true;
    await closeAndRejoinFromOffer(1);
  }

  // Open the rejoin link in another browser.
  if (!linkRejoined && stats.actions >= 35) {
    linkRejoined = true;
    await rejoinByLink(2);
  }

  // Phone width on the table screen: open a 4th view of seat p1's game? A seat
  // has one connection, so instead resize a tab for a moment.
  if (!phoneChecked && stats.actions >= 30) {
    phoneChecked = true;
    const p = pages[0]; // the host: never closed or replaced, so it can stay a phone
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(200);
    check(await noHorizontalScroll(p), "phone width: table has no horizontal scroll");
    const small = await p.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll("button")) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && (r.height < 40 || r.width < 40)) out.push(b.innerText);
      }
      return out;
    });
    check(small.length === 0, `phone width: buttons at least 40 px (${small.join(", ") || "all"})`);
    const boardW = await p.evaluate(
      () => document.querySelector("svg.board")?.getBoundingClientRect().width ?? 0,
    );
    const cell = boardW / 8;
    check(cell >= 30, `phone width: board cells about ${cell.toFixed(0)} px wide (≥ 30)`);
    await p.screenshot({ path: process.env.SHOT ?? "/dev/null" }).catch(() => {});
    // From here this tab plays on at 390 px with the zoom on (B4).
    phonePage = p;
    await phoneZoomChecks(p);
  }

  // Close a tab and let the reconnect grace run out.
  if (!graceDone && stats.actions >= 40) {
    graceDone = true;
    const gone = pages.pop();
    const seat = await seatOf(gone);
    await gone.close();
    console.log(`.... closed ${seat}'s tab; waiting for the server to miss its turns`);
    {
      const tag = pages[0].locator(".disconnected").first();
      await tag.waitFor({ timeout: 35000 });
      const title = await tag.getAttribute("title");
      check(
        /^disconnected: \d+ s to come back$/.test(title ?? ""),
        `the offline tag counts down the grace ("${title}")`,
      );
    }
    const seqAtClose = Math.max(...(await Promise.all(pages.map(seqOf))));
    // Keep playing the remaining seats; the server must miss the closed one's turns.
    const end = Date.now() + 120000;
    let autoSeen = false;
    while (Date.now() < end && !autoSeen) {
      const did = await step(pages);
      if (!did) await new Promise((r) => setTimeout(r, 250));
      const away = await pages[0].locator(".away").count();
      const s = Math.max(...(await Promise.all(pages.map(seqOf))));
      if (away > 0 && s > seqAtClose) {
        const log = await pages[0].locator(".log li").allInnerTexts();
        autoSeen = log.some((l) => l.endsWith("(auto)"));
      }
    }
    check(autoSeen, `after the grace ${seat}'s turns are missed and the game goes on`);
    // An away player's missed turns do not count towards removal (review
    // P1-1): play three more of their turns, then the host removes them.
    const removedCount = () => pages[0].locator(".players small.removed").count();
    const awayMisses = async () =>
      (await pages[0].locator(".log li").allInnerTexts()).filter((l) =>
        l.includes("is away and misses the turn"),
      ).length;
    for (let i = 0; i < 400 && (await awayMisses()) < 3; i++) {
      if (!(await step(pages))) await new Promise((r) => setTimeout(r, 250));
    }
    check(
      (await awayMisses()) >= 3 && (await removedCount()) === 0,
      `after 3 away turns ${seat} is still in the game`,
    );
    // pages[0] is the host's tab, which is never the one closed.
    const host = pages[0];
    const goneName = names[Number(seat.slice(1)) - 1];
    host.once("dialog", (d) => d.accept());
    await host.locator(`button[title="Remove ${goneName}"]`).click();
    for (let i = 0; i < 40 && (await removedCount()) === 0; i++) await host.waitForTimeout(250);
    check((await removedCount()) === 1, `the host removes ${seat}; shown as removed`);
    continue;
  }

  const doubleClick = !doubleClicked && stats.actions >= 10;
  const did = await step(pages, { doubleClick });
  if (doubleClick && did) {
    doubleClicked = true;
    // Give the second click's (stale) answer time to arrive.
    await pages[0].waitForTimeout(500);
    const notices = (await Promise.all(pages.map((p) => p.locator(".notice").count()))).reduce(
      (a, b) => a + b,
      0,
    );
    check(notices === 0, "a double click shows no error");
  }
  if (!did) {
    // Nobody can act right now (the server may be acting for an away seat).
    if (!(await waitForAnyOffer(pages, 15000))) {
      if (await pages[0].locator(".result").count()) break;
      problems.push(`stuck at seq ${await seqOf(pages[0])}: nobody is offered anything`);
      break;
    }
  }
  const s = await seqOf(pages[0]);
  if (s > lastSeq && s % 50 === 0) console.log(`.... seq ${s}`);
  lastSeq = s;
}

// ---------------------------------------------------------------------------
// Zoom (B4): what the phone tab saw on its own turns.
if (phonePage) {
  const sizes = zoomStats.tileSizes;
  const zoomedSizes = sizes.filter((x) => x >= 43.9);
  check(sizes.length >= 3, `phone zoom: the phone tab had ${sizes.length} decisions to measure`);
  check(
    zoomStats.followedTurns >= Math.ceil(sizes.length * 0.9),
    `phone zoom: on its own turn the view followed the ship ${zoomStats.followedTurns}/${sizes.length}, tiles ≥ 44 px on ${zoomedSizes.length}`,
  );
  check(
    zoomedSizes.length === zoomStats.followedTurns,
    "phone zoom: every zoomed decision had tiles of at least 44 px",
  );
  check(
    zoomStats.fellBackToFit <= Math.ceil(sizes.length * 0.5),
    `phone zoom: no tappable target in view only ${zoomStats.fellBackToFit}/${sizes.length} times`,
  );
}

// ---------------------------------------------------------------------------
// Result.
const result = await pages[0]
  .locator(".result")
  .innerText({ timeout: 5000 })
  .catch(() => null);
check(result !== null, "the game reached the result screen");
const finalSeqs = await Promise.all(pages.map(seqOf));
check(new Set(finalSeqs).size === 1, `all tabs end on the same seq (${finalSeqs.join(", ")})`);
const results = await Promise.all(
  pages.map((p) =>
    p
      .locator(".result ol")
      .innerText()
      .catch(() => ""),
  ),
);
check(new Set(results).size === 1, "all tabs show the same result");

// ---------------------------------------------------------------------------
// Rematch (B3): the host plays again; removed and closed seats are dropped.
{
  const live = pages.filter((p) => !p.isClosed());
  const others = live.slice(1);
  await pages[0].setViewportSize({ width: 390, height: 844 }); // the host on a phone
  check(await noHorizontalScroll(pages[0]), "phone: the result has no horizontal scroll");
  const playAgain = pages[0].getByRole("button", { name: "Play again" });
  check((await playAgain.count()) === 1, "the host sees a Play again button");
  const box = await playAgain.boundingBox();
  check(box !== null && box.height >= 40, `phone: Play again is at least 40 px (${box?.height})`);
  for (const p of others) {
    check(
      (await p.getByRole("button", { name: "Play again" }).count()) === 0 &&
        (await p.getByText("The host can start a rematch.").count()) === 1,
      "a player who is not the host cannot start a rematch",
    );
  }
  await playAgain.click();
  for (const p of live) await p.locator(".seats").waitFor({ timeout: 5000 });
  check(
    (await pages[0].locator(".seats li").count()) === live.length,
    `after the rematch the lobby holds the ${live.length} players still here`,
  );
  for (const p of live) {
    const gone =
      (await p.locator(".result").count()) === 0 && (await p.locator(".award-list").count()) === 0;
    const logs = await p.locator(".log li").allInnerTexts();
    check(gone && logs.length <= 1, "the old result and log are gone on every tab");
  }
  await pages[0].getByRole("button", { name: "Start game" }).click();
  check(await waitAllSeq(live, 0), "the rematch starts at seq 0 on every tab");
  for (const p of live) {
    check(
      (await p.locator(".result").count()) === 0 &&
        !(await p.locator(".log li").allInnerTexts()).some((l) =>
          /^Game over|^Golden Hook/.test(l),
        ),
      "the new game shows nothing of the last one",
    );
  }
  let played = 0;
  for (let i = 0; i < 40 && played < 8; i++) {
    if (await step(live)) played++;
    else await new Promise((r) => setTimeout(r, 250));
  }
  check(played >= 8, `the rematch can be played (${played} actions)`);
  check(await noHorizontalScroll(pages[0]), "phone: the rematch table has no horizontal scroll");
}

console.log("\n==== Result");
console.log(result ?? "(none)");
console.log(`\nClicks: ${stats.actions} (server seq ${finalSeqs[0]})`);
console.log(
  Object.entries(stats.byKind)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n"),
);
console.log(`\nChecks: ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
const errors = problems.filter((p) => !checks.some((c) => c.what === p));
console.log(`Console/page errors and other problems: ${errors.length}`);
for (const p of errors) console.log(`  - ${p}`);

await browser.close();
process.exit(problems.length ? 1 : 0);
