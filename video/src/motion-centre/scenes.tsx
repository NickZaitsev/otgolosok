import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame} from "remotion";
import {CENTRE_PATH_LENGTH, CENTRE_STOP_PROGRESS, CENTRE_STOPS, CENTRE_WALK, centrePointAt, type Point} from "../centre-geometry";
import {CENTRE_FIRE_START, CENTRE_FPS, CENTRE_ITEM_FRAMES} from "../motion-centre-timeline";
import {plural} from "../russian-plural";
import {C, clamp, easeInOut, easeOut, easeBack, Kicker, Night, Paper, progress, SANS, SERIF, Words} from "../motion-wide/fx";

// Сюжет одной нитью: восемь мест, мимо которых проходят (хук) → Отголосок
// соединяет их в прогулку (карта) → камера ныряет в остановку 7 → там звучит
// её история с источниками (карточка) → призыв. Нумерация мест везде одна.
// Все подписи — из опубликованных историй otgolosok.online (centre-walk.json).
export const CENTRE_SITE = "otgolosok.online";
const STOP_COUNT = CENTRE_STOPS.length;
const SOURCE_COUNT = CENTRE_STOPS.reduce((sum, stop) => sum + stop.sources.length, 0);
const OVERVIEW = {x: 508, y: 546, size: 780};
/** Остановка, в которую ныряет карта и чью историю показывает карточка. */
export const FACT_STOP_INDEX = CENTRE_STOPS.findIndex(({id}) => id === "osm:relation:3030568");

const pop = (frame: number, delay: number, damping = 12) =>
  spring({frame: frame - delay, fps: CENTRE_FPS, config: {damping, stiffness: 160, mass: 0.7}});

const shortAddress = (address: string) => address.replace(/^(\d{6},\s*)?Москва,\s*/, "");

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mixPoint = (from: Point, to: Point, amount: number) => ({x: mix(from.x, to.x, amount), y: mix(from.y, to.y, amount)});

/* ───────────────────────── Карта центра ───────────────────────── */

type Camera = Point & {size: number};

/**
 * Карта центра по данным OSM: вода, парки, улицы, здания и пешеходный путь.
 * Толщины линий и размеры меток заданы в пикселях кадра и не растут с зумом.
 */
function CentreMap({camera, drawn, reached, width, current = -1, faint = false}: {
  camera: Camera;
  drawn: number;
  reached: (index: number) => number;
  width: number;
  current?: number;
  faint?: boolean;
}) {
  const unit = camera.size / width;
  const {layers} = CENTRE_WALK;
  const head = centrePointAt(Math.min(1, Math.max(0, drawn)));
  const dash = {strokeDasharray: `${CENTRE_PATH_LENGTH} ${CENTRE_PATH_LENGTH}`, strokeDashoffset: CENTRE_PATH_LENGTH * (1 - drawn)};
  const line = {fill: "none", strokeLinecap: "round", strokeLinejoin: "round"} as const;
  return (
    <svg viewBox={`${camera.x - camera.size / 2} ${camera.y - camera.size / 2} ${camera.size} ${camera.size}`} preserveAspectRatio="xMidYMid slice" style={{position: "absolute", inset: 0, width: "100%", height: "100%"}} aria-hidden="true">
      <path d={layers.park} fill={faint ? "#1f3a3466" : "#1b3029"} />
      <path d={layers.water} fill={faint ? "#16474a88" : "#123e40"} fillRule="evenodd" />
      <path d={layers.minor} {...line} stroke={faint ? "#ffffff14" : "#3b3028"} strokeWidth={1.4 * unit} />
      <path d={layers.major} {...line} stroke={faint ? "#ffffff22" : "#54443a"} strokeWidth={3 * unit} />
      <path d={layers.building} fill={faint ? "#ffffff0d" : "#29211c"} stroke={faint ? "none" : "#342a23"} strokeWidth={0.6 * unit} />
      <path d={layers.wall} {...line} stroke={`${C.rust}99`} strokeWidth={2.4 * unit} />
      {drawn > 0 && (
        <>
          <path d={CENTRE_WALK.path} {...line} {...dash} stroke={C.cinnabar} strokeOpacity={0.28} strokeWidth={20 * unit} />
          <path d={CENTRE_WALK.path} {...line} {...dash} stroke={C.cream} strokeWidth={9 * unit} />
          <path d={CENTRE_WALK.path} {...line} {...dash} stroke={C.cinnabar} strokeWidth={5 * unit} />
        </>
      )}
      {CENTRE_STOPS.map((stop, index) => {
        const shown = reached(index);
        if (shown <= 0) return null;
        const active = index === current;
        const radius = (active ? 17 : 13) * unit;
        return (
          <g key={stop.id} transform={`translate(${stop.x} ${stop.y}) scale(${shown})`}>
            {active && <circle r={radius * 2.2} fill={C.cinnabar} opacity={0.25} />}
            <circle r={radius} fill={active ? C.cinnabar : C.rust} stroke={C.cream} strokeWidth={3 * unit} />
            <text y={radius * 0.36} textAnchor="middle" fill={C.cream} style={{font: `700 ${radius * 1.05}px ${SANS}`}}>{index + 1}</text>
          </g>
        );
      })}
      {drawn > 0 && drawn < 1 && <circle cx={head.x} cy={head.y} r={7 * unit} fill={C.peach} stroke={C.cream} strokeWidth={3 * unit} />}
    </svg>
  );
}

