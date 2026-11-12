import { useMemo, useState } from "react";
import { getLegalActions } from "@fishingjamboree/engine";
import type { Action, Content, PlayerView } from "@fishingjamboree/engine";
import type { RoomInfo } from "../../../packages/server/src/protocol";
import { Board, playerColor } from "./Board";
import { describeAction } from "./describe";
import { loadBundledContent } from "./content";
import { useGame } from "./useGame";
import type { ClientState } from "./store";

const content = loadBundledContent();

export function App() {
  const game = useGame(content);
  const { state } = game;
  return (
    <main>
      <header>
        <h1>Fishing Jamboree</h1>
        <span className={`conn ${state.connection}`}>{state.connection}</span>
      </header>
      {state.contentMismatch && (
        <p className="notice error">
          This page and the server have different game content. Reload after updating, or the board
          and legal moves may be wrong.
        </p>
      )}
      {state.notice && (
        <p className="notice error" onClick={game.dismiss} role="alert">
          {state.notice} <small>(tap to dismiss)</small>
        </p>
      )}
      {!state.session || !state.room ? (
        <Start busy={state.connection === "connecting"} onCreate={game.create} onJoin={game.join} />
      ) : state.room.status === "lobby" || !state.game ? (
        <Lobby state={state} room={state.room} onStart={game.start} onLeave={game.leave} />
      ) : (
        <Table state={state} room={state.room} act={game.act} onLeave={game.leave} />
      )}
    </main>
  );
}

function Start(props: {
  busy: boolean;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const ready = name.trim().length > 0 && !props.busy;
  return (
    <section className="card">
      <label>
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <button disabled={!ready} onClick={() => props.onCreate(name)}>
        Create a room
      </button>
      <hr />
      <label>
        Room code
        <input
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
        />
      </label>
      <button
        disabled={!ready || code.trim().length !== 4}
        onClick={() => props.onJoin(code, name)}
      >
        Join room
      </button>
    </section>
  );
}

function Lobby(props: {
  state: ClientState;
  room: RoomInfo;
  onStart: () => void;
  onLeave: () => void;
}) {
  const { room, state } = props;
  const isHost = state.session?.seat === room.host;
  return (
    <section className="card">
      <h2>
        Room <span className="code">{room.code}</span>
      </h2>
      <p>
        Share this code. {room.minPlayers}–{room.maxPlayers} players.
      </p>
      <ul className="seats">
        {room.seats.map((s) => (
          <li key={s.seat}>
            <span className="dot" style={{ background: playerColor(s.seat) }} />
            {s.name}
            {s.seat === room.host && " (host)"}
            {s.seat === state.session?.seat && " (you)"}
            {!s.connected && " – disconnected"}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button disabled={room.seats.length < room.minPlayers} onClick={props.onStart}>
          Start game
        </button>
      ) : (
        <p>Waiting for the host to start…</p>
      )}
      <button className="secondary" onClick={props.onLeave}>
        Leave
      </button>
    </section>
  );
}

function phaseText(view: PlayerView, name: (p: string) => string, me: string): string {
  const actor = view.phase.actors[0];
  const who = actor === me ? "You" : actor ? name(actor) : "Nobody";
  switch (view.phase.kind) {
    case "placeShip":
      return `${who}: choose a starting dock.`;
    case "roll":
      return `${who}: roll the die.`;
    case "move":
      return `${who}: move ${view.phase.roll.steps} step(s) or fewer to a highlighted tile.`;
    case "dockShop":
      return `${who}: at the dock, buy upgrades or end the turn.`;
    case "turnEnd":
      return `${who}: end the turn (or use the helicopter).`;
    case "gameOver":
      return "Game over.";
  }
}

function Table(props: {
  state: ClientState;
  room: RoomInfo;
  act: (a: Action) => void;
  onLeave: () => void;
}) {
  const { state, room } = props;
  const view = state.game!.view;
  const me = state.session!.seat;
  const names = useMemo(
    () => Object.fromEntries(room.seats.map((s) => [s.seat, s.name])),
    [room.seats],
  );
  const name = (p: string) => names[p] ?? p;
  const legal = useMemo(() => getLegalActions(content as Content, view, me), [view, me]);
  const buttons = legal.filter((a) => a.type !== "move" && a.type !== "placeShip");
  const dockChoices = legal.filter((a) => a.type === "placeShip");
  const disabled = state.pending !== null;
  const rounds = content.rules.rounds;
  const event = view.activeEvent ? content.cards.cards[view.activeEvent.card] : null;

  return (
    <div className="table">
      <section className="board-wrap">
        <Board content={content} view={view} legal={legal} names={names} onAction={props.act} />
      </section>
      <aside>
        <div className="card">
          <div className="round">
            Round {view.round}/{rounds}
            <div className="bar">
              <div className="fill" style={{ width: `${(view.round / rounds) * 100}%` }} />
              {content.rules.eventAfterRounds.map((r) => (
                <i
                  key={r}
                  style={{ left: `${(r / rounds) * 100}%` }}
                  title={`Event after round ${r}`}
                />
              ))}
            </div>
          </div>
          <p className={legal.length ? "turn mine" : "turn"}>{phaseText(view, name, me)}</p>
          {event && <p className="event">Event: {event.name}</p>}
          <div className="actions">
            {dockChoices.map((a, i) => (
              <button key={`d${i}`} disabled={disabled} onClick={() => props.act(a)}>
                {describeAction(a, content)}
              </button>
            ))}
            {buttons.map((a, i) => (
              <button key={i} disabled={disabled} onClick={() => props.act(a)}>
                {describeAction(a, content)}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <table className="players">
            <thead>
              <tr>
                <th>Player</th>
                <th>Cash</th>
                <th>Fish</th>
                <th>Fines</th>
                <th>Up</th>
              </tr>
            </thead>
            <tbody>
              {view.players.map((p) => {
                const cap = p.upgrades.capacity
                  ? content.rules.upgrades.capacity.capacity
                  : content.rules.baseCapacity;
                const seat = room.seats.find((s) => s.seat === p.id);
                return (
                  <tr key={p.id} className={view.phase.actors[0] === p.id ? "active" : ""}>
                    <td>
                      <span className="dot" style={{ background: playerColor(p.id) }} />
                      {name(p.id)}
                      {p.id === me && " (you)"}
                      {seat && !seat.connected && " ⚠"}
                    </td>
                    <td>${p.cash}</td>
                    <td>
                      {p.fish.length}/{cap}
                    </td>
                    <td>{p.fineTokens}</td>
                    <td>
                      {p.upgrades.speed ? "S" : ""}
                      {p.upgrades.capacity ? "C" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {view.result && (
          <div className="card result">
            <h2>Result</h2>
            <ol>
              {[...view.result.scores]
                .sort((a, b) => b.total - a.total)
                .map((s) => (
                  <li key={s.player}>
                    {name(s.player)}: ${s.total} (cash ${s.cash}, {s.fineTokens} fine token(s))
                    {view.result?.winners.includes(s.player) ? " 🏆" : ""}
                  </li>
                ))}
            </ol>
            <button className="secondary" onClick={props.onLeave}>
              Leave room
            </button>
          </div>
        )}

        <div className="card log">
          <h3>Log</h3>
          <ol reversed>
            {[...state.log].reverse().map((l) => (
              <li key={l.id} className={l.kind}>
                {l.text}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
