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

The client connects to `ws://<page host>:8787`. To use another server, add `?server=ws://host:port`
to the page address. Each tab keeps its own seat in `sessionStorage`, so a refresh rejoins the same
seat and two tabs of one browser are two players.
