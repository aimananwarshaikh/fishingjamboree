export const ENGINE_VERSION = "0.0.0";

export type * from "./types";

export { compileContent } from "./content";
export { createGame } from "./setup";
export { getActors, getLegalActions } from "./legal";
export { applyAction } from "./apply";
export { redactForClient } from "./view";
export { replay } from "./replay";
/** For the simulator (B6): resolves one award on a finished game's players and stats. */
export { resolveAward } from "./awards";
