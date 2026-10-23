/**
 * Files the Flutter app (mobile-flutter/) reads from the site's own modules. Each *.mobile-export.test.ts
 * writes one through toMatchFileSnapshot, so `pnpm check` fails when the site changes and the app copy
 * is stale; `pnpm vitest run -u <test>` regenerates it. See docs/agents/mobile-flutter.md.
 */
export const mobileFlutterPath = (relative: string) => new URL(`../../../mobile-flutter/${relative}`, import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1");

/** Stable JSON: sorted object keys, two-space indent, trailing newline. */
export function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort((item as Record<string, unknown>)[key])]))
      : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** A validator's verdict for one sample: the accepted value, or the rejection the Dart port must reproduce. */
export type Verdict = { name: string; input: unknown; valid: true; result: unknown } | { name: string; input: unknown; valid: false };

export function verdict(name: string, input: unknown, validate: (value: unknown) => unknown): Verdict {
  try {
    const result = validate(input);
    return { name, input, valid: true, result: result === undefined ? null : result };
  } catch {
    return { name, input, valid: false };
  }
}

/** A sample the export tests corrupt field by field; untyped on purpose, because a mutation must be able to break the schema. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sample = any;
export type Mutation = (sample: Sample) => void;

/** A fresh base sample with one mutation applied. */
export function mutate<T>(base: () => T, change: Mutation): T {
  const sample = base();
  change(sample);
  return sample;
}
