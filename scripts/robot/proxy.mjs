/**
 * One player's network (robot playtests, B7): a TCP proxy between that
 * player's browser and the game server. The page is loaded through it, and the
 * web client connects back to its own address, so the WebSocket goes through
 * it too. It can add latency, drop the connection, or hold all traffic (a
 * lost signal or a locked phone: nothing arrives and nothing is closed, so
 * only the server's heartbeat notices).
 */
/* global setTimeout, clearTimeout */
import net from "node:net";

export async function createProxy(targetPort) {
  const pairs = new Set();
  let latency = 0;
  let jitter = 0;
  let holding = false;
  let refusing = false;

  const delay = () => latency + (jitter > 0 ? Math.random() * jitter : 0);

  /**
   * Forwards `from` to `to` strictly in order, each chunk after the current
   * latency: one queue and one timer per direction (separate timers could fire
   * out of order and corrupt the stream). While held, nothing is delivered.
   */
  function pipe(from, to, pair) {
    const queue = [];
    let timer = null;
    const pump = () => {
      timer = null;
      pair.timers.delete(pump);
      if (holding) return;
      while (queue.length > 0 && queue[0].at <= Date.now()) {
        const { chunk } = queue.shift();
        if (!to.destroyed) to.write(chunk);
      }
      if (queue.length > 0) {
        timer = setTimeout(pump, queue[0].at - Date.now());
        pair.timers.set(pump, timer);
      }
    };
    pair.pumps.push(() => {
      // After a hold: everything held goes out now, in order.
      for (const item of queue) item.at = Math.min(item.at, Date.now());
      if (timer) clearTimeout(timer);
      pump();
    });
    from.on("data", (chunk) => {
      const last = queue.length > 0 ? queue[queue.length - 1].at : 0;
      queue.push({ chunk, at: Math.max(Date.now() + (holding ? 0 : delay()), last) });
      if (!holding && timer === null) pump();
    });
  }

  const server = net.createServer((client) => {
    if (refusing) {
      client.destroy();
      return;
    }
    const upstream = net.connect(targetPort, "127.0.0.1");
    const pair = { client, upstream, timers: new Map(), pumps: [] };
    pairs.add(pair);
    const close = () => {
      for (const t of pair.timers.values()) clearTimeout(t);
      pairs.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", () => {
      // While held, a socket the server closed stays open on the browser's side
      // (the close cannot reach it); it is closed when the hold ends.
      if (holding) pair.upstreamClosed = true;
      else close();
    });
    pipe(client, upstream, pair);
    pipe(upstream, client, pair);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    setLatency(ms, jitterMs = 0) {
      latency = ms;
      jitter = jitterMs;
    },
    /** Closes every connection at once (a dropped socket). */
    drop() {
      for (const p of [...pairs]) {
        p.client.destroy();
        p.upstream.destroy();
      }
    },
    /** Holds all traffic and refuses new connections, until `release`. */
    hold() {
      holding = true;
      refusing = true;
    },
    /** Ends a hold: traffic held is delivered, sockets the server closed meanwhile are closed. */
    release() {
      holding = false;
      refusing = false;
      for (const p of [...pairs]) {
        if (p.upstreamClosed) {
          p.client.destroy();
          pairs.delete(p);
          continue;
        }
        for (const pump of p.pumps) pump();
      }
    },
    get connections() {
      return pairs.size;
    },
    async close() {
      this.drop();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
