import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {beforeAll, describe, expect, it} from "vitest";
import {redSquareSamples, SAMPLE_RATE} from "../../scripts/red-square-music.mjs";
import {decodePolyline6, mapLayers, pickStops, projection, simplify, STOPS, VIEW} from "../../scripts/fetch-red-square-walk.mjs";
import {parseRenderArgs, resolveScenePath} from "../../scripts/lib/frame-render.mjs";
import {speechBounds} from "../../scripts/lib/voice-audio.mjs";
import {checkScript, checkVoice, loadVoice, voiceTrack} from "../../scripts/render-red-square-video.mjs";
import {
  BEAT, BOARD, DURATION, FACTS, FACT_LENGTH, FPS, FRAME_COUNT, PLAYER, SCENES,
  VOICE_AT, VOICE_GAP, cameraProject, cameraTransform, musicScore, scene, spokenLength, voiceSchedule, wordTimes,
} from "../../video/red-square/timeline.mjs";

const walk = JSON.parse(readFileSync(resolve("video/red-square/walk.json"), "utf8"));

describe("хронометраж ролика «Красная площадь и Варварка»", () => {
  it("сцены идут встык от нуля, склейки стоят на ударах", () => {
    expect(SCENES[0].start).toBe(0);
    SCENES.forEach((item, index) => {
      expect(item.end).toBeGreaterThan(item.start);
      if (index > 0) expect(item.start).toBe(SCENES[index - 1].end);
      expect((item.start / BEAT) % 1).toBe(0);
    });
    expect(FRAME_COUNT).toBe(DURATION * FPS);
  });

  it("карточки фактов делят сцену поровну и сменяются на ударах", () => {
    expect(FACT_LENGTH * FACTS.length).toBe(scene("facts").end - scene("facts").start);
    expect((FACT_LENGTH / BEAT) % 1).toBe(0);
  });

  it("музыка получает склейки, смены фактов и стук табло внутри своих сцен", () => {
    const score = musicScore();
    expect(score.seconds).toBe(DURATION);
    expect(score.cuts).toEqual(SCENES.slice(1).map(({start}) => start));
    expect(score.hits).toHaveLength(FACTS.length - 1);
    for (const hit of score.hits) {
      expect(hit).toBeGreaterThan(scene("facts").start);
      expect(hit).toBeLessThan(scene("facts").end);
    }
    expect(score.ticks).toHaveLength(BOARD.length);
    expect(score.ticks.at(-1)).toBeLessThan(scene("board").end);
    expect(score.duck).toEqual([scene("player").start, scene("player").end]);
    expect(score.finale).toBe(scene("brand").start);
  });

  it("неизвестная сцена — ошибка, а не пустое значение", () => {
    expect(() => scene("intro")).toThrow(RangeError);
  });
});

describe("сверка сценария с опубликованными историями", () => {
  it("факты и фраза на экране взяты из текущего walk.json", () => {
    expect(() => checkScript(walk)).not.toThrow();
    expect(walk.stops.map(({id}: {id: string}) => id)).toEqual(STOPS.map(({id}) => id));
  });

  const replaceStory = (index: number, text: string) => ({
    ...walk,
    stops: walk.stops.map((stop: {paragraphs: string[]}, order: number) => (order === index ? {...stop, paragraphs: [text]} : stop)),
  });

  it.each([
    ["изменилась история факта", replaceStory(FACTS[1].stop, "Собор построили в XVI веке.") , /не подтверждён/],
    ["изменилась история экрана", replaceStory(PLAYER.stop, FACTS[1].evidence.join(" ")), /Фразы «Его композицию/],
    [
      "остановку экрана переименовали",
      {...walk, stops: walk.stops.map((stop: {label: string}, order: number) => (order === PLAYER.stop ? {...stop, label: "Покровский собор"} : stop))},
      /Заголовок озвучки/,
    ],
    ["остановок меньше, чем нужно фактам", {...walk, stops: walk.stops.slice(0, 3)}, /нет остановки/],
    ["нет маршрута", {...walk, route: []}, /геометрии маршрута/],
  ])("%s — рендер останавливается", (_, broken, message) => {
    expect(() => checkScript(broken)).toThrow(message);
  });
});

