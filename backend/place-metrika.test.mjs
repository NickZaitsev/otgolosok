import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { CONSENT_KEY, CONSENT_LIFETIME_MS, CONSENT_VERSION, METRIKA_ID, PLACE_METRIKA_SCRIPT } from "./place-metrika.mjs";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const RECEIPT = `${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}.${"F".repeat(43)}`;
const accepted = (overrides = {}) => JSON.stringify({ version: CONSENT_VERSION, analytics: true, decidedAt: NOW - 1000, receipt: RECEIPT, ...overrides });

/** Runs the page script against a minimal browser; returns what it asked Metrica for and the scripts it added. */
function run({ stored = null, storageThrows = false, referrer = "https://yandex.ru/search/?text=дом+пашкова", audio = true, timers = [] } = {}) {
  const listeners = new Map(), appended = [], warnings = [];
  const element = name => ({ addEventListener: (type, handler) => listeners.set(`${name}:${type}`, handler) });
  const window = {};
  const context = {
    window, console: { warn: message => warnings.push(message) }, URL, JSON, Number, Object,
    Date: { now: () => NOW },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    location: { origin: "https://otgolosok.online", pathname: "/place/way/5", search: "?lang=en&utm_source=x" },
    localStorage: { getItem: key => { if (storageThrows) throw new Error("blocked"); return key === CONSENT_KEY ? stored : null; } },
    document: {
      referrer,
      createElement: () => ({ remove() { this.removed = true; } }),
      head: { append: tag => appended.push(tag) },
      querySelector: selector => selector === "audio" && audio ? element("audio") : null,
      getElementById: id => id === "open" ? element("open") : null,
    },
  };
  runInNewContext(PLACE_METRIKA_SCRIPT, context);
  const calls = (window.ym?.a ?? []).map(args => [...args]);
  return { calls, appended, warnings, fire: key => listeners.get(key)?.(), window };
}

for (const [name, options] of /** @type {[string, Parameters<typeof run>[0]][]} */ ([
  ["no stored choice", {}],
  ["a refusal", { stored: accepted({ analytics: false }) }],
  ["an older consent version", { stored: accepted({ version: "2026-09-01" }) }],
  ["an expired choice", { stored: accepted({ decidedAt: NOW - CONSENT_LIFETIME_MS }) }],
  ["a choice dated in the future", { stored: accepted({ decidedAt: NOW + 1000 }) }],
  ["a consent without a server receipt", { stored: accepted({ receipt: null }) }],
  ["a malformed receipt", { stored: accepted({ receipt: "forged" }) }],
  ["broken JSON", { stored: "{" }],
  ["blocked storage", { storageThrows: true }],
])) test(`no counter for ${name}`, () => {
  const { calls, appended, window } = run(options);
  assert.equal(window.ym, undefined);
  assert.deepEqual(calls, []);
  assert.deepEqual(appended, []);
});

test("an accepted choice counts the page by path, with only the referrer's origin and no title", () => {
  const { calls, appended } = run({ stored: accepted({ decidedAt: NOW - CONSENT_LIFETIME_MS + 1 }) });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`);
  assert.equal(appended[0].async, true);
  const [init, hit] = calls;
  assert.equal(init[1], "init");
  assert.equal(init[2].url, "https://otgolosok.online/place/way/5");
  assert.equal(init[2].referrer, "https://yandex.ru/");
  assert.deepEqual([init[2].webvisor, init[2].clickmap, init[2].trackLinks, init[2].sendTitle], [false, false, false, false]);
  assert.deepEqual(JSON.parse(JSON.stringify(hit)), [METRIKA_ID, "hit", "https://otgolosok.online/place/way/5", { referer: "https://yandex.ru/", title: "Отголосок" }]);
});

test("a direct visit or an unreadable referrer sends no referrer", () => {
  for (const referrer of ["", "not a url"]) assert.equal(run({ stored: accepted(), referrer }).calls[0][2].referrer, "");
});

test("goals: the first play, the end of the recording and the way to the map", () => {
  const page = run({ stored: accepted() });
  page.fire("audio:play"); page.fire("audio:play"); page.fire("audio:ended"); page.fire("open:click");
  const goals = page.window.ym.a.map(args => [...args]).filter(args => args[1] === "reachGoal").map(args => args[2]);
  assert.deepEqual([...goals], ["place_audio_play", "place_audio_end", "place_open_map"]);
  assert.doesNotThrow(() => run({ stored: accepted(), audio: false }));
});

test("a failed counter load is retried twice with backoff, then the queue is dropped", () => {
  const timers = [];
  const page = run({ stored: accepted(), timers });
  page.appended[0].onerror();
  assert.equal(page.appended[0].removed, true);
  assert.equal(timers[0].delay, 1000);
  timers[0].callback(); page.appended[1].onerror();
  assert.equal(timers[1].delay, 2000);
  timers[1].callback(); page.appended[2].onerror();
  assert.equal(timers.length, 2);
  assert.equal(page.window.ym.a.length, 0);
  assert.equal(page.warnings.length, 1);
});
