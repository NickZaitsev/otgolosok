/** Склонение по числу: 1 история, 3 истории, 8 историй. */
export function plural(count: number, [one, few, many]: readonly [string, string, string]) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
