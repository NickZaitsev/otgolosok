import type {ReactNode} from "react";
import {AbsoluteFill, Easing, Html5Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import {CENTRE_PATH_LENGTH, CENTRE_STOP_PROGRESS, CENTRE_STOPS, CENTRE_WALK, centrePointAt, type Point} from "./centre-geometry";
import {
  CENTRE_VERTICAL_FPS,
  CENTRE_VERTICAL_PLACES,
  CENTRE_VERTICAL_SCENES,
  CENTRE_VERTICAL_VOICE,
  getCentreVerticalFrameState,
} from "./centre-vertical-timeline";
import {SANS, SERIF} from "./guide-fonts";
import {Chars, CutBands, DotGrid, Grain, Kicker, cream, deep, green, ink, paper, peach, pop, progress, rust, sage, swing} from "./motion-kit";
import type {MotionSceneId} from "./motion-timeline";
import {Badge, Brand, Counter, Echo, Promises, Waveform, reveals, type PromiseCard} from "./otgolosok-motion";
import {plural} from "./russian-plural";

// Все подписи и цифры — из опубликованных историй otgolosok.online (centre-walk.json).
const city = staticFile("video/moscow-evening.webp");
const story = staticFile("centre/story.mp3");
const bed = staticFile("centre/vertical-bed.wav");

const STOP_COUNT = CENTRE_STOPS.length;
const SOURCE_COUNT = new Set(CENTRE_STOPS.flatMap((stop) => stop.sources.map((source) => source.url))).size;
const DISTANCE_KM = Math.round(CENTRE_WALK.distanceM / 100) / 10;
const shortAddress = (address: string) => address.replace(/^(\d{6},\s*)?Москва,\s*/, "");
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/* ───────────────────────── Карта центра ───────────────────────── */

type Camera = Point & {size: number};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const mixCamera = (from: Camera, to: Camera, amount: number): Camera => ({x: mix(from.x, to.x, amount), y: mix(from.y, to.y, amount), size: mix(from.size, to.size, amount)});

/** Квадрат, в который помещаются все остановки, с полями. */
const ROUTE_CAMERA: Camera = (() => {
  const xs = CENTRE_STOPS.map(({x}) => x);
  const ys = CENTRE_STOPS.map(({y}) => y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 180;
  return {x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, size};
})();

const themes = {
  dark: {ground: "#15201d", park: "#1b3029", water: "#123e40", minor: "#3b3028", major: "#54443a", building: "#29211c", buildingEdge: "#342a23", wall: `${rust}99`},
  light: {ground: "#f3eee4", park: "#d9e4cf", water: "#b9d5d3", minor: "#ffffff", major: "#efd6a6", building: "#e2d8c8", buildingEdge: "none", wall: `${rust}aa`},
} as const;

/**
 * Карта по данным OSM из centre-walk.json. Толщины линий и метки заданы в пикселях
 * кадра (`pixels` — ширина карты на экране) и не растут с приближением.
 */
function CentreMap({camera, pixels, theme, drawn = 0, reached = () => 0, current = -1, frame = 0}: {
  camera: Camera;
  pixels: number;
  theme: keyof typeof themes;
  drawn?: number;
  reached?: (index: number) => number;
  current?: number;
  frame?: number;
}) {
  const colors = themes[theme];
  const unit = camera.size / pixels;
  const {layers} = CENTRE_WALK;
  const head = centrePointAt(Math.min(1, Math.max(0, drawn)));
  const dash = {strokeDasharray: `${CENTRE_PATH_LENGTH} ${CENTRE_PATH_LENGTH}`, strokeDashoffset: CENTRE_PATH_LENGTH * (1 - drawn)};
  const line = {fill: "none", strokeLinecap: "round", strokeLinejoin: "round"} as const;
  const view = `${camera.x - camera.size / 2} ${camera.y - camera.size / 2} ${camera.size} ${camera.size}`;
  return (
    <svg viewBox={view} preserveAspectRatio="xMidYMid slice" style={{position: "absolute", inset: 0, width: "100%", height: "100%", background: colors.ground}} aria-hidden="true">
      <path d={layers.park} fill={colors.park} />
      <path d={layers.water} fill={colors.water} fillRule="evenodd" />
      <path d={layers.minor} {...line} stroke={colors.minor} strokeWidth={1.6 * unit} />
      <path d={layers.major} {...line} stroke={colors.major} strokeWidth={3.4 * unit} />
      <path d={layers.building} fill={colors.building} stroke={colors.buildingEdge} strokeWidth={0.6 * unit} />
      <path d={layers.wall} {...line} stroke={colors.wall} strokeWidth={2.6 * unit} />
      {drawn > 0 && (
        <>
          <path d={CENTRE_WALK.path} {...line} {...dash} stroke={cream} strokeWidth={11 * unit} />
          <path d={CENTRE_WALK.path} {...line} {...dash} stroke={rust} strokeWidth={6 * unit} />
        </>
      )}
      {CENTRE_STOPS.map((stop, index) => {
        const active = index === current;
        const shown = active ? 1 : reached(index);
        if (shown <= 0) return null;
        const radius = (active ? 20 : 15) * unit;
        const wave = (frame % 36) / 36;
        return (
          <g key={stop.id} transform={`translate(${stop.x} ${stop.y}) scale(${shown})`}>
            {active && <circle r={radius * (1.2 + wave * 2.6)} fill="none" stroke={peach} strokeWidth={3 * unit} opacity={1 - wave} />}
            <circle r={radius} fill={rust} stroke={cream} strokeWidth={3.5 * unit} />
            <text y={radius * 0.36} textAnchor="middle" fill={cream} style={{font: `700 ${radius * 1.05}px ${SANS}`}}>{index + 1}</text>
          </g>
        );
      })}
      {drawn > 0 && drawn < 1 && <circle cx={head.x} cy={head.y} r={8 * unit} fill={peach} stroke={cream} strokeWidth={3 * unit} />}
    </svg>
  );
}

/* ───────────────────────── Сцена «место»: камера по знаковым местам ───────────────────────── */

const ARCH = {left: 160, top: 400, width: 760, height: 1080};
const OVERVIEW: Camera = {...ROUTE_CAMERA, size: ROUTE_CAMERA.size * 1.1};

function placeCamera(frame: number): Camera {
  return CENTRE_VERTICAL_PLACES.reduce(
    (camera, {stop, at}) => mixCamera(camera, {x: stop.x, y: stop.y + 60, size: 440}, progress(frame, at - 12, at + 8, swing)),
    OVERVIEW,
  );
}

function Place({frame}: {frame: number}) {
  const open = progress(frame, 2, 34);
  const current = [...CENTRE_VERTICAL_PLACES].reverse().find(({at}) => frame >= at - 4);
  return (
    <AbsoluteFill style={{background: paper, color: ink, overflow: "hidden"}}>
      <div style={{position: "absolute", left: -40, top: 1560, whiteSpace: "nowrap", font: `600 300px ${SERIF}`, color: "#e8dfcf", transform: `translateX(${-frame * 3}px)`}}>
        история · история · история
      </div>
      <div style={{position: "absolute", ...ARCH, borderRadius: "380px 380px 36px 36px", overflow: "hidden", clipPath: `inset(${(1 - open) * 100}% 0 0 0 round 380px 380px 36px 36px)`, boxShadow: "0 50px 120px #3a2a1a40"}}>
        <CentreMap camera={placeCamera(frame)} pixels={ARCH.height} theme="dark" current={current?.index ?? -1} frame={frame} />
        <AbsoluteFill style={{background: "linear-gradient(180deg, transparent 50%, #0d1714e6 100%)"}} />
        {CENTRE_VERTICAL_PLACES.map(({stop, index, at}, order) => {
          const next = CENTRE_VERTICAL_PLACES[order + 1]?.at;
          const enter = progress(frame, at - 4, at + 12);
          const leave = next === undefined ? 0 : progress(frame, next - 6, next + 4);
          if (enter <= 0 || leave >= 1) return null;
          return (
            <div key={stop.id} style={{position: "absolute", left: 56, right: 56, bottom: 64, overflow: "hidden", paddingBottom: 8}}>
              <div style={{transform: `translateY(${(1 - enter) * 110 - leave * 110}%)`}}>
                <Kicker color={peach}>{`${String(index + 1).padStart(2, "0")} / ${String(STOP_COUNT).padStart(2, "0")}`}</Kicker>
                <div style={{font: `600 84px ${SERIF}`, lineHeight: 0.98, color: cream, marginTop: 14}}>{stop.label}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{position: "absolute", ...ARCH, borderRadius: "380px 380px 36px 36px", border: `3px solid ${rust}`, transform: `translate(${22 * open}px, ${22 * open}px)`, opacity: open * 0.8}} />
      <div style={{position: "absolute", left: 80, top: 130, fontFamily: SERIF, fontWeight: 600, fontSize: 132, lineHeight: 0.95, letterSpacing: -3}}>
        <div><Chars text="У каждого дома —" frame={frame} at={8} step={1.1} /></div>
        <div style={{color: rust, fontStyle: "italic"}}><Chars text="своя история" frame={frame} at={22} step={1.3} /></div>
      </div>
      <div style={{position: "absolute", right: 70, top: 330}}>
        <Badge text="ИСТОРИИ РЯДОМ • ИСТОРИИ РЯДОМ • " frame={frame} size={230} color={cream} delay={30} />
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────── Сцена «маршрут» ───────────────────────── */

const DRAW = {from: 34, to: 150};

function Route({frame}: {frame: number}) {
  const drawn = progress(frame, DRAW.from, DRAW.to, swing);
  const tilt = interpolate(frame, [0, 60, 210], [62, 26, 18], {easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateRight: "clamp"});
  const turn = interpolate(frame, [0, 210], [-14, -6], {easing: Easing.out(Easing.quad), extrapolateRight: "clamp"});
  const lift = interpolate(frame, [0, 60], [260, 0], {easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateRight: "clamp"});
  const reached = (index: number) => pop(frame, DRAW.from + CENTRE_STOP_PROGRESS[index] * (DRAW.to - DRAW.from), 8);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 55%, #2c5249 0%, ${green} 45%, #152a25 100%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff10" />
      <div style={{position: "absolute", left: 80, top: 120}}>
        <Kicker color={peach}><Chars text="Центр Москвы" frame={frame} at={4} /></Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 124, lineHeight: 0.95, letterSpacing: -3, marginTop: 24}}>
          <div><Chars text={`${STOP_COUNT} ${plural(STOP_COUNT, ["место", "места", "мест"])} —`} frame={frame} at={8} step={1.1} /></div>
          <div style={{color: peach, fontStyle: "italic"}}><Chars text="одна прогулка" frame={frame} at={20} step={1.3} /></div>
        </div>
      </div>
      <div style={{position: "absolute", left: 90, top: 560, width: 900, height: 900, perspective: 2200}}>
        <div style={{position: "relative", width: "100%", height: "100%", transform: `translateY(${lift}px) rotateX(${tilt}deg) rotateZ(${turn}deg)`, borderRadius: 40, overflow: "hidden", boxShadow: "0 80px 140px #0009, 0 0 0 10px #fffefa22"}}>
          <CentreMap camera={ROUTE_CAMERA} pixels={900} theme="light" drawn={drawn} reached={reached} />
          <div style={{position: "absolute", right: 18, bottom: 14, background: "#f5f1e8e6", color: "#57504a", font: `600 17px ${SANS}`, padding: "4px 8px", borderRadius: 6}}>© OpenStreetMap contributors</div>
        </div>
      </div>
      <div style={{position: "absolute", left: 80, right: 80, bottom: 130, display: "flex", justifyContent: "space-between"}}>
        <Counter value={STOP_COUNT} frame={frame} at={60} label={plural(STOP_COUNT, ["история", "истории", "историй"])} />
        <Counter value={DISTANCE_KM} decimals={1} frame={frame} at={72} label="км пути" />
        <Counter value={SOURCE_COUNT} frame={frame} at={84} label={plural(SOURCE_COUNT, ["источник", "источника", "источников"])} />
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────── Сцена «слушайте»: плеер и голос истории ───────────────────────── */

const voice = CENTRE_VERTICAL_VOICE;
const VOICE_FRAMES = Math.round((voice.toSec + 0.3 - voice.fromSec) * CENTRE_VERTICAL_FPS);
const voiceWords = voice.sentence.split(" ");
const voiceChars = voice.sentence.length;
/** Кадр сцены, на котором звучит слово: доля текста до слова × длительность речи. */
const wordFrames = voiceWords.map((_, index) => {
  const before = voiceWords.slice(0, index).join(" ").length;
  const second = voice.speechSec + (before / voiceChars) * (voice.toSec - voice.speechSec);
  return voice.delay + (second - voice.fromSec) * CENTRE_VERTICAL_FPS;
});
const voicePublishers = [...new Set(voice.stop.sources.map(({publisher}) => publisher))];

/** Панель прослушивания в стиле приложения, собранная из данных истории. */
function PlayerPanel({frame}: {frame: number}) {
  const played = voice.fromSec + Math.max(0, frame - voice.delay) / CENTRE_VERTICAL_FPS;
  const total = voice.audio.durationSec;
  const muted = "#6f6a63";
  return (
    <div style={{background: "#fdf8ee", borderRadius: 48, padding: "48px 52px 52px", color: green, fontFamily: SANS, boxShadow: "0 60px 140px #000c"}}>
      <div style={{fontSize: 32, color: muted}}>Остановка {voice.stopNumber} из {STOP_COUNT}</div>
      <div style={{font: `700 52px ${SANS}`, lineHeight: 1.12, marginTop: 10}}>{voice.stop.title}</div>
      <div style={{fontSize: 30, color: muted, marginTop: 18}}>{shortAddress(voice.stop.address)}</div>
      <div style={{display: "flex", alignItems: "center", gap: 32, marginTop: 40}}>
        <div style={{flex: "none", width: 112, height: 112, borderRadius: "50%", background: green, display: "grid", placeItems: "center"}}>
          <div style={{display: "flex", gap: 14}}>
            <span style={{width: 12, height: 40, borderRadius: 3, background: cream}} />
            <span style={{width: 12, height: 40, borderRadius: 3, background: cream}} />
          </div>
        </div>
        <div style={{flex: 1}}>
          <div style={{position: "relative", height: 14, borderRadius: 8, background: "#e3ded4", border: "2px solid #cfc9bd"}}>
            <div style={{position: "absolute", left: 0, top: 0, bottom: 0, width: `${(played / total) * 100}%`, borderRadius: 8, background: green}} />
            <div style={{position: "absolute", top: "50%", left: `${(played / total) * 100}%`, width: 36, height: 36, borderRadius: "50%", background: green, transform: "translate(-50%, -50%)"}} />
          </div>
          <div style={{display: "flex", justifyContent: "space-between", fontSize: 26, color: muted, marginTop: 16, fontVariantNumeric: "tabular-nums"}}>
            <span>{clock(played)}</span>
            <span>{clock(total)}</span>
          </div>
        </div>
      </div>
      <div style={{display: "flex", gap: 44, fontSize: 32, marginTop: 36, color: ink}}>
        <span>☰ Остановки · {STOP_COUNT}</span>
        <span>Читать историю</span>
      </div>
      <div style={{marginTop: 40, height: 104, borderRadius: 999, background: rust, color: cream, display: "grid", placeItems: "center", font: `700 38px ${SANS}`}}>Дальше →</div>
    </div>
  );
}

function Listen({frame}: {frame: number}) {
  const card = pop(frame, 12, 13);
  const sway = Math.sin(frame / 38) * 5;
  const bg = interpolate(frame, [0, 210], [1.18, 1.05], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: deep, color: cream, overflow: "hidden"}}>
      <Img src={city} style={{position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${bg})`, filter: "blur(6px) brightness(0.45)"}} />
      <AbsoluteFill style={{background: "linear-gradient(180deg, #0d1714ee 0%, #0d171455 45%, #0d1714f5 100%)"}} />
      <div style={{position: "absolute", left: 80, top: 120}}>
        <Kicker color={peach}><Chars text="Вы на месте" frame={frame} at={2} /></Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 132, lineHeight: 0.95, letterSpacing: -3, marginTop: 24}}>
          <div><Chars text="Слушайте там," frame={frame} at={6} step={1.1} /></div>
          <div style={{color: peach, fontStyle: "italic"}}><Chars text="где это было" frame={frame} at={18} step={1.2} /></div>
        </div>
      </div>
      <div style={{position: "absolute", left: 540, top: 960, transform: "translate(-50%, -50%)", opacity: progress(frame, 10, 40)}}>
        <Waveform frame={frame} radius={330} bars={72} />
      </div>
      <div style={{position: "absolute", left: 60, right: 60, top: 590, perspective: 1800}}>
        <div style={{transform: `translateY(${(1 - card) * 500}px) rotateY(${sway}deg) rotateX(${(1 - card) * 30 + 4}deg)`}}>
          <PlayerPanel frame={frame} />
        </div>
      </div>
      <div style={{position: "absolute", left: 70, right: 70, bottom: 130, textAlign: "center", opacity: progress(frame, voice.delay - 10, voice.delay + 6)}}>
        <div style={{fontFamily: SERIF, fontStyle: "italic", fontSize: 58, lineHeight: 1.18}}>
          {voiceWords.map((word, index) => {
            const lit = progress(frame, wordFrames[index] - 2, wordFrames[index] + 6);
            return (
              <span key={index} style={{display: "inline-block", marginRight: 14, color: lit > 0 ? cream : "#f2ede466", opacity: 0.45 + lit * 0.55, transform: `translateY(${(1 - lit) * 6}px)`}}>
                {index === 0 ? `«${word}` : word}{index === voiceWords.length - 1 ? "»" : ""}
              </span>
            );
          })}
        </div>
        <div style={{font: `600 22px ${SANS}`, color: sage, letterSpacing: 3, textTransform: "uppercase", marginTop: 26}}>
          {voice.stop.label} · {voice.stop.sources.length} {plural(voice.stop.sources.length, ["источник", "источника", "источников"])}: {voicePublishers.join(", ")}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────── Тезисы ───────────────────────── */

// Истории центра проверены автоматически (verification: automatic), поэтому
// ролик не обещает «проверенные факты», а говорит об источниках.
const centrePromises: readonly PromiseCard[] = [
  {text: ["Истории —", "на месте"], background: cream, color: green, accent: rust, icon: "pin"},
  {text: ["Факты —", "с источниками"], background: rust, color: cream, accent: peach, icon: "link"},
  {text: ["Слушайте", "на ходу"], background: green, color: cream, accent: peach, icon: "wave"},
];

function Trust({frame}: {frame: number}) {
  return <Promises frame={frame} items={centrePromises} />;
}

const scenes: Record<MotionSceneId, (props: {frame: number}) => ReactNode> = {
  echo: Echo,
  place: Place,
  route: Route,
  listen: Listen,
  trust: Trust,
  brand: Brand,
};

export function OtgolosokCentreVertical() {
  const frame = useCurrentFrame();
  const {id, localFrame, outgoing, transition} = getCentreVerticalFrameState(frame);
  const Current = scenes[id];
  const eased = swing(transition);
  const reveal = outgoing ? reveals[id](eased) : null;
  const listen = CENTRE_VERTICAL_SCENES.find((scene) => scene.id === "listen")!;
  const Outgoing = outgoing ? scenes[outgoing.id] : null;

  return (
    <AbsoluteFill style={{background: deep, fontFamily: SANS}}>
      {Outgoing && outgoing && (
        <AbsoluteFill style={{transform: `scale(${1 + eased * 0.08})`, filter: `brightness(${1 - eased * 0.4})`}}>
          <Outgoing frame={outgoing.localFrame} />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={reveal ?? undefined}>
        <Current frame={localFrame} />
      </AbsoluteFill>
      {outgoing && <CutBands t={transition} colors={id === "trust" ? [peach, rust] : undefined} />}
      <AbsoluteFill style={{background: "radial-gradient(circle at 50% 50%, transparent 60%, #00000055 100%)", pointerEvents: "none"}} />
      <Grain frame={frame} />
      <Html5Audio src={bed} volume={0.9} />
      <Sequence from={listen.start + voice.delay} durationInFrames={VOICE_FRAMES} name="Фрагмент истории">
        <Html5Audio
          src={story}
          trimBefore={Math.round(voice.fromSec * CENTRE_VERTICAL_FPS)}
          volume={(audioFrame) => Math.min(1, audioFrame / 6, (VOICE_FRAMES - audioFrame) / 10)}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