describe("камера карты", () => {
  const flat = {cx: 500, cy: 600, zoom: 2, tilt: 0, ox: 540, oy: 1000, perspective: 2200};

  it("без наклона — обычное увеличение вокруг центра", () => {
    expect(cameraProject(flat, {x: 500, y: 600})).toEqual({x: 540, y: 1000, scale: 1});
    expect(cameraProject(flat, {x: 510, y: 590})).toEqual({x: 560, y: 980, scale: 1});
  });

  it("с наклоном верх карты уходит вдаль и сжимается, низ приближается", () => {
    const tilted = {...flat, tilt: 50};
    const far = cameraProject(tilted, {x: 500, y: 400});
    const near = cameraProject(tilted, {x: 500, y: 800});
    expect(far.scale).toBeLessThan(1);
    expect(near.scale).toBeGreaterThan(1);
    expect(1000 - far.y).toBeLessThan(400);
    expect(near.y - 1000).toBeGreaterThan(400 * Math.cos((50 * Math.PI) / 180));
  });

  it("точка за камерой — ошибка вместо перевёрнутой метки", () => {
    expect(() => cameraProject({...flat, tilt: 80, zoom: 4}, {x: 500, y: 1300})).toThrow(RangeError);
  });

  it("CSS-трансформация использует те же параметры", () => {
    expect(cameraTransform({...flat, tilt: 50})).toBe("translate(540.00px, 1000.00px) rotateX(50.000deg) scale(2.0000) translate(-500.00px, -600.00px)");
  });
});

describe("время слов на экране истории", () => {
  it("первое слово — в начале, дальше по длине слов", () => {
    const times = wordTimes(["а", "длинноеслово", "б"], 1, 3);
    expect(times[0]).toBe(1);
    expect(times[2] - times[1]).toBeGreaterThan(times[1] - times[0]);
    expect(times[2]).toBeLessThan(3);
  });

  it.each([[[], 0, 1], [["слово"], 2, 2]])("пустой список или отрезок %# — ошибка", (words, from, to) => {
    expect(() => wordTimes(words as string[], from as number, to as number)).toThrow(RangeError);
  });
});

