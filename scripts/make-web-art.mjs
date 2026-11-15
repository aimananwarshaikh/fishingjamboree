#!/usr/bin/env node
// Writes web-size copies of assets/art/ into assets/web/ (checked in).
//
//   node scripts/make-web-art.mjs          (or: pnpm art:web)
//
// Tool: sharp (libvips), a root devDependency used only by this script. It is
// not imported by apps/web or any package, so it never reaches the browser
// bundle or the server. Vite imports the finished .webp files from assets/web/.
//
// Sizes (source art is 2250x1650 cards, 1500x1500 tokens, 2250x1125 money):
//   cards   450 x 330 + @2x 900 x 660
//   tokens  160 x 160 + @2x 320 x 320
//   money   400 px wide (height follows the source's ratio)
// Same sub-folders and base names as assets/art/, extension .webp.
// Re-running rewrites every file (same input, same output).

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets/art");
const out = join(root, "assets/web");

/** [group folder, width, height or null (keep the ratio), also write @2x] */
const GROUPS = [
  ["cards", 450, 330, true],
  ["tokens", 160, 160, true],
  ["money", 400, null, false],
];
const QUALITY = 80;

async function files(dir) {
  const names = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) names.push(...(await files(p)));
    else if (/\.jpe?g$/i.test(e.name)) names.push(p);
  }
  return names.sort();
}

async function write(file, width, height, to) {
  // `.toColourspace("srgb")` turns the CMYK token scans into sRGB.
  if (height === null) {
    const meta = await sharp(file).metadata();
    height = Math.round((width * meta.height) / meta.width);
  }
  const { data, info } = await sharp(file)
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .toColourspace("srgb")
    .webp({ quality: QUALITY })
    .toBuffer({ resolveWithObject: true });
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, data);
  return { bytes: data.length, w: info.width, h: info.height };
}

await rm(out, { recursive: true, force: true });
let total = 0;
let count = 0;
for (const [group, w, h, retina] of GROUPS) {
  for (const file of await files(join(src, group))) {
    const rel = relative(src, file).replace(/\.jpe?g$/i, "");
    const jobs = [[1, `${rel}.webp`]];
    if (retina) jobs.push([2, `${rel}@2x.webp`]);
    for (const [scale, name] of jobs) {
      const r = await write(file, w * scale, h === null ? null : h * scale, join(out, name));
      total += r.bytes;
      count += 1;
      console.log(`${name}  ${r.w}x${r.h}  ${(r.bytes / 1024).toFixed(1)} KB`);
    }
  }
}
console.log(`\n${count} files, ${(total / 1024 / 1024).toFixed(2)} MB in assets/web/`);
