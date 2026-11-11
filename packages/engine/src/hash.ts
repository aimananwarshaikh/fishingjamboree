import { cyrb128 } from "./rng";

/** JSON with object keys sorted, so the text does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 128-bit hex hash of a JSON value, independent of key order. Not cryptographic. */
export function hashJson(value: unknown): string {
  return cyrb128(canonicalJson(value))
    .map((w) => w.toString(16).padStart(8, "0"))
    .join("");
}
