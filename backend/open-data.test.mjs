import test from "node:test";
import assert from "node:assert/strict";
import { distanceToShape, fetchOpenDataset, matchOpenData, normalizeOpenDataRecord, openDataSource, renderOpenDataSource } from "./open-data.mjs";

// Offsets along latitude: 1e-5 degree ≈ 1.11 m.
const at = (metres, base = { lat: 55.8120, lon: 37.5540 }) => ({ lat: base.lat + metres / 111195, lon: base.lon });
const plaqueRow = (id, cells, location = at(0)) => [{ global_id: id, Cells: cells }, { geometry: { type: "Point", coordinates: [location.lon, location.lat] }, properties: { attributes: { global_id: id } } }];
const plaque = (id, cells, location) => normalizeOpenDataRecord(2801, ...plaqueRow(id, cells, location));
const memorial = (id, name, metres, base) => ({ id, name, location: at(metres, base), tags: { historic: "memorial" } });
const klechkovsky = { Name: "Мемориальная доска Клечковскому Всеволоду Маврикиевичу", Text: "В этом здании с 1929 по 1972 год работал академик В.М. Клечковский",
  Location: "САО, муниципальный округ Тимирязевский, улица Прянишникова, дом 6", InstallationDate: "06.06.1978", Material: "не установлен",
  Authors: [{ AuthorsName: "Смирнов С.И.", Profession: "архитектор" }, { AuthorsName: "Шакаров Г.А.", Profession: "скульптор" }, { AuthorsName: "не установлен", Profession: "" }] };

test("plaques match by every name word within 80 m and agreeing initials", () => {
  /** @type {Array<[string, any, any[], string[]]>} */
  const cases = [
    ["Клечковский at 13 m", plaque(1, klechkovsky), [memorial("p1", "В. М. Клечковскому", 13)], ["p1"]],
    ["same plaque at 120 m", plaque(1, klechkovsky), [memorial("p1", "В. М. Клечковскому", 120)], []],
    ["initials disagree: another Grigorenko", plaque(2, { Name: "Мемориальная доска Григоренко Петру Григорьевичу" }), [memorial("p2", "Н. Ф. Григоренко", 10)], []],
    ["initials disagree: father and son", plaque(3, { Name: "Мемориальная доска Вишневскому Александру Александровичу" }), [memorial("p3", "А. В. Вишневскому", 10)], []],
    ["abbreviated initials agree", plaque(4, { Name: "Мемориальная доска Астахову Д.В." }), [memorial("p4", "Д. В. Астахову", 10)], ["p4"]],
    ["nothing to compare initials with", plaque(5, { Name: "Мемориальная доска Клечковскому", Text: "Здесь работал учёный" }), [memorial("p5", "В. М. Клечковскому", 10)], ["p5"]],
    ["two candidate places", plaque(1, klechkovsky), [memorial("p1", "В. М. Клечковскому", 10), memorial("p6", "В. М. Клечковскому", -20)], []],
    ["a surname missing on the plaque", plaque(7, { Name: "Мемориальная доска Жебрунову Ананию Кирилловичу" }), [memorial("p7", "А. К. Жебрунову и С. Д. Барболину", 10)], []],
    ["artwork is not a plaque candidate", plaque(1, klechkovsky), [{ ...memorial("p8", "В. М. Клечковскому", 10), tags: { tourism: "artwork" } }], []],
  ];
  for (const [name, record, places, expected] of cases)
    assert.deepEqual(matchOpenData([record], places).matches.map(item => item.placeId), expected, name);
});

test("sculptures match by title without quotes and generic prefixes within 1500 m", () => {
  const muzeon = { lat: 55.733285, lon: 37.606738 };
  const row = (id, SculpName, location = muzeon) => normalizeOpenDataRecord(60869, { global_id: id, Cells: { SculpName, Author: "Скульптор Воробьева", ManufactYear: 2008,
    Material: "Известняк", LocationPlace: "Парк Горького. Парк искусств «МУЗЕОН»", Latitude_WGS84: String(location.lat), Longitude_WGS84: String(location.lon) } });
  const artwork = (id, name, metres) => ({ id, name, location: at(metres, muzeon), tags: { tourism: "artwork" } });
  /** @type {Array<[string, any, any[], string[]]>} */
  const cases = [
    ["Мишка с мячом at 430 m", row(1, "«Мишка с мячом»"), [artwork("a1", "Мишка с мячом", 430)], ["a1"]],
    ["«Памятник …» prefix", row(2, "«Памятник Пушкину»"), [artwork("a2", "Пушкину", 300)], ["a2"]],
    ["too far", row(1, "«Мишка с мячом»"), [artwork("a1", "Мишка с мячом", 1600)], []],
    ["two namesakes", row(3, "«Ленин»"), [artwork("a3", "Ленин", 100), artwork("a4", "Ленин", 900)], []],
    ["different title", row(4, "«Сон»"), [artwork("a5", "Сон разума", 50)], []],
  ];
  for (const [name, record, places, expected] of cases)
    assert.deepEqual(matchOpenData([record], places).matches.map(item => item.placeId), expected, name);
});