describe("озвучка экрана истории", () => {
  it.each([
    ["слово", 5],
    ["1588", 36],
    ["1958-м", 38],
    ["", 0],
  ])("«%s» диктор произносит как %i букв", (word, expected) => {
    expect(spokenLength(word)).toBe(expected);
  });

  it("год, который читают словами, получает больше времени, чем короткое слово", () => {
    const [, year, after, end] = [...wordTimes(["В", "1588", "году"], 0, 4), 4];
    expect(after - year).toBeGreaterThan(end - after);
  });

  it("реплики звучат встык по речи: тишина в начале клипа уходит раньше старта", () => {
    const schedule = voiceSchedule([{id: "a", lead: 0.3, speech: 2}, {id: "b", lead: 0.5, speech: 1}], {at: 1, gap: 0.4});
    expect(schedule).toEqual([
      {id: "a", at: 0.7, from: 1, to: 3},
      {id: "b", at: 2.9, from: 3.4, to: 4.4},
    ]);
  });

  it.each([
    ["клип без речи", [{id: "a", lead: 0, speech: 0}]],
    ["тишина длиннее отступа сцены", [{id: "a", lead: VOICE_AT + 0.1, speech: 1}]],
  ])("%s — ошибка", (_, clips) => {
    expect(() => voiceSchedule(clips)).toThrow(RangeError);
  });

  it("манифест озвучки проверяется по тексту диктора", () => {
    const manifest = Object.fromEntries(PLAYER.narration.map(({id, speech}) => [id, {text: speech}]));
    expect(() => checkVoice(manifest)).not.toThrow();
    const withoutNine = Object.fromEntries(Object.entries(manifest).filter(([id]) => id !== "nine"));
    expect(() => checkVoice(withoutNine)).toThrow(/Нет клипа озвучки «nine»/);
    expect(() => checkVoice({...manifest, tenth: {text: "В 1588 году…"}})).toThrow(/по старому тексту/);
  });

  const pcm = (samples: number[]) => {
    const buffer = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2));
    return buffer;
  };

  const samples = (track: Buffer, from: number, to: number) => Array.from({length: to - from}, (_, index) => track.readInt16LE((from + index) * 2));

  it("тишина в начале следующего клипа не съедает конец предыдущей фразы", () => {
    // 100 сэмплов/с. Фраза A звучит 0,1–1,0 с; у клипа B 0,45 с тишины — дольше паузы 0,35 с.
    const first = pcm([...Array(10).fill(0), ...Array(90).fill(1000), ...Array(50).fill(0)]);
    const second = pcm([...Array(45).fill(0), ...Array(15).fill(2000), ...Array(20).fill(0)]);
    const schedule = [{at: 0, from: 0.1, to: 1.0}, {at: 0.9, from: 1.35, to: 1.5}];
    const track = voiceTrack(schedule, [first, second], {offset: 0, seconds: 2, sampleRate: 100});
    expect(samples(track, 11, 99)).toEqual(Array(88).fill(1000));
    expect(samples(track, 136, 149)).toEqual(Array(13).fill(2000));
  });

  it("клип обрезается до речи с короткими краями: щелчок в хвосте и тишина не попадают в дорожку", () => {
    const clip = pcm([...Array(20).fill(0), ...Array(50).fill(1000), ...Array(40).fill(0), 9000, ...Array(9).fill(0)]);
    const track = voiceTrack([{at: 0, from: 0.2, to: 0.7}], [clip], {offset: 1, seconds: 3, sampleRate: 100});
    expect(samples(track, 0, 115)).toEqual(Array(115).fill(0));
    expect(samples(track, 121, 169)).toEqual(Array(48).fill(1000));
    expect(samples(track, 185, 300)).toEqual(Array(115).fill(0));
    // Края — плавные, без ступеньки на полную громкость.
    expect(Math.abs(track.readInt16LE(115 * 2))).toBeLessThan(1000);
  });

  it("дорожка голоса: клип за концом ролика или наложение фраз — ошибка", () => {
    const clip = pcm(Array(100).fill(1000));
    expect(() => voiceTrack([{at: 3, from: 3, to: 3.9}], [clip], {offset: 0, seconds: 3.5, sampleRate: 100})).toThrow(RangeError);
    expect(() => voiceTrack([{at: 0, from: 0, to: 0.9}, {at: 0.5, from: 0.5, to: 0.9}], [clip, clip], {offset: 0, seconds: 3, sampleRate: 100})).toThrow(/наклад/);
  });

  it("границы речи: тишина по краям и щелчок далеко в хвосте не считаются", () => {
    // Окно 20 мс при 1000 Гц — 20 сэмплов: 0,1 с тишины, 0,2 с речи, 0,6 с тишины, щелчок.
    const loud = (count: number) => Array.from({length: count}, (_, index) => (index % 2 ? 8000 : -8000));
    const samples = [...Array(100).fill(0), ...loud(200), ...Array(600).fill(0), ...loud(20), ...Array(40).fill(0)];
    expect(speechBounds(pcm(samples), 1000)).toEqual({start: 0.1, end: 0.3});
    expect(() => speechBounds(pcm(Array(200).fill(0)), 1000)).toThrow(/нет речи/);
  });

  it("начитанная озвучка укладывается в сцену экрана, эквалайзер — на каждый кадр", async () => {
    const {schedule, levels, track} = await loadVoice();
    const player = scene("player");
    expect(schedule.map(({id}) => id)).toEqual(PLAYER.narration.map(({id}) => id));
    expect(schedule[0].from).toBeCloseTo(VOICE_AT, 6);
    schedule.slice(1).forEach((item, index) => expect(item.from - schedule[index].to).toBeCloseTo(VOICE_GAP, 6));
    expect(schedule.at(-1)!.to).toBeLessThan(player.end - player.start);
    expect(levels).toHaveLength(Math.round((player.end - player.start) * FPS));
    expect(Math.max(...levels)).toBe(1);
    expect(track.length).toBe(Math.round(DURATION * 48000) * 2);
  }, 60_000);
});

