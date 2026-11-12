/** The board as an SVG grid drawn from content/board.json. No art. */
import type { Action, Content, PlayerView, TileId } from "@fishingjamboree/engine";

const CELL = 36;

const TERRAIN_FILL: Record<string, string> = {
  island: "#c9b37e",
  risk: "#8a3b3b",
  dock: "#7a5230",
};
const ZONE_FILL: Record<number, string> = { 1: "#9fd8e6", 2: "#5aa6cf", 3: "#2f6190" };
export const PLAYER_COLORS = ["#e4572e", "#f2b705", "#3fa34d", "#9b5de5"];

export function playerColor(seat: string): string {
  const n = Number.parseInt(seat.slice(1), 10);
  return PLAYER_COLORS[(Number.isFinite(n) ? n - 1 : 0) % PLAYER_COLORS.length] ?? "#888";
}

interface Props {
  content: Content;
  view: PlayerView;
  legal: Action[];
  /** Seat -> display name, for tooltips. */
  names: Record<string, string>;
  onAction: (action: Action) => void;
}

export function Board({ content, view, legal, names, onAction }: Props) {
  const { board } = content;
  // Tiles that can be clicked: move destinations and starting docks.
  const clickable = new Map<TileId, Action>();
  for (const a of legal) {
    if (a.type === "move") clickable.set(a.to, a);
    if (a.type === "placeShip") {
      const dock = board.docks.find((d) => d.id === a.dock);
      if (dock) clickable.set(dock.tile, a);
    }
  }
  const actor = view.phase.actors[0];

  return (
    <svg
      className="board"
      viewBox={`0 0 ${board.width * CELL} ${board.height * CELL}`}
      role="img"
      aria-label="Game board"
    >
      {board.tiles.map((tile) => {
        if (!tile) return null;
        const fill =
          tile.terrain === "sea" ? (ZONE_FILL[tile.zone] ?? "#4a90b8") : TERRAIN_FILL[tile.terrain];
        const action = clickable.get(tile.id);
        return (
          <g key={tile.id} transform={`translate(${tile.x * CELL} ${tile.y * CELL})`}>
            <rect width={CELL} height={CELL} fill={fill} stroke="#1c3a52" strokeWidth={0.5} />
            {tile.terrain === "dock" && (
              <text x={CELL / 2} y={CELL / 2 + 5} textAnchor="middle" className="tile-label">
                D
              </text>
            )}
            {tile.terrain === "island" && (
              <text x={CELL / 2} y={CELL / 2 + 5} textAnchor="middle" className="tile-label dim">
                #
              </text>
            )}
            {tile.terrain === "sea" && tile.fishingSpot !== null && (
              <g>
                <circle
                  cx={CELL / 2}
                  cy={CELL / 2}
                  r={11}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2}
                />
                <text x={CELL / 2} y={CELL / 2 + 5} textAnchor="middle" className="tile-label">
                  {tile.fishingSpot}
                </text>
              </g>
            )}
            {tile.terrain === "risk" && (
              <text x={CELL / 2} y={CELL / 2 + 5} textAnchor="middle" className="tile-label">
                !
              </text>
            )}
            {action && (
              <rect
                className="target"
                width={CELL - 4}
                height={CELL - 4}
                x={2}
                y={2}
                onClick={() => onAction(action)}
              >
                <title>{action.type === "move" ? "Sail here" : "Start here"}</title>
              </rect>
            )}
          </g>
        );
      })}

      {view.goldenFish &&
        (() => {
          const t = board.tiles[view.goldenFish.tile];
          if (!t) return null;
          return (
            <g
              transform={`translate(${t.x * CELL + CELL / 2} ${t.y * CELL + CELL / 2})`}
              pointerEvents="none"
            >
              <polygon
                points="0,-14 4,-4 14,-4 6,3 9,13 0,7 -9,13 -6,3 -14,-4 -4,-4"
                fill="#ffd23f"
                stroke="#7a5b00"
              />
              <title>{`Golden Fish $${view.goldenFish.value}`}</title>
            </g>
          );
        })()}

      {view.players.map((p, i) => {
        if (p.position === null) return null;
        const t = board.tiles[p.position];
        if (!t) return null;
        // Ships sharing a dock are nudged apart.
        const sameTile = view.players.slice(0, i).filter((q) => q.position === p.position).length;
        const cx = t.x * CELL + CELL / 2 + (sameTile % 2 ? 8 : -8) * (sameTile ? 1 : 0);
        const cy = t.y * CELL + CELL / 2 + sameTile * 4;
        return (
          <g key={p.id} transform={`translate(${cx} ${cy})`} pointerEvents="none">
            <circle
              r={actor === p.id ? 12 : 10}
              fill={playerColor(p.id)}
              stroke={actor === p.id ? "#fff" : "#111"}
              strokeWidth={actor === p.id ? 3 : 1.5}
            />
            <text y={5} textAnchor="middle" className="ship-label">
              {p.id.slice(1)}
            </text>
            <title>{names[p.id] ?? p.id}</title>
          </g>
        );
      })}
    </svg>
  );
}
