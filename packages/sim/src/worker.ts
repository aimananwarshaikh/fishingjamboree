/** Worker thread for the CLI: plays a share of the specs and posts the records back. */
import { parentPort, workerData } from "node:worker_threads";
import type { RawContent } from "@fishingjamboree/engine";
import type { GameSpec } from "./play";
import { runSpecs } from "./batch";
import { compileOrThrow } from "./content";

const { raw, specs } = workerData as { raw: RawContent; specs: GameSpec[] };
parentPort?.postMessage(runSpecs(compileOrThrow(raw), specs));
