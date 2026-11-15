/**
 * URLs of the web-size art in assets/web/ (written by scripts/make-web-art.mjs).
 * Vite fingerprints each file and gives its URL; the keys are `stepView.ts`
 * art paths ("cards/backs/safe"). The `@2x` copy is used for `srcSet`.
 */
const files = import.meta.glob("../../../assets/web/**/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const urls = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  urls.set(path.replace(/^.*\/assets\/web\//, "").replace(/\.webp$/, ""), url);
}

/** `src` and `srcSet` for an art path; `null` if the file is missing (callers draw a plain fallback). */
export function artSrc(path: string): { src: string; srcSet?: string } | null {
  const src = urls.get(path);
  if (!src) return null;
  const x2 = urls.get(`${path}@2x`);
  return x2 ? { src, srcSet: `${src} 1x, ${x2} 2x` } : { src };
}