/* ───────────────────────── 1. Хук: мимо каких мест вы проходите ───────────────────────── */

const itemStart = (index: number) => CENTRE_FIRE_START + index * CENTRE_ITEM_FRAMES;
const FIRE_END = itemStart(STOP_COUNT);
// Место на кадре — справа от текста, на трети ширины от края.
const HOOK_SHIFT = 0.2;

function hookCamera(frame: number): Camera {
  const zoom = 300;
  if (frame < itemStart(0) - 8) {
    const into = progress(frame, 0, itemStart(0) - 8, easeInOut);
    const first = CENTRE_STOPS[0];
    return {x: mix(OVERVIEW.x, first.x - zoom * HOOK_SHIFT, into), y: mix(OVERVIEW.y, first.y, into), size: mix(1100, zoom, into)};
  }
  if (frame >= FIRE_END - 4) {
    const out = progress(frame, FIRE_END - 4, FIRE_END + 36, easeInOut);
    const last = CENTRE_STOPS.at(-1)!;
    return {x: mix(last.x - zoom * HOOK_SHIFT, OVERVIEW.x, out), y: mix(last.y, OVERVIEW.y, out), size: mix(zoom, 900, out)};
  }
  const index = Math.min(STOP_COUNT - 1, Math.floor((frame - itemStart(0) + 8) / CENTRE_ITEM_FRAMES));
  const previous = CENTRE_STOPS[Math.max(0, index - 1)];
  const target = CENTRE_STOPS[index];
  const move = index === 0 ? 1 : progress(frame, itemStart(index) - 8, itemStart(index) + 14, easeInOut);
  const at = mixPoint(previous, target, move);
  return {x: at.x - zoom * HOOK_SHIFT, y: at.y, size: zoom};
}

