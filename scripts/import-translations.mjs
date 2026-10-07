#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStore } from "../backend/store.mjs";
import { validateTranslationBundle } from "../backend/translation-bundle.mjs";

const DEFAULT_DIRECTORY = resolve(import.meta.dirname, "../content/tretyakovka-translations-2026-10-07");
const HELP = `Импорт редакционных переводов из зафиксированного снимка.

Использование:
  node scripts/import-translations.mjs [source.json en.json zh.json] [--db <jobs.sqlite>] [--apply]

Без --apply команда только читает и проверяет файлы. Пути по умолчанию:
  ${DEFAULT_DIRECTORY}/source.json
  ${DEFAULT_DIRECTORY}/en.json
  ${DEFAULT_DIRECTORY}/zh.json

Примеры:
  node scripts/import-translations.mjs
  node scripts/import-translations.mjs ./source.json ./en.json ./zh.json
  node scripts/import-translations.mjs --db ./backend/data/jobs.sqlite --apply

--apply требует явного --db. Команда создаёт только черновики переводов:
она не одобряет и не публикует тексты и не ставит озвучивание в очередь.`;

function argumentsOf(argv) {
  const files = [];
  let database = null;
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--apply") {
      if (apply) throw new Error("Параметр --apply указан больше одного раза.");
      apply = true;
      continue;
    }
    if (argument === "--db") {
      const value = argv[++index];
      if (!value || value.startsWith("--") || database) throw new Error("После --db требуется ровно один путь к базе.");
      database = resolve(value);
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Неизвестный параметр: ${argument}`);
    files.push(resolve(argument));
  }
  if (apply && !database) throw new Error("Для --apply явно укажите базу через --db.");
  if (files.length !== 0 && files.length < 2) throw new Error("Укажите source.json и хотя бы один файл перевода.");
  const selected = files.length ? files : [
    resolve(DEFAULT_DIRECTORY, "source.json"),
    resolve(DEFAULT_DIRECTORY, "en.json"),
    resolve(DEFAULT_DIRECTORY, "zh.json"),
  ];
  return { help: false, apply, database, source: selected[0], translations: selected.slice(1) };
}

async function jsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "некорректный JSON" : error instanceof Error ? error.message : "ошибка чтения";
    throw new Error(`Не удалось прочитать ${path}: ${reason}`, { cause: error });
  }
}

async function main() {
  const options = argumentsOf(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const [source, ...translations] = await Promise.all([
    jsonFile(options.source),
    ...options.translations.map(jsonFile),
  ]);
  const batch = validateTranslationBundle(source, translations);
  const locales = batch.translations.map(item => item.locale).join(", ");
  const stories = batch.translations.reduce((total, item) => total + item.entries.length, 0);
  if (!options.apply) {
    console.log(`Проверка пройдена: локали ${locales}; переводов историй ${stories}; изменений в базе нет.`);
    return;
  }
  const store = createStore(options.database);
  try {
    const result = store.importTranslationBundle(batch);
    const importedStories = result.reduce((total, item) => total + item.entries.length, 0);
    console.log(`Черновики импортированы: локали ${result.length}; историй ${importedStories}; прогулок ${result.length}.`);
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Не удалось импортировать переводы.");
  process.exitCode = 1;
}
