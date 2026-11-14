/**
 * Test helper: a `ServerCore` on the real content with a hand-wound clock,
 * predictable ids and an inbox per connection. Only tests import this.
 */
import { fileURLToPath } from "node:url";
import { getLegalActions } from "@fishingjamboree/engine";
import type { Action, PlayerView } from "@fishingjamboree/engine";
import { loadContent } from "./content";
import { ServerCore } from "./core";
import type { ConnId, CoreConfig, CoreDeps, Outbound } from "./core";
import { PROTOCOL_VERSION } from "./protocol";
import type { ClientAction, RoomInfo, SeatId, ServerMessage, ServerMessageType } from "./protocol";

export const content = loadContent(fileURLToPath(new URL("../../../content", import.meta.url)));

export const SEED = "harness-seed-7f3a";
export const V = PROTOCOL_VERSION;

type MessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

/** Test-only parts of `CoreDeps`: a stubbed engine and a log to read. */
export type HarnessExtras = Pick<CoreDeps, "engine" | "log">;

export function harness(
  config: Partial<CoreConfig> = {},
  roomCodes: string[] = [],
  extras: HarnessExtras = {},
) {
  let time = 1_000_000;
  let codeCount = 0;
  let tokenCount = 0;
  const codes = [...roomCodes];
  const letters = "BCDFGHJKMNPQRSTVWXZ";
  const core = new ServerCore({
    content,
    now: () => time,
    config,
    ...extras,
    ids: {
      roomCode: () => {
        const n = codeCount++;
        return codes.shift() ?? `BCD${letters[n % letters.length]}`;
      },
      seatToken: () => `token-${++tokenCount}`,
      gameSeed: () => SEED,
    },
  });

  /** Everything the core has asked the transport to do, in order. */
  const sent: Outbound[] = [];
  const inbox = new Map<ConnId, ServerMessage[]>();
  const views = new Map<ConnId, PlayerView>();

  const deliver = (out: Outbound[]): Outbound[] => {
    for (const o of out) {
      sent.push(o);
      if (o.kind !== "send") continue;
      inbox.set(o.to, [...(inbox.get(o.to) ?? []), o.message]);
      const m = o.message;
      if (m.type === "update") views.set(o.to, m.view);
      if ((m.type === "welcome" || m.type === "snapshot") && m.game) views.set(o.to, m.game.view);
    }
    return out;
  };

  const h = {
    core,
    sent,
    now: () => time,
    send: (conn: ConnId, message: unknown) => deliver(core.handleMessage(conn, message)),
    drop: (conn: ConnId) => deliver(core.disconnect(conn)),
    /** Moves the clock forward and runs whatever is due. */
    advance: (ms: number) => {
      time += ms;
      return deliver(core.tick());
    },
    /** Messages received by a connection since the last `take`, removing them. */
    take: (conn: ConnId): ServerMessage[] => {
      const got = inbox.get(conn) ?? [];
      inbox.set(conn, []);
      return got;
    },
    /** The messages of one type received since the last `take`, leaving the inbox alone. */
    got: <T extends ServerMessageType>(conn: ConnId, type: T): MessageOf<T>[] =>
      (inbox.get(conn) ?? []).filter((m): m is MessageOf<T> => m.type === type),
    last: <T extends ServerMessageType>(conn: ConnId, type: T): MessageOf<T> => {
      const all = h.got(conn, type);
      const message = all[all.length - 1];
      if (!message) throw new Error(`${conn} has received no "${type}" message`);
      return message;
    },
    clear: () => inbox.clear(),
    /** The latest game view a connection has been sent. */
    view: (conn: ConnId): PlayerView => {
      const view = views.get(conn);
      if (!view) throw new Error(`${conn} has not been sent a view`);
      return view;
    },
    room: (code: string): RoomInfo => {
      const info = core.roomInfo(code);
      if (!info) throw new Error(`no room ${code}`);
      return info;
    },
    /** A lobby of `n` players: connection `cN` holds seat `pN` with token `tokens[N-1]`. */
    lobby: (n: number) => {
      h.send("c1", { type: "create", v: V, name: "Player 1" });
      const first = h.last("c1", "welcome");
      const code = first.room.code;
      const tokens = [first.seatToken];
      for (let i = 2; i <= n; i += 1) {
        h.send(`c${i}`, { type: "join", v: V, code, name: `Player ${i}` });
        tokens.push(h.last(`c${i}`, "welcome").seatToken);
      }
      return { code, tokens };
    },
    /** A started game of `n` players, inboxes emptied. */
    started: (n: number) => {
      const room = h.lobby(n);
      h.send("c1", { type: "start" });
      h.clear();
      return room;
    },
    intent: (conn: ConnId, action: ClientAction, seq = h.view(conn).actionCount, id = "a") =>
      h.send(conn, { type: "intent", clientActionId: id, seq, action }),
    /** The seat that has to decide now, read from `conn`'s view. */
    actor: (conn: ConnId): SeatId | undefined => h.view(conn).phase.actors[0],
    legal: (conn: ConnId, seat: SeatId): Action[] => getLegalActions(content, h.view(conn), seat),
  };
  return h;
}

export type Harness = ReturnType<typeof harness>;

/** The connection `lobby` gave a seat: "p2" -> "c2". */
export const connOf = (seat: SeatId): ConnId => `c${seat.slice(1)}`;

/** An engine action as a client sends it (no `player`). */
export function strip(action: Action): ClientAction {
  const copy: Record<string, unknown> = { ...action };
  delete copy.player;
  return copy as unknown as ClientAction;
}
