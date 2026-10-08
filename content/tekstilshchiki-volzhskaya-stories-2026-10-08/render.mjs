import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const sourcePath = new URL('./stories.json', import.meta.url);
const outputPath = new URL('./stories.md', import.meta.url);
const expectedIds = [
  'osm:relation:2234282',
  'osm:way:27175377',
  'osm:way:27175355',
  'osm:node:3955434301',
  'osm:relation:7486979',
  'osm:relation:7486952',
  'osm:relation:7486944',
  'osm:way:48222941',
  'osm:way:48222938',
  'osm:way:203868822',
  'osm:way:48222937',
  'osm:way:48222942',
];

function countWords(value) {
  return value.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function wordForm(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return 'слов';
  if (count % 10 === 1) return 'слово';
  if (count % 10 >= 2 && count % 10 <= 4) return 'слова';
  return 'слов';
}

function validate(document) {
  if (document.status !== 'editorial_draft' || document.stops.length !== expectedIds.length) {
    throw new Error('Ожидаются 12 редакционных черновиков.');
  }

  for (const [index, stop] of document.stops.entries()) {
    if (stop.order !== index + 1 || stop.placeId !== expectedIds[index]) {
      throw new Error(`Неверный порядок или идентификатор остановки ${index + 1}.`);
    }
    if (stop.paragraphs.length < 2) {
      throw new Error(`Недостаточно абзацев у остановки ${stop.order}.`);
    }
    const narration = stop.paragraphs.map((paragraph) => paragraph.text).join('\n\n');
    const wordCount = countWords(narration);
    if (wordCount < 100 || wordCount !== stop.wordCount) {
      throw new Error(`Объём остановки ${stop.order}: ${wordCount} слов, записано ${stop.wordCount}.`);
    }
    if (/\b(?:адрес|улиц[аыеу]|переулк[аеу]|дом[аеу]?)\s+.{0,55}?\b\d{1,3}\s*(?:[\/]\d+|(?:корпус|строение)\s*\d+)?/iu.test(narration)) {
      throw new Error(`Похожее на почтовый адрес место у остановки ${stop.order}.`);
    }
    for (const [paragraphIndex, paragraph] of stop.paragraphs.entries()) {
      if (!paragraph.evidence?.length) {
        throw new Error(`Нет источников у остановки ${stop.order}, абзац ${paragraphIndex + 1}.`);
      }
      for (const fact of paragraph.evidence) {
        if (!fact.claim || !fact.sourceIds?.length) {
          throw new Error(`Неполная привязка факта у остановки ${stop.order}.`);
        }
        for (const sourceId of fact.sourceIds) {
          if (!document.sources[sourceId]?.url?.startsWith('https://')) {
            throw new Error(`Неизвестный источник ${sourceId} у остановки ${stop.order}.`);
          }
        }
      }
    }
  }
}

function render(document) {
  const totalWords = document.stops.reduce((sum, stop) => sum + stop.wordCount, 0);
  const lines = [
    '# От «Текстильщиков» до «Волжской»: рассказы для 12 остановок',
    '',
    `Редакционные черновики для прогулки «От заводского клуба к крепостному театру». Все ${document.stops.length} рассказов содержат не меньше 100 слов; всего ${totalWords} слов. В звучащем тексте нет почтовых адресов. Факты каждого абзаца связаны с источниками в [stories.json](stories.json).`,
    '',
    'Это тексты, а не готовая озвучка: условие о 15 минутах подтверждается только измеренной длительностью окончательных MP3. Геометрию и порядок остановок см. в [исследовании маршрута](../../docs/agents/tekstilshchiki-volzhskaya-research-2026-10-08.md).',
    '',
  ];

  for (const stop of document.stops) {
    lines.push(`## ${stop.order}. ${stop.title} — ${stop.wordCount} ${wordForm(stop.wordCount)}`, '');
    for (const paragraph of stop.paragraphs) lines.push(paragraph.text, '');
    const sourceIds = [...new Set(stop.paragraphs.flatMap((paragraph) => paragraph.evidence.flatMap((fact) => fact.sourceIds)))];
    const sources = sourceIds.map((sourceId) => {
      const source = document.sources[sourceId];
      return `[${source.publisher}: ${source.title}](${source.url})`;
    });
    lines.push(`Источники: ${sources.join('; ')}.`, '');
  }

  return `${lines.join('\n').trim()}\n`;
}

try {
  const document = JSON.parse(await readFile(sourcePath, 'utf8'));
  validate(document);
  const output = render(document);
  if (process.argv.includes('--check')) {
    const saved = await readFile(outputPath, 'utf8');
    if (saved !== output) throw new Error('stories.md отличается от stories.json; запустите render.mjs.');
    process.stdout.write(`Проверены ${document.stops.length} рассказов, ${document.stops.reduce((sum, stop) => sum + stop.wordCount, 0)} слов.\n`);
  } else {
    await writeFile(outputPath, output);
    process.stdout.write(`Создан ${directory}stories.md.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
