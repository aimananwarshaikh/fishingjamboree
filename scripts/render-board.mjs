#!/usr/bin/env node
// Draws content/board.json over the board art so the trace can be checked by eye.
//
//   node scripts/render-board.mjs [out.jpg]
//
// Writes an SVG next to the image. The JPEG needs Playwright (resolved from the
// environment; not a project dependency). Without it, only the SVG is written.
// If Playwright is installed globally, run with NODE_PATH="$(npm root -g)".
//
// Tile colours: zone 1 teal, zone 2 light blue, zone 3 dark blue, risk areas red
// (S = Shipwreck Bay, J = Davy Jones' Locker), island yellow, docks brown,
// off-board grey hatch. Fishing spots get a gold ring and their number.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? resolve(root, "assets/board/board-overlay.jpg"));
const svgOut = out.replace(/\.(png|jpe?g)$/i, "") + ".svg";

const board = JSON.parse(readFileSync(resolve(root, "content/board.json"), "utf8"));
const imagePath = resolve(root, "assets/board/board.webp");

// Board art is 1378x1969; the grid is 8x20 tiles of ~98.4px starting at x=293.
const IMG_W = 1378;
const IMG_H = 1969;
const TILE = IMG_H / board.height;
const ORIGIN_X = 293;

const fill = {
  "~1": "#00e5d0",
  "~2": "#2fa8ff",
  "~3": "#1a2cff",
  S: "#ff2a2a",
  J: "#c4006e",
  "#": "#ffd400",
  D: "#8a5a1e",
};

const spots = new Map(board.fishingSpots.map((s) => [`${s.x},${s.y}`, s.spot]));
const docks = new Map(board.docks.map((d) => [`${d.x},${d.y}`, d]));

const cells = [];
for (let y = 0; y < board.height; y++) {
  for (let x = 0; x < board.width; x++) {
    const t = board.terrain[y][x];
    const z = board.zones[y][x];
    const px = ORIGIN_X + x * TILE;
    const py = y * TILE;
    if (t === ".") {
      cells.push(
        `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="url(#off)" stroke="#555" stroke-width="1"/>`,
      );
      continue;
    }
    const colour = t === "~" ? fill[`~${z}`] : fill[t];
    let label = t === "~" ? z : t;
    const dock = docks.get(`${x},${y}`);
    if (dock) label = dock.id;
    cells.push(
      `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${colour}" fill-opacity="0.45" stroke="#000" stroke-width="2"/>`,
    );
    const size = label.length > 2 ? 16 : 30;
    cells.push(
      `<text x="${px + TILE / 2}" y="${py + TILE / 2 + size / 3}" font-size="${size}" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#fff" stroke="#000" stroke-width="1">${label}</text>`,
    );
    const spot = spots.get(`${x},${y}`);
    if (spot !== undefined) {
      cells.push(
        `<circle cx="${px + TILE / 2}" cy="${py + TILE / 2}" r="${TILE * 0.42}" fill="none" stroke="#ffd700" stroke-width="6"/>`,
        `<text x="${px + 14}" y="${py + 26}" font-size="22" font-family="sans-serif" font-weight="bold" fill="#ffd700" stroke="#000" stroke-width="1">F${spot}</text>`,
      );
    }
  }
}
// Column and row indices.
for (let x = 0; x < board.width; x++) {
  cells.push(
    `<text x="${ORIGIN_X + x * TILE + TILE / 2}" y="${IMG_H - 4}" font-size="18" text-anchor="middle" font-family="monospace" fill="#fff" stroke="#000" stroke-width="0.8">x${x}</text>`,
  );
}
for (let y = 0; y < board.height; y++) {
  cells.push(
    `<text x="${ORIGIN_X - 6}" y="${y * TILE + TILE / 2 + 6}" font-size="18" text-anchor="end" font-family="monospace" fill="#fff" stroke="#000" stroke-width="0.8">y${y}</text>`,
  );
}

const imageHref = relative(dirname(svgOut), imagePath).split("\\").join("/");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${IMG_W}" height="${IMG_H}" viewBox="0 0 ${IMG_W} ${IMG_H}">
<defs><pattern id="off" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#000" fill-opacity="0.25"/><line x1="0" y1="0" x2="0" y2="12" stroke="#ccc" stroke-width="3"/></pattern></defs>
<image href="${imageHref}" xlink:href="${imageHref}" width="${IMG_W}" height="${IMG_H}"/>
${cells.join("\n")}
</svg>
`;
writeFileSync(svgOut, svg);
console.log(`wrote ${svgOut}`);

let playwright;
try {
  playwright = createRequire(import.meta.url)("playwright");
} catch {
  console.log("playwright not found; image skipped (open the SVG in a browser instead)");
  process.exit(0);
}
const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: IMG_W, height: IMG_H } });
await page.goto(pathToFileURL(svgOut).href);
const png = /\.png$/i.test(out);
await page.screenshot({ path: out, type: png ? "png" : "jpeg", ...(png ? {} : { quality: 82 }) });
await browser.close();
console.log(`wrote ${out}`);
