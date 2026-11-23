/**
 * Robot playtests (B7): a page opened with `?robot=1` publishes what this
 * tab's player already has (their own redacted view, seat and room) on
 * `window.__fjRobot`, so a bot can choose among the actions the page offers
 * (each offered button and board target carries `data-action`). Nothing is
 * read back from it, and nothing on it is hidden from this player.
 */
import { useEffect } from "react";
import type { ClientState } from "./store";

export interface RobotSnapshot {
  connection: ClientState["connection"];
  seat: string | null;
  room: ClientState["room"];
  seq: number | null;
  view: NonNullable<ClientState["game"]>["view"] | null;
  pending: boolean;
  notice: string | null;
  log: string[];
}

export function robotSnapshot(state: ClientState): RobotSnapshot {
  return {
    connection: state.connection,
    seat: state.session?.seat ?? null,
    room: state.room,
    seq: state.game?.seq ?? null,
    view: state.game?.view ?? null,
    pending: state.pending !== null,
    notice: state.notice,
    log: state.log.map((l) => l.text),
  };
}

export function isRobotPage(search: string): boolean {
  return new URLSearchParams(search).get("robot") === "1";
}

const ROBOT = typeof window !== "undefined" && isRobotPage(window.location.search);

/** Publishes the snapshot after every render when the page is a robot page; does nothing otherwise. */
export function useRobotHook(state: ClientState): void {
  useEffect(() => {
    if (!ROBOT) return;
    (window as unknown as { __fjRobot?: RobotSnapshot }).__fjRobot = robotSnapshot(state);
  });
}

/** `data-action` for an offered action (robot playtests pick by it; harmless for people). */
export function actionAttr(action: unknown): string {
  return JSON.stringify(action);
}
