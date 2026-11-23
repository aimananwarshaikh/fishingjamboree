/**
 * The games the robot playtest plays (B7). A game is a list of players, each
 * with a device, a bot style, a pace and the faults that happen to them; plus
 * game-wide events (a server restart, a rematch).
 *
 * Durations are in rulebook seconds and are multiplied by the run's `scale`
 * along with the server's timers, so a 20 s drop is still a third of the
 * reconnect grace when the timers are shortened.
 *
 * Faults (`at` is a round; it happens on that player's first decision of that
 * round or later, or for `kick`/`hostLeave` when the host sees that round):
 *   latency  { ms, jitter }               the whole game
 *   drop     { at }                       the socket is cut once (reconnects by itself)
 *   offline  { at, secs }                 no signal for secs (nothing arrives, nothing closes)
 *   lock     { at, secs }                 a locked phone: the page is frozen and no signal
 *   closeTab { at, secs }                 the tab is closed; after secs a new tab rejoins from the offer
 *   link     { at }                       the rejoin link is opened on another device
 *   idle     { at }                       stops playing (stays connected): 3 timed-out turns, removed
 *   kick     { at, target }               the host removes player `target` (index) from the game
 *   hostLeave{ at }                       the host closes their tab for good
 */

const STYLES = ["greedy", "cautious", "risk-taker", "random"];
const NAMES = ["Ann", "Bob", "Cy", "Dee"];

const phone = (extra = {}) => ({ device: "phone", ...extra });
const desk = (extra = {}) => ({ device: "desktop", ...extra });

/** The CI profile: a few minutes with short timers, every kind of fault once. */
export function shortProfile() {
  return [
    {
      id: "s3-phones-rematch",
      players: [
        phone({ cpu: 4, faults: [{ kind: "offline", at: 3, secs: 20 }] }),
        desk({ faults: [{ kind: "drop", at: 2 }] }),
        phone({ faults: [{ kind: "closeTab", at: 5, secs: 10 }] }),
      ],
      rematch: true,
    },
    {
      id: "s4-idle-kick-link",
      players: [
        desk({ faults: [{ kind: "kick", at: 6, target: 3 }] }),
        phone({ faults: [{ kind: "idle", at: 2 }] }),
        phone({
          cpu: 4,
          faults: [
            { kind: "latency", ms: 150, jitter: 100 },
            { kind: "link", at: 4 },
          ],
        }),
        desk({ faults: [{ kind: "lock", at: 3, secs: 90 }] }),
      ],
    },
    {
      id: "s2-restart",
      players: [phone({ cpu: 4 }), desk({ faults: [{ kind: "latency", ms: 300, jitter: 200 }] })],
      restart: { at: 4, secs: 8 },
    },
  ];
}

/** Small seeded PRNG (mulberry32). */
function rng(seed) {
  let s = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 7);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The soak: `games` random games, every player count, mixed devices and faults. */
export function soakProfile(games, seed = "soak") {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const out = [];
  for (let g = 0; g < games; g++) {
    const count = [2, 3, 4][g % 3];
    const players = [];
    for (let i = 0; i < count; i++) {
      const p = r() < 0.6 ? phone(r() < 0.5 ? { cpu: 4 } : {}) : desk();
      p.faults = [];
      if (r() < 0.4)
        p.faults.push({ kind: "latency", ms: pick([80, 150, 300]), jitter: pick([0, 100, 250]) });
      if (r() < 0.45) {
        const at = 2 + Math.floor(r() * 14);
        const kind = pick(["drop", "offline", "offline", "lock", "closeTab", "link"]);
        const secs = kind === "offline" || kind === "lock" ? pick([20, 20, 90]) : 10;
        p.faults.push({ kind, at, secs });
      }
      players.push(p);
    }
    const special = r();
    if (special < 0.12)
      players[1 + Math.floor(r() * (count - 1))].faults.push({
        kind: "idle",
        at: 2 + Math.floor(r() * 10),
      });
    else if (special < 0.22 && count > 2)
      players[0].faults.push({ kind: "kick", at: 3 + Math.floor(r() * 10), target: count - 1 });
    else if (special < 0.3)
      players[0].faults.push({ kind: "hostLeave", at: 4 + Math.floor(r() * 10) });
    const game = { id: `soak-${g + 1}-${count}p`, players };
    if (r() < 0.15) game.restart = { at: 3 + Math.floor(r() * 12), secs: pick([3, 8]) };
    if (r() < 0.2 && special >= 0.3) game.rematch = true;
    out.push(game);
  }
  return out;
}

/** Fills in names, styles and paces (players get different styles, as the sim does). */
export function finishGame(game, index) {
  const r = rng(`${game.id}|${index}`);
  const offset = Math.floor(r() * STYLES.length);
  game.players.forEach((p, i) => {
    p.name = NAMES[i];
    p.style = p.style ?? STYLES[(offset + i) % STYLES.length];
    // "human": waits for the animation, then thinks a little; "quick": clicks as soon as it can.
    p.pace = p.pace ?? (r() < 0.25 ? "quick" : "human");
    p.faults = p.faults ?? [];
  });
  return game;
}