describe("музыка ролика", () => {
  const score = musicScore();
  let left: Float32Array;
  let right: Float32Array;
  // Полный синтез 31,5 с стерео занимает несколько секунд.
  beforeAll(() => ({left, right} = redSquareSamples(score)), 60_000);
  const rms = (from: number, to: number) => {
    let sum = 0;
    for (let index = Math.round(from * SAMPLE_RATE); index < Math.round(to * SAMPLE_RATE); index += 1) sum += left[index] ** 2 + right[index] ** 2;
    return Math.sqrt(sum / ((to - from) * SAMPLE_RATE * 2));
  };

  it("длина совпадает с роликом, пик ниже −1 дБFS, края без щелчка", () => {
    expect(left.length).toBe(DURATION * SAMPLE_RATE);
    const peak = [left, right].reduce((most, channel) => channel.reduce((value, sample) => Math.max(value, Math.abs(sample)), most), 0);
    expect(peak).toBeLessThanOrEqual(0.8913);
    expect(peak).toBeGreaterThan(0.5);
    expect(Math.abs(left[0])).toBeLessThan(0.01);
    expect(Math.abs(left.at(-1)!)).toBeLessThan(0.01);
  });

  it("под голосом диктора музыка тише, чем под картой, минимум на 12 дБ", () => {
    const player = scene("player");
    const underVoice = rms(player.start + VOICE_AT, player.end - 1);
    expect(20 * Math.log10(underVoice / rms(scene("map").start + 0.5, scene("map").end - 0.5))).toBeLessThan(-12);
  });

  it("склейка в экран истории звучит в полную силу, приглушение начинается после неё", () => {
    const start = scene("player").start;
    expect(rms(start, start + 0.3)).toBeGreaterThan(rms(start + VOICE_AT, start + VOICE_AT + 0.3) * 2);
  });

  it("синтез детерминирован", () => {
    const short = {seconds: 3, beat: 0.5, groove: 0.5, drive: [1, 2] as [number, number], cuts: [1], hits: [1.5], bells: [0.2], ticks: [2.2], duck: [2, 2.5] as [number, number], finale: 2.5};
    expect(redSquareSamples(short).left).toEqual(redSquareSamples(short).left);
  });

  it.each([
    ["склейка за концом ролика", {...score, cuts: [DURATION + 1]}],
    ["пустое приглушение", {...score, duck: [5, 5] as [number, number]}],
    ["нулевая доля такта", {...score, beat: 0}],
  ])("%s — ошибка", (_, broken) => {
    expect(() => redSquareSamples(broken)).toThrow(RangeError);
  });
});

