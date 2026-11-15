/**
 * The board: the art (assets/board/board.webp) with content/board.json's
 * tiles on top. The tiles themselves are invisible; only what a player can
 * click (move destinations, starting docks), the ships and the Golden Fish are
 * drawn. Ships and the Golden Fish come from the animation frame (animation.ts),
 * so they sail along their paths; with nothing queued the frame is the view.
 */
import type { Action, Content, PlayerView } from "@fishingjamboree/engine";
import boardUrl from "../../../assets/board/board.webp";
import type { Frame } from "./animation";
import { ART, boardTargets, shipMarks, tileOrigin, viewBox } from "./boardArt";

export const PLAYER_COLORS = ["#e4572e", "#f2b705", "#3fa34d", "#9b5de5"];

export function playerColor(seat: string): string {
  const n = Number.parseInt(seat.slice(1), 10);
  return PLAYER_COLORS[(Number.isFinite(n) ? n - 1 : 0) % PLAYER_COLORS.length] ?? "#888";
}

interface Props {
  content: Content;
  view: PlayerView;
  frame: Frame;
  legal: Action[];
  /** Seat -> display name, for tooltips. */
  names: Record<string, string>;
  onAction: (action: Action) => void;
}

const T = ART.tile;

export function Board({ content, view, frame, legal, names, onAction }: Props) {
  const { board } = content;
  const targets = boardTargets(content, legal);
  const actor = view.phase.actors[0];
  const box = viewBox(board.width);
  const fish = frame.goldenFish;
  const fishTile = fish ? board.tiles[fish.tile] : null;

  return (
    <svg
      className="board"
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      role="img"
      aria-label="Game board"
    >
      <image href={boardUrl} x={0} y={0} width={ART.width} height={ART.height} />

      {fish && fishTile && (
        <g
          className="golden-fish"
          transform={`translate(${tileOrigin(fishTile.x, fishTile.y).x + T / 2} ${tileOrigin(fishTile.x, fishTile.y).y + T / 2}) scale(${T / 36})`}
          pointerEvents="none"
        >
          <polygon
            points="0,-14 4,-4 14,-4 6,3 9,13 0,7 -9,13 -6,3 -14,-4 -4,-4"
            fill="#ffd23f"
            stroke="#7a5b00"
          />
          <title>{`Golden Fish $${fish.value}`}</title>
        </g>
      )}

      {shipMarks(
        content,
        frame,
        view.players.map((p) => p.id),
      ).map((m) => {
        const active = actor === m.player;
        const r = T * (active ? 0.3 : 0.26);
        return (
          <g
            key={m.player}
            className="ship"
            data-player={m.player}
            transform={`translate(${m.x} ${m.y})`}
            opacity={m.opacity}
            pointerEvents="none"
          >
            <circle
              r={r}
              fill={playerColor(m.player)}
              stroke={active ? "#fff" : "#111"}
              strokeWidth={active ? 7 : 4}
            />
            <text y={T * 0.12} textAnchor="middle" className="ship-label">
              {m.player.slice(1)}
            </text>
            <title>{names[m.player] ?? m.player}</title>
          </g>
        );
      })}

      {[...targets].map(([tileId, action]) => {
        const tile = board.tiles[tileId];
        if (!tile) return null;
        const o = tileOrigin(tile.x, tile.y);
        return (
          <rect
            key={tileId}
            className="target"
            x={o.x + 4}
            y={o.y + 4}
            width={T - 8}
            height={T - 8}
            rx={10}
            onClick={() => onAction(action)}
          >
            <title>{action.type === "move" ? "Sail here" : "Start here"}</title>
          </rect>
        );
      })}
    </svg>
  );
}