export function Hook() {
  const frame = useCurrentFrame();
  const current = frame < itemStart(0) - 4 ? -1 : Math.min(STOP_COUNT - 1, Math.floor((frame - itemStart(0) + 4) / CENTRE_ITEM_FRAMES));
  return (
    <Night grid={false} glow={interpolate(frame, [0, 30], [0.3, 1], clamp)}>
      <AbsoluteFill style={{opacity: interpolate(frame, [0, 36, FIRE_END + 20, FIRE_END + 50], [0.25, 0.9, 0.9, 0.4], clamp)}}>
        {/* Пути ещё нет: места разрознены, их соединит прогулка в сцене карты. */}
        <CentreMap camera={hookCamera(frame)} drawn={0} reached={(index) => pop(frame, itemStart(index) + 4, 11)} width={1920} current={frame < FIRE_END + 6 ? current : -1} faint />
      </AbsoluteFill>
      {/* Текст читается поверх карты: левую половину кадра затемняем. */}
      <AbsoluteFill style={{background: `linear-gradient(90deg, ${C.night}f2 0%, ${C.night}cc 38%, ${C.night}00 70%)`}} />

      <AbsoluteFill style={{alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontWeight: 600, fontSize: 150, letterSpacing: -4, lineHeight: 1}}>
        <Words text="Каждый день вы проходите" start={4} stagger={4} exit={36} />
        <Words text="мимо истории." start={14} stagger={5} exit={38} accent={["истории."]} accentItalic style={{marginTop: 10}} />
      </AbsoluteFill>

      {CENTRE_STOPS.map((stop, index) => {
        const from = itemStart(index);
        const to = from + CENTRE_ITEM_FRAMES;
        if (frame < from - 2 || frame > to + 16) return null;
        // Уход последнего слова (сдвиг 2 кадра на слово + 12) завершается до следующего места.
        const exit = to - 16;
        return (
          <AbsoluteFill key={stop.id} style={{padding: "0 0 40px 140px", justifyContent: "center"}}>
            <div style={{display: "flex", alignItems: "baseline", gap: 28, opacity: interpolate(frame, [from, from + 6, exit + 2, exit + 10], [0, 1, 1, 0], clamp), transform: `translateY(${interpolate(frame, [from, from + 14, exit, exit + 12], [30, 0, 0, -30], {...clamp, easing: easeOut})}px)`}}>
              <div style={{font: `700 120px ${SANS}`, letterSpacing: -4, lineHeight: 1, color: "transparent", WebkitTextStroke: `2px ${C.cinnabar}`, fontVariantNumeric: "lining-nums tabular-nums"}}>
                {String(index + 1).padStart(2, "0")}
              </div>
              <div style={{font: `700 26px ${SANS}`, letterSpacing: 5, textTransform: "uppercase", color: C.peach}}>
                {shortAddress(stop.address)}
              </div>
            </div>
            <Words
              text={stop.label}
              start={from + 3}
              stagger={3}
              exit={exit}
              accent={[stop.label.split(" ").at(-1)!]}
              accentItalic
              style={{fontFamily: SERIF, fontWeight: 600, fontSize: 132, letterSpacing: -3, lineHeight: 1.02, maxWidth: 1080, marginTop: 18}}
            />
          </AbsoluteFill>
        );
      })}

      {/* Счётчик мест: точки загораются по одной, но ещё не связаны путём. */}
      <div style={{position: "absolute", left: 140, bottom: 96, display: "flex", alignItems: "center", gap: 40, opacity: interpolate(frame, [itemStart(0) - 6, itemStart(0) + 6, FIRE_END + 4, FIRE_END + 14], [0, 1, 1, 0], clamp)}}>
        {CENTRE_STOPS.map((stop, index) => {
          const lit = pop(frame, itemStart(index), 10);
          return <div key={stop.id} style={{width: 18, height: 18, borderRadius: "50%", border: `2px solid ${lit > 0.5 ? C.cinnabar : "rgba(255,255,255,0.3)"}`, background: lit > 0.5 ? C.cinnabar : "transparent", boxShadow: index === current ? `0 0 18px ${C.cinnabar}` : "none", transform: `scale(${index === current ? 1.35 : 1})`}} />;
        })}
        <div style={{marginLeft: 10, font: `600 26px ${SANS}`, color: C.muted, fontVariantNumeric: "lining-nums tabular-nums"}}>
          {Math.max(1, current + 1)} из {STOP_COUNT}
        </div>
      </div>

      <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
        <Words text="Что они помнят?" start={FIRE_END + 4} stagger={4} accent={["помнят?"]} accentItalic style={{fontFamily: SERIF, fontWeight: 600, fontSize: 160, letterSpacing: -4}} />
      </AbsoluteFill>
      <AbsoluteFill style={{background: C.rust, mixBlendMode: "screen", opacity: interpolate(frame, [itemStart(0), itemStart(0) + 3, itemStart(0) + 8], [0, 0.3, 0], clamp)}} />
    </Night>
  );
}

/* ───────────────────────── 3. Карта: места соединяются в прогулку ───────────────────────── */

const DRAW_FROM = 20;
const DRAW_TO = 150;
const PULL_FROM = 146;
const PULL_TO = 186;
// Нырок к остановке с карточки: карта разворачивается на весь кадр.
const DIVE_FROM = 222;
const DIVE_TO = 276;
const drawnAt = (frame: number) => progress(frame, DRAW_FROM, DRAW_TO, easeInOut);
// Кадр, когда линия доходит до остановки: ищем по той же кривой, что рисует путь.
const REACHED_AT = CENTRE_STOP_PROGRESS.map((share) => {
  for (let frame = DRAW_FROM; frame <= DRAW_TO; frame += 0.25) if (drawnAt(frame) >= share - 1e-6) return frame;
  return DRAW_TO;
});

