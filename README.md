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

`pnpm dev:web` is still the bare scaffold. The playable client arrives in Session 6.
