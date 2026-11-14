/**
 * Validates an incoming client message (already JSON-parsed by the
 * transport). Anything a client sends is untrusted: the result is rebuilt
 * field by field, so extra properties (such as a forged `player`) are dropped.
 */
import type { ClientAction, ClientMessage } from "./protocol";

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: string };

/** Longest string accepted in any field. */
const MAX_STRING = 64;

const fail = (reason: string): ParseResult => ({ ok: false, reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isShortString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_STRING;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseAction(raw: unknown): ClientAction | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "roll":
    case "useHelicopter":
    case "endTurn":
      return { type: raw.type };
    case "placeShip":
      return isShortString(raw.dock) ? { type: "placeShip", dock: raw.dock } : null;
    case "move":
      return isCount(raw.to) ? { type: "move", to: raw.to } : null;
    case "buyUpgrade":
      return raw.upgrade === "speed" || raw.upgrade === "capacity"
        ? { type: "buyUpgrade", upgrade: raw.upgrade }
        : null;
    default:
      return null;
  }
}

export function parseClientMessage(raw: unknown): ParseResult {
  if (!isRecord(raw)) return fail("a message must be a JSON object");
  switch (raw.type) {
    case "create":
      if (!isCount(raw.v)) return fail("create: v must be a number");
      if (typeof raw.name !== "string") return fail("create: name must be a string");
      return { ok: true, message: { type: "create", v: raw.v, name: raw.name } };
    case "join":
      if (!isCount(raw.v)) return fail("join: v must be a number");
      if (!isShortString(raw.code)) return fail("join: code must be a short string");
      if (typeof raw.name !== "string") return fail("join: name must be a string");
      return { ok: true, message: { type: "join", v: raw.v, code: raw.code, name: raw.name } };
    case "rejoin":
      if (!isCount(raw.v)) return fail("rejoin: v must be a number");
      if (!isShortString(raw.code)) return fail("rejoin: code must be a short string");
      if (!isShortString(raw.seatToken)) return fail("rejoin: seatToken must be a short string");
      return {
        ok: true,
        message: { type: "rejoin", v: raw.v, code: raw.code, seatToken: raw.seatToken },
      };
    case "start":
    case "sync":
    case "leave":
      return { ok: true, message: { type: raw.type } };
    case "kick":
      if (!isShortString(raw.seat)) return fail("kick: seat must be a short string");
      return { ok: true, message: { type: "kick", seat: raw.seat } };
    case "intent": {
      if (!isShortString(raw.clientActionId)) {
        return fail("intent: clientActionId must be a short string");
      }
      if (!isCount(raw.seq)) return fail("intent: seq must be a whole number");
      const action = parseAction(raw.action);
      if (!action) return fail("intent: action is not a valid action");
      return {
        ok: true,
        message: { type: "intent", clientActionId: raw.clientActionId, seq: raw.seq, action },
      };
    }
    default:
      return fail("unknown message type");
  }
}
