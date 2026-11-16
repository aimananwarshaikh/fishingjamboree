# Deploying for playtests (B5)

Target: 3 to 4 friends playing over the internet. Free, one server process.

```
 browser ──https──▶ Cloudflare Pages   (the built web client, static)
    │
    └────wss────────▶ Caddy (TLS) ──▶ game server (Node, one process) ──▶ rooms on a disk
                       one small always-free VM, Docker Compose
```

Keep the GitHub repo private. Nothing here needs a secret, and nothing secret goes into the repo
(`deploy/.env` is ignored by git). Free-tier terms change: check them before you sign up.

## 1. The server (a free VM)

Any always-on Linux VM with Docker works (Oracle Cloud Always Free, or the Google Cloud e2-micro
free tier; both ask for a card at signup). Open TCP 80 and 443 to the internet; do not publish 8787.

1. A name for the server, e.g. a free DuckDNS subdomain, with its A record pointing at the VM.
2. On the VM: `git clone` the repo, then

   ```bash
   cd fishingjamboree/deploy
   cp .env.example .env     # set SERVER_DOMAIN and WEB_ORIGIN (see section 2)
   docker compose up -d --build
   docker compose logs -f server
   ```

   Caddy fetches the TLS certificate by itself on the first start (needs ports 80 and 443).

3. Check: `curl https://<SERVER_DOMAIN>/health` prints `ok`.

Update: `git pull && docker compose up -d --build` in `deploy/`. The server is stopped with
SIGTERM (it closes its sockets and exits in about a second), restarts, restores every saved room, and
players' tabs reconnect on their own. A deploy that changes `content/*.json` makes saved games
unrestorable (content hash): they are moved aside as `*.json.bad`. Do not redeploy during a game.

Saved rooms are in the `rooms` Docker volume (`/data/rooms`), which survives rebuilds and reboots.
The files hold seat tokens: do not share them, and do not back them up anywhere public.
Look at them with `docker compose exec server ls /data/rooms`.

One process only: the room store is one folder owned by one server. Do not scale it out.

## 2. The web client (Cloudflare Pages)

Create a Pages project from the GitHub repo (private repos are fine on the free plan):

- Build command: `pnpm install --frozen-lockfile && pnpm --filter @fishingjamboree/web build`
- Output directory: `apps/web/dist`
- Environment variable (build time): `VITE_SERVER_URL=wss://<SERVER_DOMAIN>`
- Node 22 (set `NODE_VERSION=22`).

Then put the page's address (e.g. `https://jamboree.pages.dev`) in `deploy/.env` as `WEB_ORIGIN`
and run `docker compose up -d` again: the server only accepts browsers from that origin.
Any static host works the same way (set the two variables).

## 3. Variables

Server (environment of the `server` container; `deploy/compose.yaml` sets the first two):

| Variable                 | Default                     | Meaning                                                                                                                                           |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`        | unset: any website may      | Browser origins that may connect, comma-separated, `https://host[:port]`, no path. A client with no `Origin` header is let in.                    |
| `TRUST_PROXY`            | `0`                         | `1` behind Caddy: a client's address is the last `X-Forwarded-For` entry. Only set it when the server cannot be reached except through the proxy. |
| `PORT`                   | `8787`                      | HTTP and WebSocket port.                                                                                                                          |
| `HOST`                   | all interfaces              | Address to listen on.                                                                                                                             |
| `CONTENT_DIR`            | the repository's `content/` | Folder with the content JSON (the image sets `/app/content`).                                                                                     |
| `ROOMS_DIR`              | unset: memory only          | Folder for saved rooms (the image sets `/data/rooms`). Unset: a restart ends every game.                                                          |
| `MAX_CONNECTIONS`        | `200`                       | Sockets in all; the next upgrade gets HTTP 503.                                                                                                   |
| `MAX_CONNECTIONS_PER_IP` | `12`                        | Sockets from one address; the next gets HTTP 429. Friends on one network share an address: keep it above their tabs.                              |
| `MAX_ROOMS`              | `500`                       | Rooms at once; `create` answers `server-busy`.                                                                                                    |
| `MAX_BUFFERED_BYTES`     | `1048576`                   | A socket with more than this queued (it is not reading) is dropped.                                                                               |

A bad value stops the server at start with every problem listed. Fixed limits (not variables): frames over
4 KiB close the socket (1009); 30 messages burst and 10 per second per socket (1008); ping every 15 s.

Web build (Vite, at build time; they end up in the page):

| Variable               | Meaning                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SERVER_URL`      | The game server, `wss://host` (or `ws://` for local use). Unset: the page's own host on port 8787 (`wss` on an `https` page).       |
| `VITE_ALLOWED_SERVERS` | Other servers `?server=` may point at, comma-separated `wss://` origins. `VITE_SERVER_URL` is always allowed. Dev builds allow any. |

## 4. Logs

One line per event on stdout (`docker compose logs server`), no seat tokens, rejoin links or names:

```
room KTBM created (3 rooms)
room KTBM started with 3 players
room KTBM finished
refused connection from 203.0.113.9: origin not allowed (https://evil.example)
room KTBM: error in tick, room closed: ...      (its replay log follows; the file is kept as KTBM.json.bad)
```

Refusals are logged at most 10 per 10 s, then counted. Addresses are in the log: treat the log as private.

## 5. Checked in B5

Run on the build and the server as deployed (Origin check on, rooms saved): `scripts/playtest-three-tabs.mjs`
(59/59, also with `GRACE=1`), SIGTERM with a socket open (the server exits in about 0.5 s, rooms kept), a
restart that restored a saved room, and an `Origin` of another site refused with 403. CI runs the playtest
(`.github/workflows/ci.yml`, job `playtest`).

Not checked here, because the build sandbox has no Docker daemon and no internet host: `docker compose up`
itself, Caddy's certificate, and a WebSocket through Caddy. The Dockerfile's steps were run by hand on a clean
copy of exactly the files it copies. If `wss` does not connect through Caddy or the host's network, stop: that
is the networking case for Opus (docs/build-plan.md).
