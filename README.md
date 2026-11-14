# Fishing Jamboree

Online version of the Fishing Jamboree board game for 3–4 players. See `CLAUDE.md` and
`docs/build-plan.md`.

## Running locally

Needs Node 20+ and pnpm.

```bash
pnpm install
pnpm check   # typecheck + lint + tests
```

### Start the server

```bash
pnpm start:server   # runs once
pnpm dev:server     # restarts when the code changes
```

Settings (environment variables):

| Variable      | Default                     | Meaning                      |
| ------------- | --------------------------- | ---------------------------- |
| `PORT`        | `8787`                      | Port for HTTP and WebSocket  |
| `HOST`        | all interfaces              | Address to listen on         |
| `CONTENT_DIR` | the repository's `content/` | Folder with the content JSON |
| `ROOMS_DIR`   | not set (memory only)       | Folder to save rooms in      |

With `ROOMS_DIR` set, every room is saved there (one JSON file per room, after each change) and restored when the server starts, so a restart does not end games: players come back with their saved seat or rejoin link. The files hold seat tokens and game seeds; keep the folder private. A file that cannot be restored is logged and renamed to `….json.bad`. Without it, a restart ends every game.

For example: `PORT=9000 HOST=127.0.0.1 pnpm start:server`.

Health check:

```bash
curl localhost:8787/health   # → ok
```

A client connects by WebSocket to `ws://localhost:8787` (the same port, any path). Messages are
JSON text frames. The messages, rules and limits are in [`docs/protocol.md`](docs/protocol.md).

### Smoke test

With the server running, connect with a WebSocket client and create a room:

```bash
npx wscat -c ws://localhost:8787
```

Then send (message shapes are in [`docs/protocol.md`](docs/protocol.md) §8):

```json
{ "type": "create", "v": 1, "name": "Ann" }
```

You should get a `welcome` reply with `"seat": "p1"`, a `seatToken`, and a `room` whose `code` is
four letters and whose `status` is `"lobby"`. In a second terminal, join with
`{ "type": "join", "v": 1, "code": "<code>", "name": "Bob" }`; both sockets then receive a `room`
update.

### Web client

`pnpm dev:web` starts the bare web client (Vite, <http://localhost:5173>). It has no art: a grid
drawn from `content/board.json`, highlighted legal tiles, buttons for roll, upgrades, helicopter and
end turn, a player table, a round bar and an event log.

1. Start the server (`pnpm start:server`).
2. Open the client in two tabs. In the first, enter a name and **Create a room**.
3. In the second, enter a name and the four-letter code and **Join room**.
4. The first tab's player clicks **Start game**.

The client connects to `ws://<page host>:8787` (`wss://` on an `https` page). In a dev build
(`pnpm dev:web`) you can point it at another server by adding `?server=ws://host:port` to the page
address. A production build (`vite build`) ignores `?server=` unless that server is on the list it
was built with, `VITE_ALLOWED_SERVERS=wss://a.example,wss://b.example:8443` (origins, comma-separated),
so a link cannot send a player's saved seat token to someone else's server; an `https` page only
ever uses `wss://`. Each tab keeps its own seat in `sessionStorage`, so a refresh rejoins the same
seat and two tabs of one browser are two players. Seats are also remembered by the browser
(`localStorage`): after closing a tab, the start screen offers **Rejoin room KTBM as Ann**, and
nothing rejoins until you click it. To move to another browser or device, copy the **Rejoin link**
from the lobby or the table (`#rejoin=CODE.TOKEN`; it is your seat, so don't share it) and open it
there; the old tab is told its seat was opened elsewhere and lets it go.

The table shows whose turn it is and how long they have left ("Your turn: … 42 s left." or "Waiting
for Bob to …"), a banner when each round starts and when an event card is drawn, a dock shop panel
when you dock, and a Helicopter button while that event is active. Each turn has 90 seconds; a turn
that runs out is missed (the ship stays put; marked "(auto)" in the log). A player whose tab is closed
shows as **offline** for up to 60 seconds (2 minutes in all per game), then **away**: their turns are
missed straight away until they come back. Three missed turns in a row remove a player from the game,
and the host can remove a player with the **Remove** button. The last player left wins. See "Online
play" in `docs/rulebook.md`.

### Three-tab playtest

With the server and the web client running, this plays a whole game in Chromium with three tabs,
clicking only what the page offers, and also checks a refresh mid-game, a double click, a 4th player
joining the lobby and a phone-width (390 px) layout. It prints the result, the number of clicks and
any console or page errors, and exits 1 if anything failed.

```bash
node scripts/playtest-three-tabs.mjs
```

If Playwright is installed globally, prefix it with `NODE_PATH="$(npm root -g)"`. `GRACE=1` also
closes a tab and waits out the 60-second grace to check the server plays for it (about 2 minutes
longer). `SEED=…` changes the choices, `HEADED=1` shows the browser and `WEB_URL=…` points it at
another client address. Restart `pnpm start:server` after changing server code: it does not
reload.