// A 20 × 20 m square outline around the base point.
const square = (base = at(0)) => {
  const dLat = 10 / 111195, dLon = dLat / Math.cos(base.lat * Math.PI / 180);
  const ring = [[base.lon - dLon, base.lat - dLat], [base.lon + dLon, base.lat - dLat], [base.lon + dLon, base.lat + dLat], [base.lon - dLon, base.lat + dLat], [base.lon - dLon, base.lat - dLat]];
  return { type: "MultiPolygon", coordinates: [[ring]] };
};
const heritage = (id, cells) => normalizeOpenDataRecord(530, { global_id: id, Cells: { AISID: "x", Category: "регионального значения", ...cells } },
  { geometry: square(), properties: { attributes: { global_id: id } } });
/** @param {string} id @param {string} name @param {number} metres @param {Record<string, string>} [tags] */
const place = (id, name, metres, tags = { historic: "memorial" }) => ({ id, name, location: at(metres), tags });

test("heritage records match by their own title within 25 m of the outline", () => {
  /** @type {Array<[string, any, any[], string[]]>} */
  const cases = [
    ["bust with initials before the surname", heritage(1, { ObjectNameOnDoc: "Бюст М.И.Авербаха, 1952 г., ск. С.Д.Меркуров, арх. И.А.Француз, бронза, гранит" }), [place("h1", "М. И. Авербаху", 0)], ["h1"]],
    ["grave with the given name after the surname", heritage(2, { ObjectNameOnDoc: "Могила Доватора Льва Михайловича (1903–1941)" }), [place("h2", "Л. М. Доватор", 18)], ["h2"]],
    ["15 m outside the outline", heritage(2, { ObjectNameOnDoc: "Могила Доватора Льва Михайловича (1903–1941)" }), [place("h2", "Л. М. Доватор", 25)], ["h2"]],
    ["30 m outside the outline", heritage(2, { ObjectNameOnDoc: "Могила Доватора Льва Михайловича (1903–1941)" }), [place("h2", "Л. М. Доватор", 40)], []],
    ["the person is the sculptor", heritage(3, { ObjectNameOnDoc: "Надгробие Я.Н.Федоренко, 1949 г., ск. Е.В.Вучетич" }), [place("h3", "Е. В. Вучетич", 0)], []],
    ["the building is named after the person", heritage(4, { ObjectNameOnDoc: "Здание Государственного академического театра им. Е.Б.Вахтангова, 1873 г." }), [place("h4", "Е. Б. Вахтангову", 0)], []],
    ["a patronymic is not a surname", heritage(5, { ObjectNameOnDoc: "Могила Павленко Петра Андреевича (1899–1951)" }), [place("h5", "А. А. Андреев", 0)], []],
    ["the name is only in the ensemble", heritage(6, { ObjectNameOnDoc: "Парк, нач. XX в.", EnsembleNameOnDoc: "Пансион-приют (НИИ нейрохирургии им. Н.Н.Бурденко)" }), [place("h6", "Н. Н. Бурденко", 0)], []],
    ["a quoted one-word title", heritage(7, { ObjectNameOnDoc: "Скульптура «Рабочий», 1925 г., ск. Н.А.Андреев, бетон" }), [place("h7", "Рабочий", 0, { tourism: "artwork" })], ["h7"]],
    ["a one-word title opening the record", heritage(8, { ObjectNameOnDoc: "ДОТ Московской линии обороны, 1941 г." }), [place("h8", "ДОТ", 0)], ["h8"]],
    ["a one-word name inside another word", heritage(9, { ObjectNameOnDoc: "Главный фасад павильона Лесное и охотничье хозяйство, 1954 г." }), [place("h9", "Охотник", 0, { tourism: "artwork" })], []],
    ["a park by its title", heritage(10, { ObjectNameOnDoc: "Усадьба Милюково" }), [place("h10", "Усадьба Милюково", 0, { historic: "manor" })], ["h10"]],
  ];
  for (const [name, record, places, expected] of cases)
    assert.deepEqual(matchOpenData([record], places).matches.map(item => item.placeId), expected, name);
});

