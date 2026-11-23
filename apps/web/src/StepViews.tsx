/**
 * The step components (B2b): what is drawn over the board while a step of the
 * animation queue plays (animation.ts). One component per kind, each driven
 * only by the step and its `progress` (0-1); every look comes from the pure
 * helpers in `stepView.ts`. The parent mounts `<StepView key={current.id}>`
 * so each step starts fresh.
 *
 * Nothing here takes clicks (`pointer-events: none` on the stage), so a player
 * can act while an animation is still playing. Ships sailing, appearing and
 * leaving are drawn by the board itself and have no component.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Content, Money, PlayerView } from "@fishingjamboree/engine";
import type { AnimStep, Frame } from "./animation";
import { artSrc } from "./artUrls";
import { awardOutcome, stepCaption } from "./describe";
import {
  CARD_BACKS,
  FINE_TOKEN_ART,
  GOLDEN_FISH_ART,
  awardLook,
  awardPosition,
  billStack,
  cardArt,
  cardFlip,
  diceAngle,
  diceFace,
  envelope,
  fishTokens,
  pips,
  popScale,
  stagger,
  upgradeTokenArt,
} from "./stepView";

type Current = NonNullable<Frame["current"]>;
type NameOf = (player: string) => string;

interface Props {
  current: Current;
  content: Content;
  view: PlayerView;
  name: NameOf;
}

/** A piece of art by path, or its text label when the file is missing. */
function Art(props: {
  path: string | null;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  const found = props.path ? artSrc(props.path) : null;
  if (!found) {
    return (
      <span className={`art-missing ${props.className ?? ""}`} style={props.style}>
        {props.label}
      </span>
    );
  }
  return (
    <img
      className={props.className}
      style={props.style}
      src={found.src}
      srcSet={found.srcSet}
      alt=""
      draggable={false}
    />
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="step-caption">{children}</p>;
}

// --- dice -------------------------------------------------------------------

function Die({ progress, die, sides }: { progress: number; die: number; sides: number }) {
  const face = diceFace(progress, die, sides);
  const opacity = envelope(progress, 0.1, 0.9);
  return (
    <svg
      className="die"
      viewBox="0 0 90 90"
      style={{
        opacity,
        transform: `rotate(${diceAngle(progress)}deg) scale(${popScale(opacity)})`,
      }}
    >
      <rect
        x="4"
        y="4"
        width="82"
        height="82"
        rx="16"
        fill="#fff"
        stroke="#14232f"
        strokeWidth="4"
      />
      {pips(face).map(([c, r]) => (
        <circle key={`${c}${r}`} cx={24 + c * 21} cy={24 + r * 21} r="8" fill="#14232f" />
      ))}
    </svg>
  );
}

function DiceStep(props: Props & { step: Extract<AnimStep, { kind: "dice" }> }) {
  const { step, current, content } = props;
  const r = step.roll;
  const bonus = r.speedBonus + r.eventModifier;
  const settled = current.progress >= 0.6;
  return (
    <>
      <Die progress={current.progress} die={r.die} sides={content.rules.dieSides} />
      <Caption>
        {props.name(step.player)} rolls
        {settled && (
          <>
            {" "}
            <b>{r.die}</b>
            {bonus !== 0 && ` ${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)}`}
            {bonus !== 0 && ` = ${r.steps}`}
          </>
        )}
      </Caption>
    </>
  );
}

// --- cards ------------------------------------------------------------------

/** A card turning over from its back to its face (or just its face, with no `back`). */
function Card(props: { progress: number; face: string | null; faceLabel: string; back?: string }) {
  const flip = cardFlip(props.progress, props.back !== undefined);
  const hidden: CSSProperties = {
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };
  return (
    <div
      className="card-stage"
      style={{ opacity: flip.opacity, transform: `scale(${flip.scale})` }}
    >
      <div className="card-turn" style={{ transform: `rotateY(${flip.angle}deg)` }}>
        {props.back !== undefined && (
          <Art path={props.back} label="card" className="card-side" style={hidden} />
        )}
        <Art
          path={props.face}
          label={props.faceLabel}
          className="card-side"
          style={{ ...hidden, transform: props.back !== undefined ? "rotateY(180deg)" : undefined }}
        />
      </div>
    </div>
  );
}

// --- tokens and money -------------------------------------------------------

function TokenRow(props: {
  art: string[];
  hidden?: number;
  progress: number;
  /** "away": the tokens fall and fade (lost fish); "in": they pop in one after another. */
  mode: "in" | "away";
  className?: string;
}) {
  const n = props.art.length;
  return (
    <div className={`token-row ${props.className ?? ""}`}>
      {props.art.map((path, i) => {
        const k = stagger(props.progress, i, n);
        const style: CSSProperties =
          props.mode === "in"
            ? { opacity: envelope(k, 0.25, 1), transform: `scale(${popScale(k * 3)})` }
            : { opacity: 1 - k, transform: `translateY(${k * 40}px) scale(${1 - 0.3 * k})` };
        return <Art key={i} path={path} label="fish" className="token" style={style} />;
      })}
      {props.hidden ? <span className="token-more">+{props.hidden}</span> : null}
    </div>
  );
}

function fishRow(values: Money[], progress: number, mode: "in" | "away", className = "") {
  const { art, hidden } = fishTokens(values);
  return (
    <TokenRow art={art} hidden={hidden} progress={progress} mode={mode} className={className} />
  );
}

/** A stack of bills for an amount, fading in from `from` of the step on. */
function MoneyStack(props: { amount: Money; progress: number; from?: number; sign?: "+" | "−" }) {
  const { bills } = billStack(props.amount);
  const k = props.from
    ? Math.max(0, (props.progress - props.from) / (1 - props.from))
    : props.progress;
  const opacity = envelope(k, 0.25, 0.85);
  return (
    <div className="money" style={{ opacity, transform: `translateY(${(1 - opacity) * 14}px)` }}>
      <div className="bills">
        {bills.map((b, i) => (
          <Art
            key={i}
            path={b}
            label="$"
            className="bill"
            style={{ marginTop: i === 0 ? 0 : -34 }}
          />
        ))}
      </div>
      <b className="money-total">
        {props.sign ?? ""}${props.amount}
      </b>
    </div>
  );
}

// --- awards -----------------------------------------------------------------

function AwardStep(props: Props & { step: Extract<AnimStep, { kind: "award" }> }) {
  const { step, content, view, current } = props;
  const def = content.awards.awards.find((a) => a.id === step.award.award);
  const look = awardLook(current.progress);
  const out = awardOutcome(step.award, props.name);
  const pos = view.result ? awardPosition(view.result.awards, step.award) : null;
  return (
    <div className="award-panel" role="status" aria-live="polite">
      <small style={{ opacity: look.titleOpacity }}>
        Golden Hook Award{pos ? ` ${pos.n} of ${pos.of}` : ""}
      </small>
      <h3 style={{ opacity: look.titleOpacity }}>{def?.name ?? step.award.award}</h3>
      <p className="award-text" style={{ opacity: look.titleOpacity }}>
        {def?.text ?? ""}
      </p>
      <div
        className={`award-result${out.who === "Nobody" ? " nobody" : ""}`}
        style={{ opacity: look.resultOpacity, transform: `scale(${popScale(look.resultOpacity)})` }}
      >
        {look.revealed && (
          <>
            <strong>{out.who}</strong>
            {out.amount !== null && <b className="award-amount">+${out.amount}</b>}
            {out.note && <small>{out.note}</small>}
          </>
        )}
      </div>
    </div>
  );
}

// --- the stage --------------------------------------------------------------

/**
 * What the playing step looks like, or `null` for a step with nothing to
 * draw (ships are on the board). The stage lets every click through.
 */
export function StepView(props: Props) {
  const { current, content } = props;
  const step = current.step;
  const p = current.progress;
  const caption = stepCaption(step, content, props.name);
  const cardName = (id: string) => content.cards.cards[id]?.name ?? id;

  let body: ReactNode = null;
  switch (step.kind) {
    case "dice":
      body = <DiceStep {...props} step={step} />;
      break;
    case "card":
      body = (
        <>
          <Card
            progress={p}
            face={cardArt(step.card)}
            faceLabel={cardName(step.card)}
            back={CARD_BACKS[step.deck]}
          />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "event":
      body = (
        <>
          <Card
            progress={p}
            face={cardArt(step.card)}
            faceLabel={cardName(step.card)}
            back={CARD_BACKS.event}
          />
          <Caption>
            Event after round {step.afterRound}: {cardName(step.card)}
          </Caption>
        </>
      );
      break;
    case "repelled":
      body = (
        <>
          <Card progress={p} face={cardArt(step.card)} faceLabel={cardName(step.card)} />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "fish":
      body = (
        <>
          {fishRow(step.kept, p, "in")}
          {step.lost.length > 0 && fishRow(step.lost, p, "away", "lost")}
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "fishLost":
      body = (
        <>
          {fishRow(step.fish, p, "away", "lost")}
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "fine":
      body = (
        <>
          <TokenRow
            art={Array.from({ length: Math.min(step.tokensTaken, 6) }, () => FINE_TOKEN_ART)}
            progress={p}
            mode="in"
          />
          {step.paid > 0 && <MoneyStack amount={step.paid} progress={p} sign="−" />}
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "sale":
      body = (
        <>
          {fishRow(step.fish, Math.min(1, p * 1.6), "away")}
          <MoneyStack amount={step.total} progress={p} from={0.3} sign="+" />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "tokensPaid":
      body = (
        <>
          <TokenRow
            art={Array.from({ length: Math.min(step.tokens, 6) }, () => FINE_TOKEN_ART)}
            progress={Math.min(1, p * 1.6)}
            mode="away"
          />
          <MoneyStack amount={step.amount} progress={p} from={0.2} sign="−" />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "upgrade":
      body = (
        <>
          <TokenRow art={[upgradeTokenArt(step.upgrade)]} progress={p} mode="in" className="big" />
          <MoneyStack amount={step.price} progress={p} from={0.1} sign="−" />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "helicopter":
      body = (
        <>
          <Card progress={p} face={cardArt("helicopter")} faceLabel="Helicopter" />
          <MoneyStack amount={step.fee} progress={p} from={0.2} sign="−" />
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "goldenFish":
      body = (
        <>
          <div
            className={`token-row big golden ${step.what}`}
            style={{
              opacity: envelope(p, 0.2, 0.8),
              transform: `scale(${popScale(envelope(p, 0.3, 1))}) translateY(${step.what === "taken" ? -p * 30 : 0}px)`,
            }}
          >
            <Art path={GOLDEN_FISH_ART} label="Golden Fish" className="token" />
          </div>
          <Caption>{caption}</Caption>
        </>
      );
      break;
    case "round":
      body = (
        <div className="round-banner" style={{ opacity: envelope(p, 0.2, 0.8) }}>
          <strong>
            Round {step.round} of {content.rules.rounds}
          </strong>
        </div>
      );
      break;
    case "award":
      body = <AwardStep {...props} step={step} />;
      break;
    case "gameEnd":
      body = (
        <div className="round-banner over" style={{ opacity: envelope(p, 0.2, 0.9) }}>
          <strong>Game over</strong>
        </div>
      );
      break;
    default:
      return null; // place, move, relocate, removed: drawn by the board
  }
  return (
    <div
      className={`step-stage step-${step.kind}`}
      data-step={step.kind}
      data-id={current.id}
      data-ms={Math.round(current.ms)}
      aria-hidden={step.kind === "award" ? undefined : true}
    >
      {body}
    </div>
  );
}
