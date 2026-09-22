// SpeechKit reads a word marked with "+" by letter rules instead of its dictionary entry,
// so a stress mark on a word whose spelling differs from its pronunciation breaks the word:
// "Сегодня" is voiced "севодня", but "Сег+одня" comes out with a literal "г".
// Stress in these words is fixed anyway, so dropping the mark costs nothing.

// "сегодня" is a frozen genitive, so its shift sits inside the word rather than at the end.
const SHIFTED_INSIDE = "сегодня";
// Adverbs and nouns where a final -ого/-его keeps its "г".
const SPELLED_GO = new Set(["много", "немного", "строго", "нестрого", "долго", "недолго", "надолго",
  "полого", "отлого", "убого", "дорого", "недорого", "эго", "лего"]);
// "чт" sounds like "шт" only in these; in "нечто" the "ч" survives.
const SHIFTED_CHT = new Set(["что", "чтоб", "чтобы", "ничто"]);
// "чн" sounds like "шн" in a closed list; elsewhere ("точный", "вечный") it does not.
const SHIFTED_CHN = new Set(["конечно", "скучно", "скучный", "скучная", "скучные", "нарочно", "нарочный",
  "яичница", "скворечник", "прачечная", "горчичник", "пустячный", "двоечник", "подсвечник", "девичник"]);
const SHIFTED_GK = new Set(["легко", "легкий", "лёгкий", "легче", "полегче", "легкость",
  "мягко", "мягкий", "мягче", "помягче", "мягкость", "ногти", "когти"]);

const RULES = [
  { id: "ого", severity: "high", note: "-ого/-его звучит как -ово/-ево",
    test: (word) => word.includes(SHIFTED_INSIDE) || ((word.endsWith("ого") || word.endsWith("его")) && !SPELLED_GO.has(word)) },
  { id: "что", severity: "high", note: "чт звучит как шт", test: (word) => SHIFTED_CHT.has(word) },
  { id: "чн", severity: "high", note: "чн звучит как шн", test: (word) => SHIFTED_CHN.has(word) },
  { id: "тся", severity: "medium", note: "-тся/-ться звучит как -цца",
    test: (word) => word.endsWith("тся") || word.endsWith("ться") },
  { id: "немой", severity: "medium", note: "согласный в группе не произносится",
    test: (word) => /стн|здн|стл|рдц|рдч|лнц|нтск|ндск|стск|вств/.test(word) && !word.startsWith("бездн") },
  { id: "щ", severity: "medium", note: "сч/зч/жч звучит как щ", test: (word) => /сч|зч|жч/.test(word) },
  { id: "хк", severity: "medium", note: "гк/гч звучит как хк/хч", test: (word) => SHIFTED_GK.has(word) },
];

const SEVERITY = { medium: 0, high: 1 };
// Hyphens split "Москв+ы-рек+и" into parts that are checked on their own.
const STRESSED_WORD = /[а-яё+]+/gi;

export function findUnsafeStress(text) {
  if (typeof text !== "string") return [];
  const found = [];
  for (const match of text.matchAll(STRESSED_WORD)) {
    const marked = match[0];
    if (!marked.includes("+")) continue;
    const word = marked.replaceAll("+", "").toLowerCase();
    if (!word) continue;
    const rule = RULES.find((candidate) => candidate.test(word));
    if (rule) found.push({ word: marked, index: match.index, rule: rule.id, severity: rule.severity, note: rule.note });
  }
  return found;
}

export function stripUnsafeStress(text, { severity = "medium" } = {}) {
  const removed = findUnsafeStress(text).filter((item) => SEVERITY[item.severity] >= SEVERITY[severity]);
  let cleaned = "";
  let cursor = 0;
  for (const item of removed) {
    cleaned += text.slice(cursor, item.index) + item.word.replaceAll("+", "");
    cursor = item.index + item.word.length;
  }
  return { text: cleaned + text.slice(cursor), removed };
}
