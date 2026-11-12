import { useEffect, useMemo, useState } from "react";
import { getLegalActions } from "@fishingjamboree/engine";
import type { Action, Content, PlayerView, UpgradeId } from "@fishingjamboree/engine";
import type { RoomInfo, SeatInfo } from "../../../packages/server/src/protocol";
import { Board, playerColor } from "./Board";
import { describeAction, phaseTask, seatStatus, upgradeText } from "./describe";
import { loadBundledContent } from "./content";
import { useGame } from "./useGame";
import type { Banner, ClientState } from "./store";

const content = loadBundledContent();

export function App() {
  const game = useGame(content);
  const { state } = game;
  return (
    <main>
      <header>
        <h1>Fishing Jamboree</h1>
        <span className={`conn ${state.connection}`}>
          {state.connection === "closed" && state.session ? "reconnecting…" : state.connection}
        </span>
      </header>
      <BannerView banner={state.banner} />
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

/** Shows each new banner for a moment. It never blocks clicks. */
function BannerView({ banner }: { banner: Banner | null }) {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!banner) return;
    setShown(banner.id);
    const timer = window.setTimeout(() => setShown(null), 2500);
    return () => window.clearTimeout(timer);
  }, [banner]);
  if (!banner || shown !== banner.id) return null;
  return (
    <div className="banner" role="status" aria-live="polite">
      <strong>{banner.title}</strong>
      {banner.detail && <span>{banner.detail}</span>}
    </div>
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
  const missing = room.seats.filter((s) => !s.connected).map((s) => s.name);
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
        <>
          <button
            disabled={room.seats.length < room.minPlayers || missing.length > 0}
            onClick={props.onStart}
          >
            Start game
          </button>
          {room.seats.length < room.minPlayers && (
            <p>Waiting for at least {room.minPlayers} players…</p>
          )}
          {missing.length > 0 && <p>Waiting for {missing.join(", ")} to reconnect…</p>}
        </>
      ) : (
        <p>Waiting for the host to start…</p>
      )}
      <button className="secondary" onClick={props.onLeave}>
        Leave
      </button>
    </section>
  );
}

function TurnStatus(props: {
  view: PlayerView;
  me: string;
  name: (p: string) => string;
  seats: SeatInfo[];
}) {
  const { view, me, name } = props;
  if (view.phase.kind === "gameOver") return <p className="turn">Game over.</p>;
  const actor = view.phase.actors[0];
  if (!actor) return <p className="turn">…</p>;
  if (actor === me) {
    const hint =
      view.phase.kind === "move"
        ? " Tap a highlighted tile."
        : view.phase.kind === "placeShip"
          ? " Tap a button or a highlighted dock."
          : "";
    return (
      <p className="turn mine">
        Your turn: {phaseTask(view)}.{hint}
      </p>
    );
  }
  const status = seatStatus(props.seats.find((s) => s.seat === actor));
  return (
    <p className="turn waiting">
      Waiting for <b>{name(actor)}</b> to {phaseTask(view)}
      {status ? ` (${status})` : ""}…
    </p>
  );
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
  const dockChoices = legal.filter((a) => a.type === "placeShip");
  const upgrades = legal.filter(
    (a): a is Action & { type: "buyUpgrade"; upgrade: UpgradeId } => a.type === "buyUpgrade",
  );
  const helicopter = legal.find((a) => a.type === "useHelicopter");
  const others = legal.filter((a) => a.type === "roll" || a.type === "endTurn");
  const disabled = state.pending !== null;
  const rounds = content.rules.rounds;
  const event = view.activeEvent ? content.cards.cards[view.activeEvent.card] : null;
  const fee = event?.effect.kind === "helicopter" ? event.effect.fee : null;
  const mine = view.players.find((p) => p.id === me);
  const shopping = view.phase.kind === "dockShop" && view.phase.actors[0] === me;

  return (
    <div className="table" data-seq={state.game!.seq} data-me={me}>
      <section className="board-wrap">
        <Board content={content} view={view} legal={legal} names={names} onAction={props.act} />
      </section>
      <div className="card status">
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
        <TurnStatus view={view} me={me} name={name} seats={room.seats} />
        {event && (
          <p className="event">
            Event: <b>{event.name}</b>
            {fee !== null && ` (sell your fish from anywhere for $${fee}, once per turn)`}
          </p>
        )}
        <div className="actions">
          {dockChoices.map((a, i) => (
            <button key={`d${i}`} disabled={disabled} onClick={() => props.act(a)}>
              {describeAction(a, content)}
            </button>
          ))}
          {shopping && (
            <div className="shop">
              <h3>Dock shop</h3>
              <p>
                You have ${mine?.cash ?? 0}.
                {upgrades.length === 0 && " There is no upgrade you can buy right now."}
              </p>
              {upgrades.map((a) => (
                <button key={a.upgrade} disabled={disabled} onClick={() => props.act(a)}>
                  {describeAction(a, content)}
                  <small>{upgradeText(content, a.upgrade)}</small>
                </button>
              ))}
            </div>
          )}
          {helicopter && (
            <button
              className="helicopter"
              disabled={disabled}
              onClick={() => props.act(helicopter)}
            >
              {describeAction(helicopter, content)}
              <small>
                sell your {mine?.fish.length ?? 0} fish now
                {fee !== null ? ` for a $${fee} fee` : ""}
              </small>
            </button>
          )}
          {others.map((a) => (
            <button
              key={a.type}
              className={a.type === "endTurn" && shopping ? "secondary" : undefined}
              disabled={disabled}
              onClick={() => props.act(a)}
            >
              {a.type === "endTurn" && shopping ? "Done: end turn" : describeAction(a, content)}
            </button>
          ))}
        </div>
      </div>
      <aside>
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
                      {seat && !seat.connected && (
                        <small
                          className={seat.away ? "away" : "disconnected"}
                          title={seatStatus(seat) ?? ""}
                        >
                          {seat.away ? "away" : "offline"}
                        </small>
                      )}
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