describe("данные прогулки из OSM и Valhalla", () => {
  it("polyline6 декодируется с точностью 1e-6", () => {
    // Пример Google для точности 5 даёт при точности 6 те же цифры, делённые на 10.
    expect(decodePolyline6("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([[-12.02, 3.85], [-12.095, 4.07], [-12.6453, 4.3252]]);
    expect(() => decodePolyline6("_p~i")).toThrow("Оборванная");
  });

  it("упрощение убирает точки на прямой и сохраняет излом", () => {
    expect(simplify([[0, 0], [1, 0.01], [2, 0], [3, 0]], 0.5)).toEqual([[0, 0], [3, 0]]);
    expect(simplify([[0, 0], [5, 5], [10, 0]], 0.5)).toEqual([[0, 0], [5, 5], [10, 0]]);
  });

  it("проекция: запад и восток на краях кадра, центральная широта посередине", () => {
    const {project, bounds} = projection();
    expect(project(VIEW.west, VIEW.centerLat)).toEqual([0, VIEW.height / 2]);
    expect(project(VIEW.east, VIEW.centerLat)[0]).toBeCloseTo(VIEW.width, 6);
    expect(project(VIEW.west, bounds.north)[1]).toBeCloseTo(0, 6);
    expect(project(VIEW.west, bounds.south)[1]).toBeCloseTo(VIEW.height, 6);
  });

  it("слои: здание-мультиполигон склеивается из кусков, мелкие постройки отбрасываются", () => {
    const {project, bounds} = projection();
    const lat = (bounds.north + bounds.south) / 2;
    const lon = (VIEW.west + VIEW.east) / 2;
    const d = 0.0005;
    const square = [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d]].map(([x, y]) => ({lon: x, lat: y}));
    const layers = mapLayers([
      {type: "relation", id: 1, tags: {building: "yes"}, members: [
        {type: "way", role: "outer", geometry: [square[0], square[1], square[2]]},
        {type: "way", role: "outer", geometry: [square[0], square[3], square[2]]},
      ]},
      {type: "way", id: 2, tags: {building: "yes"}, geometry: [square[0], {lon: lon + 0.00001, lat}, {lon, lat: lat + 0.00001}, square[0]]},
      {type: "way", id: 3, tags: {highway: "primary"}, geometry: [square[0], square[1]]},
    ]);
    expect(layers.buildings).toHaveLength(1);
    expect(layers.buildings[0].d.endsWith("Z")).toBe(true);
    const [x] = project(lon, lat);
    expect(layers.buildings[0].c[0]).toBeGreaterThan(x);
    expect(layers.major.startsWith("M")).toBe(true);
    expect(layers.minor).toBe("");
  });

  it("остановка без опубликованной истории — ошибка с её названием", () => {
    expect(() => pickStops([])).toThrow(STOPS[0].label);
    const places = STOPS.map(({id}) => ({id, name: id, location: {lat: 55.75, lon: 37.62}, story: {title: id, paragraphs: [{text: "Текст"}]}}));
    expect(pickStops(places)).toHaveLength(STOPS.length);
    places[3].story.paragraphs = [];
    expect(() => pickStops(places)).toThrow("нет текста");
  });
});

describe("раздача сцены и аргументы рендера", () => {
  const sceneDir = resolve("video/red-square");

  it.each([
    ["/", join(sceneDir, "index.html")],
    ["/scene.mjs", join(sceneDir, "scene.mjs")],
    ["/shared/motion.mjs", resolve("video/shared/motion.mjs")],
    ["/fonts/manrope/400.css", resolve("node_modules/@fontsource/manrope/400.css")],
  ])("%s → файл сцены", (path, file) => {
    expect(resolveScenePath(sceneDir, path)).toBe(file);
  });

  it.each(["/../../package.json", "/shared/../../.env", "/fonts/../../../.env"])("выход за папку %s запрещён", (path) => {
    expect(resolveScenePath(sceneDir, path)).toBeNull();
  });

  it.each([
    [["--preview"], {mode: "preview"}],
    [["--stills", "1.5,8"], {mode: "stills", times: [1.5, 8]}],
    [[], {mode: "video"}],
  ])("%j", (args, expected) => {
    expect(parseRenderArgs(args)).toEqual(expected);
  });

  it.each([[["--stills"]], [["--stills", "a,b"]]])("%j без секунд — ошибка", (args) => {
    expect(() => parseRenderArgs(args)).toThrow(RangeError);
  });
});
