/**
 * Safe and Risk cards (Session 4a): the resolution pipeline.
 *
 *   draw (reshuffling an empty pile) → `cardDrawn` → the effect's handler →
 *   `cardDiscarded` → the handler's follow-up, if it returned one.
 *
 * Handlers are chosen by `effect.kind`, never by card id, so every card is
 * pure data in `content/cards.json`. The table is typed to need a handler for
 * each `DrawEffect` kind: a new kind does not compile until it has one.
 *
 * The card is always discarded before anything can wait for a decision, so a
 * state never holds a drawn but undiscarded card. A handler that may open a
 * phase (Sinking Boat) returns that step as a follow-up.
 */
import type { Ctx } from "./ctx";
import { discardCard, drawCard } from "./decks";
import { sinkingBoatRelocation } from "./dock";
import { chargeFine, gainFish, loseFish } from "./economy";
import { catchBonusAt, sharkRepelledAt } from "./modifiers";
import type { CardId, DrawDeckId, DrawEffect, Money, PlayerState, Tile } from "./types";

/** Runs after the card is discarded. Returns whether it opened a phase. */
type FollowUp = () => boolean;

interface Draw {
  player: PlayerState;
  /** The tile the ship ended its move on. */
  tile: Tile;
  card: CardId;
}

type DrawHandler<E extends DrawEffect> = (ctx: Ctx, effect: E, draw: Draw) => FollowUp | void;

const repeat = (value: Money, count: number): Money[] =>
  Array.from({ length: Math.max(0, count) }, () => value);

const DRAW_HANDLERS: { [K in DrawEffect["kind"]]: DrawHandler<Extract<DrawEffect, { kind: K }>> } =
  {
    /** Every fish card, Boot included (`count: 0`), gets the zone's catch bonus. */
    fish(ctx, effect, { player, tile }) {
      const bonus = catchBonusAt(ctx.content, ctx.state, tile);
      gainFish(
        ctx,
        player,
        repeat(effect.value, effect.count),
        bonus ? repeat(bonus.value, bonus.count) : [],
      );
    },

    fine(ctx, effect, { player }) {
      chargeFine(ctx, player, effect.amount);
    },

    shark(ctx, effect, { player, tile, card }) {
      if (sharkRepelledAt(ctx.content, ctx.state, tile)) {
        ctx.events.push({ type: "sharkRepelled", player: player.id, card });
        return;
      }
      loseFish(ctx, player, effect.count, "shark");
    },

    sinkingBoat(ctx, _effect, { player }) {
      loseFish(ctx, player, player.fish.length, "sinking-boat");
      return () => sinkingBoatRelocation(ctx, player);
    },
  };

/**
 * `player`, standing on `tile`, draws the top card of `deckId` and resolves
 * it. Returns whether a phase was opened that keeps the turn going.
 */
export function drawAndResolve(
  ctx: Ctx,
  player: PlayerState,
  deckId: DrawDeckId,
  tile: Tile,
): boolean {
  const { state, content } = ctx;
  const drawn = drawCard(deckId, state.decks[deckId], state.rng);
  state.rng = drawn.rng;
  state.decks[deckId] = drawn.deck;
  ctx.events.push(...drawn.events);
  ctx.events.push({ type: "cardDrawn", player: player.id, deck: deckId, card: drawn.card });

  const effect = content.cards.cards[drawn.card]?.effect as DrawEffect | undefined;
  const handler = effect && (DRAW_HANDLERS[effect.kind] as DrawHandler<DrawEffect> | undefined);
  // compileContent only lets draw effects into the safe and risk decks.
  if (!effect || !handler) throw new Error(`drawAndResolve: no handler for card ${drawn.card}`);
  const followUp = handler(ctx, effect, { player, tile, card: drawn.card });

  state.decks[deckId] = discardCard(state.decks[deckId], drawn.card);
  ctx.events.push({ type: "cardDiscarded", deck: deckId, card: drawn.card });
  return followUp ? followUp() : false;
}
