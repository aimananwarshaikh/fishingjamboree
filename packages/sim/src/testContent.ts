/** Test helper: the repo's content, compiled once. */
import { fileURLToPath } from "node:url";
import { compileOrThrow, readRawContent } from "./content";

export const CONTENT_DIR = fileURLToPath(new URL("../../../content", import.meta.url));
export const raw = readRawContent(CONTENT_DIR);
export const content = compileOrThrow(raw);
