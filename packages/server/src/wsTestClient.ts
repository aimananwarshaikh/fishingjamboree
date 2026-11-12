/**
 * Test helper: a WebSocket client that records every message from the server
 * and keeps the latest game view. Only tests import this.
 */
import { WebSocket } from "ws";
import type { ClientOptions } from "ws";
import type { PlayerView } from "@fishingjamboree/engine";
import type { ServerMessage, ServerMessageType } from "./protocol";

type MessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

export interface Closed {
  code: number;
  reason: string;
}

const WAIT_MS = 3_000;

export class TestClient {
  /** Every message received, in order. */
  readonly messages: ServerMessage[] = [];
  /** The latest game view received (from `welcome`, `snapshot` or `update`). */
  view: PlayerView | null = null;
  readonly closed: Promise<Closed>;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString() });
        this.wake();
      });
    });
    ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      this.messages.push(message);
      if (message.type === "update") this.view = message.view;
      if ((message.type === "welcome" || message.type === "snapshot") && message.game) {
        this.view = message.game.view;
      }
      this.wake();
    });
  }

  static connect(url: string, options: ClientOptions = {}): Promise<TestClient> {
    const ws = new WebSocket(url, options);
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(client));
      ws.once("error", reject);
    });
  }

  send(message: unknown) {
    this.ws.send(JSON.stringify(message));
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** The first message received (ever) that matches, waiting for it if needed. */
  waitFor<T extends ServerMessageType>(
    type: T,
    match: (m: MessageOf<T>) => boolean = () => true,
    timeoutMs = WAIT_MS,
  ): Promise<MessageOf<T>> {
    const find = () =>
      this.messages.find((m): m is MessageOf<T> => m.type === type && match(m as MessageOf<T>));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(new Error(`timed out waiting for "${type}"; got ${JSON.stringify(this.types())}`));
      }, timeoutMs);
      const check = () => {
        const found = find();
        if (!found) return;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        resolve(found);
      };
      this.waiters.push(check);
      check();
    });
  }

  types(): string[] {
    return this.messages.map((m) => (m.type === "error" ? `error:${m.code}` : m.type));
  }

  private wake() {
    for (const waiter of [...this.waiters]) waiter();
  }
}

/** Resolves when `predicate` holds, checking every few milliseconds. */
export async function eventually(predicate: () => boolean, timeoutMs = WAIT_MS): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}