test("a stored heritage match keeps the facts and drops the outline", () => {
  const [match] = matchOpenData([heritage(1, { ObjectNameOnDoc: "Бюст М.И.Авербаха, 1952 г.", EnsembleName: "Сквер", Addresses: "улица Россолимо, дом 11", USRCHONumber: "771410378510015" })],
    [place("h1", "М. И. Авербаху", 0)]).matches;
  assert.equal(match.record.outline, undefined);
  assert.equal(match.record.fields.AISID, undefined);
  assert.deepEqual(match.match, { rule: "heritage-title-25m", distanceM: 0 });
  const text = renderOpenDataSource(match.record);
  assert.match(text, /^Наименование объекта культурного наследия по документам: Бюст М\.И\.Авербаха, 1952 г\./u);
  assert.ok(text.includes("Входит в ансамбль: Сквер."));
  assert.ok(text.includes("Охранный статус: регионального значения."));
  assert.match(openDataSource({ datasetId: 530, datasetVersion: "10.579", record: match.record }, "d1").title, /Объекты культурного наследия$/u);
});

test("distance to an outline is zero inside and grows outside", () => {
  const outline = { rings: square().coordinates[0], points: [] };
  assert.equal(distanceToShape(at(0), outline), 0);
  assert.ok(Math.abs(distanceToShape(at(30), outline) - 20) < 0.5);
  assert.ok(Math.abs(distanceToShape(at(-15), { rings: [], points: [[at(0).lon, at(0).lat]] }) - 15) < 0.5);
});

test("a place claimed by two records is left to an editor", () => {
  const result = matchOpenData([plaque(1, klechkovsky), plaque(9, klechkovsky, at(5))], [memorial("p1", "В. М. Клечковскому", 10)]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguousPlaces, ["p1"]);
});

test("the source text drops placeholders and keeps quotable facts", () => {
  const record = plaque(1, klechkovsky);
  assert.equal(record.fields.Material, undefined);
  assert.deepEqual(record.fields.Authors, [{ name: "Смирнов С.И.", profession: "архитектор" }, { name: "Шакаров Г.А.", profession: "скульптор" }]);
  const text = renderOpenDataSource(record);
  assert.match(text, /^Мемориальная доска Клечковскому Всеволоду Маврикиевичу\. Надпись: «В этом здании/u);
  assert.ok(text.includes("Дата установки: 06.06.1978."));
  assert.ok(text.includes("Шакаров Г.А. (скульптор)"));
  assert.ok(!/не установлен/u.test(text));
  const source = openDataSource({ datasetId: 2801, datasetVersion: "3.14 01.09.2026", record }, "d1");
  assert.equal(source.url, "https://data.mos.ru/opendata/2801");
  assert.match(source.title, /^Портал открытых данных Правительства Москвы: Мемориальные доски/u);
  assert.deepEqual(source.openData, { datasetId: 2801, recordId: "1", datasetVersion: "3.14 01.09.2026" });
});

test("records without a name, an id or a Moscow location are not usable", () => {
  assert.equal(normalizeOpenDataRecord(2801, { global_id: 1, Cells: { Name: "не установлено" } }), null);
  assert.equal(normalizeOpenDataRecord(2801, { Cells: { Name: "Доска" } }), null);
  assert.equal(normalizeOpenDataRecord(999, { global_id: 1, Cells: { Name: "Доска" } }), null);
  assert.equal(normalizeOpenDataRecord(60869, { global_id: 1, Cells: { SculpName: "Лев", Latitude_WGS84: "0", Longitude_WGS84: "0" } }).location, null);
});

test("dataset download pages rows and features, retries 5xx and never leaks the key", async () => {
  const calls = [];
  let failedOnce = false;
  const respond = (status, body) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async url => {
    const path = new URL(url).pathname + new URL(url).search.replace(/api_key=[^&]+/, "api_key=KEY");
    calls.push(path);
    if (path.startsWith("/v1/datasets/2801/rows") && !failedOnce) { failedOnce = true; return respond(503, {}); }
    if (path.startsWith("/v1/datasets/2801/rows")) return respond(200, [{ global_id: 7, Cells: { Name: "Мемориальная доска Клечковскому" } }]);
    if (path.startsWith("/v1/datasets/2801/features")) return respond(200, { features: [{ geometry: { type: "Point", coordinates: [37.55, 55.81] }, properties: { attributes: { global_id: 7 } } }] });
    return respond(200, { Caption: "Мемориальные доски города Москвы", VersionNumber: "3.14", VersionDate: "01.09.2026", ItemsCount: 1 });
  };
  const result = await fetchOpenDataset(2801, { apiKey: "secret-key", fetchImpl, retry: { wait: async () => {} } });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].location, { lat: 55.81, lon: 37.55 });
  assert.equal(result.datasetVersion, "3.14 01.09.2026");
  assert.ok(calls.some(path => path.includes("$top=500&$skip=0")));

  const denied = async () => new Response("{}", { status: 401 });
  await assert.rejects(fetchOpenDataset(2801, { apiKey: "secret-key", fetchImpl: denied, retry: { wait: async () => {} } }),
    (/** @type {any} */ error) => error.status === 401 && !error.message.includes("secret-key"));
  await assert.rejects(fetchOpenDataset(2801, { apiKey: "", fetchImpl }), /DATA_MOS_API_KEY/);
});
