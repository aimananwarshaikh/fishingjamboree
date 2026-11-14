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
 *
 * Besides the game it also checks: a refresh mid-game keeps the seat, a double
 * click on a button is quiet, a 4th player can join a lobby, and a phone-width
 * tab (390 px) has no horizontal scroll and tappable buttons; the host removes
 * the 4th player from the lobby. With GRACE=1 the closed tab's turns are missed
 * and, after three in a row, its player is removed from the game. Rejoining (P1-1):
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
  const targets = await page.locator("svg.board .target").all();
  return { buttons, targets };
}

const stats = { actions: 0, byKind: {} };
function count(kind) {
  stats.actions++;
  stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
}

/** Makes one choice on whichever tab has something to do. Returns false if nobody does. */
async function step(pages, opts = {}) {
  const before = Math.max(...(await Promise.all(pages.map(seqOf))));
  for (const page of pages) {
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
    const p = pages[2];
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
    await p.setViewportSize({ width: 1200, height: 900 });
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
    // Keep playing the remaining seats; the server must act for the closed one.
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