function Counter({value, at, label, format = (n: number) => String(n)}: {value: number; at: number; label: string; format?: (value: number) => string}) {
  const frame = useCurrentFrame();
  const shown = progress(frame, at, at + 16);
  return (
    <div style={{opacity: shown, transform: `translateY(${(1 - shown) * 30}px)`}}>
      <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 104, lineHeight: 1, fontVariantNumeric: "lining-nums tabular-nums"}}>{format(Math.round(value * progress(frame, at, at + 40, Easing.out(Easing.cubic))))}</div>
      <div style={{font: `600 26px ${SANS}`, color: C.teal, marginTop: 6}}>{label}</div>
    </div>
  );
}

const thousands = (value: number) => value.toLocaleString("ru-RU").replace(/\s/g, " ");

export function RouteMap() {
  const frame = useCurrentFrame();
  const drawn = drawnAt(frame);
  const head = centrePointAt(drawn);
  const pull = progress(frame, PULL_FROM, PULL_TO, easeInOut);
  const dive = progress(frame, DIVE_FROM, DIVE_TO, easeInOut);
  const target = CENTRE_STOPS[FACT_STOP_INDEX];
  const followed = {x: mix(head.x, OVERVIEW.x, pull), y: mix(head.y, OVERVIEW.y, pull), size: mix(360, OVERVIEW.size, pull)};
  const camera = {x: mix(followed.x, target.x, dive), y: mix(followed.y, target.y, dive), size: mix(followed.size, 220, dive)};
  const tilt = interpolate(frame, [0, 60, DIVE_FROM], [58, 30, 20], {...clamp, easing: easeOut}) * (1 - dive);
  const turn = interpolate(frame, [0, DIVE_FROM], [-22, -6], clamp) * (1 - dive);
  const reachedIndex = REACHED_AT.reduce((last, at, index) => (frame >= at ? index : last), -1);
  const current = frame >= DIVE_FROM ? FACT_STOP_INDEX : frame < PULL_FROM ? reachedIndex : -1;
  const labelIn = frame >= DIVE_FROM ? pop(frame, DIVE_FROM + 10, 12) : current >= 0 ? pop(frame, REACHED_AT[current], 12) * (1 - pull) : 0;
  const text = 1 - progress(frame, DIVE_FROM - 4, DIVE_FROM + 14, easeInOut);
  // Прямоугольник карты: от квадрата справа до всего кадра.
  const box = {left: mix(1010, 0, dive), top: mix(130, 0, dive), width: mix(820, 1920, dive), height: mix(820, 1080, dive)};
  return (
    <Night grid={false}>
      <div style={{position: "absolute", left: 120, top: 90, opacity: text}}>
        <Kicker>Отголосок соединяет их</Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 112, lineHeight: 0.98, letterSpacing: -3, marginTop: 26}}>
          <Words text="Восемь мест —" start={4} stagger={5} />
          <Words text="одна прогулка" start={12} stagger={5} accent={["прогулка"]} accentItalic />
        </div>
        <div style={{marginTop: 30, display: "flex", flexDirection: "column", gap: 8}}>
          {CENTRE_STOPS.map((stop, index) => {
            const shown = pop(frame, REACHED_AT[index], 14);
            const active = index === current;
            return (
              <div key={stop.id} style={{display: "flex", alignItems: "center", gap: 16, transform: `translateX(${(1 - shown) * -80}px)`, opacity: Math.min(1, shown * 1.5)}}>
                <div style={{width: 36, height: 36, borderRadius: "50%", background: active ? C.cinnabar : C.rust, border: `2px solid ${C.cream}`, display: "flex", alignItems: "center", justifyContent: "center", font: `700 18px ${SANS}`, boxShadow: active ? `0 0 20px ${C.cinnabar}` : "none"}}>{index + 1}</div>
                <div style={{font: `600 28px ${SANS}`, color: active ? C.ink : "#d9d1c6"}}>{stop.label}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{position: "absolute", left: 120, bottom: 64, display: "flex", gap: 80, opacity: text}}>
        <Counter value={STOP_COUNT} at={150} label={plural(STOP_COUNT, ["история", "истории", "историй"])} />
        <Counter value={CENTRE_WALK.distanceM} at={158} label={`${plural(CENTRE_WALK.distanceM, ["метр", "метра", "метров"])} пешком`} format={thousands} />
        <Counter value={SOURCE_COUNT} at={166} label={plural(SOURCE_COUNT, ["источник", "источника", "источников"])} />
      </div>
      <div style={{position: "absolute", ...box, perspective: 2000}}>
        <div style={{position: "relative", width: "100%", height: "100%", transform: `translateY(${interpolate(frame, [0, 50], [300, 0], {...clamp, easing: easeOut})}px) rotateX(${tilt}deg) rotateZ(${turn}deg)`, transformStyle: "preserve-3d", borderRadius: 40 * (1 - dive), overflow: "hidden", background: "#15110f", boxShadow: `0 80px 140px #000a, 0 0 0 ${10 * (1 - dive)}px #fffefa14, 0 0 160px ${C.rust}44`}}>
          <CentreMap camera={camera} drawn={drawn} reached={(index) => pop(frame, REACHED_AT[index], 8)} width={box.width} current={current} />
          {/* Подпись текущей остановки у верхнего края карты. */}
          <div style={{position: "absolute", left: mix(28, 120, dive), top: mix(26, 90, dive), display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderRadius: 999, background: "#0d0b0ae0", border: `1px solid ${C.cinnabar}66`, font: `700 ${mix(24, 32, dive)}px ${SANS}`, color: C.ink, opacity: labelIn, transform: `translateY(${(1 - labelIn) * -16}px)`}}>
            <span style={{color: C.cinnabar}}>{current + 1}</span>
            {current >= 0 ? CENTRE_STOPS[current].label : ""}
          </div>
          <div style={{position: "absolute", right: 16, bottom: 12, background: "#0d0b0acc", color: C.muted, font: `600 16px ${SANS}`, padding: "4px 8px", borderRadius: 6}}>© OpenStreetMap contributors</div>
        </div>
      </div>
    </Night>
  );
}

/* ───────────────────────── 4. На месте: история звучит, факты со ссылками ───────────────────────── */

const factStop = CENTRE_STOPS[FACT_STOP_INDEX];
const factSentence = factStop.paragraph.split(/(?<=[.!?])\s/)[0];
/** Голос в сцене: с какого кадра и сколько кадров звучит первая фраза до паузы. */
export const FACT_VOICE_FROM = 14;
export const FACT_VOICE_FRAMES = 160;
// Первая фраза до паузы — «Покровский собор, … храм Василия Блаженного,» — звучит 0,3–5,3 с.
const VOICED_WORDS = 8;
const VOICE_WORDS_FROM = FACT_VOICE_FROM + 9;
const VOICE_WORDS_TO = FACT_VOICE_FROM + 155;
/** Второй такт карточки: после голоса — источники. */
const SOURCES_AT = 132;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function Facts() {
  const frame = useCurrentFrame();
  const words = factSentence.split(" ");
  const duration = factStop.audio?.durationSec ?? 60;
  const listened = interpolate(frame, [FACT_VOICE_FROM, FACT_VOICE_FROM + FACT_VOICE_FRAMES], [0, 5.3], clamp);
  return (
    <Paper>
      <AbsoluteFill style={{padding: "0 0 0 120px", justifyContent: "center"}}>
        <Kicker dark={false}>Остановка {FACT_STOP_INDEX + 1} из {STOP_COUNT}</Kicker>
        <div style={{position: "relative", height: 250, marginTop: 36, fontFamily: SERIF, fontWeight: 600, fontSize: 124, lineHeight: 0.98, letterSpacing: -3}}>
          <div style={{position: "absolute", inset: 0}}>
            <Words text="Вы на месте —" start={4} stagger={5} exit={SOURCES_AT - 14} />
            <Words text="история звучит." start={12} stagger={5} exit={SOURCES_AT - 12} accent={["звучит."]} accentColor={C.rust} accentItalic />
          </div>
          <div style={{position: "absolute", inset: 0}}>
            <Words text="Каждый факт —" start={SOURCES_AT} stagger={5} />
            <Words text="со ссылкой." start={SOURCES_AT + 8} stagger={5} accent={["ссылкой."]} accentColor={C.rust} accentItalic />
          </div>
        </div>
        <div style={{position: "relative", height: 100, marginTop: 40, font: `600 32px ${SANS}`, color: C.paperMuted, maxWidth: 700, lineHeight: 1.4}}>
          <div style={{position: "absolute", inset: 0, opacity: progress(frame, 30, 44) * (1 - progress(frame, SOURCES_AT - 14, SOURCES_AT - 4))}}>
            Голос рассказывает о месте, у которого вы стоите.
          </div>
          <div style={{position: "absolute", inset: 0, opacity: progress(frame, SOURCES_AT + 20, SOURCES_AT + 34)}}>
            Источники открываются прямо на карточке истории.
          </div>
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          right: 110,
          top: 110,
          width: 780,
          padding: "38px 44px 32px",
          borderRadius: 32,
          background: C.cream,
          border: `1px solid ${C.paperLine}`,
          boxShadow: `0 50px 120px rgba(58,42,26,0.16), 0 0 0 10px ${C.rust}0f`,
          opacity: progress(frame, 8, 20),
          transform: `translateY(${(1 - progress(frame, 8, 34, easeBack)) * 120}px) rotate(${(1 - progress(frame, 8, 34)) * 6}deg)`,
        }}
      >
        <div style={{display: "flex", alignItems: "center", gap: 12, font: `600 22px ${SANS}`, color: C.paperMuted}}>
          <div style={{width: 30, height: 30, borderRadius: "50%", background: C.cinnabar, color: C.cream, display: "flex", alignItems: "center", justifyContent: "center", font: `700 16px ${SANS}`}}>{FACT_STOP_INDEX + 1}</div>
          {shortAddress(factStop.address)}
        </div>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 52, lineHeight: 1.05, marginTop: 10, color: C.green}}>{factStop.title}</div>
        {/* Плеер: история действительно звучит в ролике — это её опубликованная озвучка. */}
        <div style={{display: "flex", alignItems: "center", gap: 18, marginTop: 20, padding: "12px 18px", borderRadius: 18, background: "#f0ebe0"}}>
          <div style={{width: 46, height: 46, borderRadius: "50%", background: C.rust, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
            <div style={{display: "flex", gap: 5}}>
              <div style={{width: 5, height: 16, background: C.cream, borderRadius: 2}} />
              <div style={{width: 5, height: 16, background: C.cream, borderRadius: 2}} />
            </div>
          </div>
          <div style={{flex: 1, display: "flex", alignItems: "center", gap: 4, height: 40}}>
            {Array.from({length: 44}, (_, index) => {
              const played = index / 44 < listened / duration;
              const height = 8 + Math.abs(Math.sin(index * 1.7) * 18 + Math.sin(index * 0.6 + frame / 4) * (played ? 8 : 2));
              return <div key={index} style={{width: 5, height, borderRadius: 3, background: played ? C.rust : "#d6cdbd"}} />;
            })}
          </div>
          <div style={{font: `600 20px ${SANS}`, color: C.paperMuted, fontVariantNumeric: "tabular-nums"}}>
            {clock(listened)} / {clock(duration)}
          </div>
        </div>
        <div style={{font: `400 28px ${SANS}`, color: C.paperInk, lineHeight: 1.5, marginTop: 20}}>
          {words.map((word, index) => {
            // Слова после паузы в ролике не звучат и остаются приглушёнными.
            const at = VOICE_WORDS_FROM + (index / VOICED_WORDS) * (VOICE_WORDS_TO - VOICE_WORDS_FROM);
            const shown = index < VOICED_WORDS ? progress(frame, at, at + 8) : 0;
            return <span key={index} style={{opacity: 0.3 + shown * 0.7}}>{word} </span>;
          })}
        </div>
        <div style={{opacity: progress(frame, SOURCES_AT - 4, SOURCES_AT + 10)}}>
          <div style={{height: 1, background: C.paperLine, margin: "24px 0 16px"}} />
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
            <div style={{font: `700 20px ${SANS}`, letterSpacing: 3, textTransform: "uppercase", color: C.rust}}>Источники</div>
            <div style={{padding: "6px 14px", borderRadius: 999, background: "#1f6f6b14", color: "#1f6f6b", font: `700 20px ${SANS}`, transform: `scale(${pop(frame, SOURCES_AT + 40, 10)})`}}>
              {factStop.sources.length} {plural(factStop.sources.length, ["источник", "источника", "источников"])}
            </div>
          </div>
          {factStop.sources.map((source, index) => {
            const at = SOURCES_AT + 6 + index * 10;
            const shown = progress(frame, at, at + 18);
            return (
              <div key={source.url} style={{display: "flex", gap: 14, alignItems: "center", marginTop: 14, opacity: shown, transform: `translateX(${(1 - shown) * 60}px)`}}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={C.rust} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0}} aria-hidden="true">
                  <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                  <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
                </svg>
                <div style={{font: `700 22px ${SANS}`, color: C.paperInk, flexShrink: 0}}>{source.publisher}</div>
                <div style={{font: `400 22px ${SANS}`, color: C.paperMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{source.title}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Paper>
  );
}
