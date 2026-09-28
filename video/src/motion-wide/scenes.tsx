import {AbsoluteFill, Easing, Img, interpolate, random, spring, staticFile, useCurrentFrame} from "remotion";
import route from "../../../public/data/routes/paveletskaya.json";
import {MAP_STOPS, pointOnRoute, routeProgressNear, ROUTE_LENGTH, ROUTE_PATH} from "../route-geometry";
import {WIDE_FPS, WIDE_LOCKUP_FRAME} from "../motion-wide-timeline";
import {C, clamp, easeBack, easeIn, easeInOut, easeOut, Kicker, Night, Paper, progress, Rings, SANS, SERIF, Sparks, Words} from "./fx";

// Все титры — из данных готового маршрута, чтобы ролик не расходился с продуктом.
// Остановки 1–3 лежат в notes, главная точка — в pois.
const stops = [
  ...route.notes.map(({story, place}) => ({title: story.opening, place})),
  ...route.pois.map(({story, name}) => ({title: story.opening.replace(/\.$/, ""), place: name})),
];
const firstStop = route.notes[0];
const firstSentence = firstStop.story.paragraphs[0].text.split(/(?<=[.!?])\s/)[0];
const checkedAt = firstStop.story.checked_at.split("-").reverse().join(".");
const SITE = "otgolosok.softmg.tech";

const pop = (frame: number, delay: number, damping = 12) =>
  spring({frame: frame - delay, fps: WIDE_FPS, config: {damping, stiffness: 160, mass: 0.7}});

/* ───────────────────────── 1. Хук ───────────────────────── */

function Ticker({y, direction}: {y: number; direction: 1 | -1}) {
  const frame = useCurrentFrame();
  const line = Array.from({length: 8}, () => stops.map(({place}) => place).join(" · ")).join(" · ");
  return (
    <div style={{position: "absolute", top: y, left: 0, whiteSpace: "nowrap", font: `600 24px ${SANS}`, letterSpacing: 5, textTransform: "uppercase", color: "rgba(245,178,150,0.24)", transform: `translateX(${-900 + direction * frame * 6}px)`}}>
      {line}
    </div>
  );
}

const FIRE_START = 44;
const FIRE_LEN = 15;

export function Hook() {
  const frame = useCurrentFrame();
  return (
    <Night glow={interpolate(frame, [0, 30], [0.3, 1], clamp)}>
      <Ticker y={90} direction={1} />
      <Ticker y={960} direction={-1} />
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontWeight: 600, fontSize: 150, letterSpacing: -4, lineHeight: 1}}>
        <Words text="Каждый день вы проходите" start={4} stagger={4} exit={36} />
        <Words text="мимо истории." start={14} stagger={5} exit={38} accent={["истории."]} accentItalic style={{marginTop: 10}} />
      </AbsoluteFill>
      {stops.slice(0, 3).map((stop, index) => {
        const from = FIRE_START + index * FIRE_LEN;
        const to = from + FIRE_LEN;
        if (frame < from - 2 || frame > to + 4) return null;
        return (
          <AbsoluteFill
            key={stop.title}
            style={{
              alignItems: "center",
              justifyContent: "center",
              gap: 26,
              opacity: interpolate(frame, [from, from + 4, to - 2, to + 2], [0, 1, 1, 0], clamp),
              transform: `scale(${interpolate(frame, [from, from + 10, to + 4], [1.3, 1, 0.9], {...clamp, easing: easeOut})})`,
              filter: `blur(${interpolate(frame, [from, from + 6, to - 2, to + 3], [18, 0, 0, 14], clamp)}px)`,
            }}
          >
            <div style={{font: `700 34px ${SANS}`, letterSpacing: 8, color: C.cinnabar}}>{String(index + 1).padStart(2, "0")} · {stop.place.toUpperCase()}</div>
            <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 150, letterSpacing: -4, lineHeight: 1}}>{stop.title}</div>
          </AbsoluteFill>
        );
      })}
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
        <Words text="Услышьте, что помнит город." start={92} stagger={3} accent={["помнит"]} accentItalic style={{fontFamily: SERIF, fontWeight: 600, fontSize: 150, letterSpacing: -4}} />
      </AbsoluteFill>
      <AbsoluteFill style={{background: C.rust, mixBlendMode: "screen", opacity: interpolate(frame, [FIRE_START, FIRE_START + 3, FIRE_START + 8], [0, 0.35, 0], clamp)}} />
    </Night>
  );
}

/* ───────────────────────── 2. Логотип ───────────────────────── */

const WORD = "Отголосок";

export function Logo() {
  const frame = useCurrentFrame();
  const slide = progress(frame, 28, 52, easeInOut);
  const dot = spring({frame: frame - 2, fps: WIDE_FPS, config: {damping: 10, stiffness: 150}});
  return (
    <Night grid={false}>
      <Rings at={4} />
      <Sparks at={6} seed="wide-logo" />
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
        <div style={{display: "flex", alignItems: "baseline", transform: `translateY(${interpolate(frame, [52, 96], [0, -40], clamp)}px)`}}>
          <div style={{display: "flex", overflow: "hidden", width: interpolate(slide, [0, 1], [0, 940]), fontFamily: SERIF, fontWeight: 600, fontSize: 230, letterSpacing: -6, lineHeight: 1.15, paddingBottom: 10}}>
            {Array.from(WORD).map((char, index) => (
              <span
                key={index}
                style={{
                  display: "inline-block",
                  transform: `translateY(${(1 - progress(frame, 34 + index * 2.5, 54 + index * 2.5)) * 120}%)`,
                  backgroundImage: `linear-gradient(100deg, ${C.ink} 40%, #ffffff 50%, ${C.ink} 60%)`,
                  backgroundSize: "400% 100%",
                  backgroundPosition: `${interpolate(frame, [62, 90], [100, 0], clamp) + index * 2}% 0`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {char}
              </span>
            ))}
          </div>
          {/* Терракотовая точка знака: сначала «звучит» одна, затем встаёт в конец слова. */}
          <div
            style={{
              width: interpolate(slide, [0, 1], [110, 44]),
              height: interpolate(slide, [0, 1], [110, 44]),
              marginLeft: interpolate(slide, [0, 1], [0, 8]),
              borderRadius: "50%",
              background: C.cinnabar,
              transform: `scale(${dot})`,
              boxShadow: `0 0 ${interpolate(slide, [0, 1], [120, 40])}px ${C.cinnabar}`,
            }}
          />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center", paddingTop: 340}}>
        <div style={{font: `600 44px ${SANS}`, color: C.muted, opacity: progress(frame, 58, 72), transform: `translateY(${(1 - progress(frame, 58, 76)) * 24}px)`}}>
          Аудиопрогулки по Москве
        </div>
      </AbsoluteFill>
    </Night>
  );
}

/* ───────────────────────── 3. Позиционирование ───────────────────────── */

const SLAM = 58;

function Orbit() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
      {Array.from({length: 30}, (_, index) => {
        const radius = 420 + random(`wide-orb-r-${index}`) * 280;
        const angle = random(`wide-orb-a-${index}`) * Math.PI * 2 + frame * (0.008 + random(`wide-orb-s-${index}`) * 0.012);
        const size = 3 + random(`wide-orb-z-${index}`) * 6;
        const depth = Math.sin(angle);
        const color = index % 4 === 0 ? C.teal : C.peach;
        return (
          <div key={index} style={{position: "absolute", width: size, height: size, borderRadius: "50%", background: color, boxShadow: `0 0 ${size * 3}px ${color}`, transform: `translate(${Math.cos(angle) * radius}px, ${depth * radius * 0.32}px) scale(${0.7 + (depth + 1) * 0.35})`, opacity: interpolate(frame, [10, 30], [0, 0.4 + (depth + 1) * 0.3], clamp)}} />
        );
      })}
    </AbsoluteFill>
  );
}

export function Claim() {
  const frame = useCurrentFrame();
  return (
    <Night>
      <Orbit />
      <Rings at={SLAM - 2} count={2} size={1700} />
      <Sparks at={SLAM - 2} seed="wide-claim" spread={1000} count={40} />
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontWeight: 600, lineHeight: 1, transform: `scale(${interpolate(frame, [0, 130], [1, 1.06])})`}}>
        <Words text="Город говорит" start={2} stagger={6} style={{fontSize: 170, letterSpacing: -5}} />
        <Words text="там, где случилась" start={14} stagger={5} style={{fontSize: 120, letterSpacing: -3, color: C.muted, marginTop: 16}} />
        <div
          style={{
            fontSize: 250,
            fontStyle: "italic",
            letterSpacing: -6,
            marginTop: 6,
            backgroundImage: `linear-gradient(170deg, #ffffff 5%, ${C.peach} 45%, ${C.cinnabar} 80%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            paddingBottom: 20,
            opacity: progress(frame, SLAM, SLAM + 5),
            transform: `scale(${interpolate(frame, [SLAM, SLAM + 12], [1.6, 1], {...clamp, easing: easeOut})})`,
            filter: `blur(${interpolate(frame, [SLAM, SLAM + 8], [16, 0], clamp)}px) drop-shadow(0 0 40px ${C.rust}aa)`,
          }}
        >
          история.
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: "#fff", opacity: interpolate(frame, [SLAM - 1, SLAM, SLAM + 6], [0, 0.35, 0], clamp)}} />
    </Night>
  );
}

/* ───────────────────────── 4. Три шага ───────────────────────── */

export const STEP_LEN = 62;

const steps = [
  {title: "Откройте карту", text: "Истории рядом с вами", image: "guide/home.png", path: "/"},
  {title: "Выберите прогулку", text: "Готовый маршрут или свой — по времени", image: "guide/route.png", path: "/walk"},
  {title: "Слушайте на месте", text: "История звучит рядом с местом событий", image: "guide/listen.png", path: "/walk"},
];

function Browser({image, path, site}: {image: string; path: string; site: string}) {
  return (
    <div style={{width: 1120, borderRadius: 22, overflow: "hidden", background: C.cream, border: "1px solid rgba(255,255,255,0.25)", boxShadow: `0 60px 140px rgba(0,0,0,0.65), 0 0 120px ${C.rust}55`}}>
      <div style={{height: 54, display: "flex", alignItems: "center", gap: 10, padding: "0 22px", background: "#efe9dd", borderBottom: "1px solid #e0d8c8"}}>
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => <div key={color} style={{width: 14, height: 14, borderRadius: "50%", background: color}} />)}
        <div style={{marginLeft: 24, flex: 1, height: 32, borderRadius: 8, background: C.cream, display: "flex", alignItems: "center", padding: "0 16px", font: `600 18px ${SANS}`, color: C.paperMuted}}>
          {site}{path}
        </div>
      </div>
      <Img src={staticFile(image)} style={{display: "block", width: 1120, height: 700, objectFit: "cover"}} />
    </div>
  );
}

export function Steps({site = SITE}: {site?: string} = {}) {
  const frame = useCurrentFrame();
  return (
    <Night>
      <AbsoluteFill style={{padding: "100px 0 0 120px"}}>
        <Kicker>Три шага</Kicker>
      </AbsoluteFill>
      <AbsoluteFill style={{perspective: 2200}}>
        {steps.map((step, index) => {
          const from = 12 + index * STEP_LEN;
          const enter = progress(frame, from - 10, from + 22);
          const leave = index === steps.length - 1 ? 0 : progress(frame, from + STEP_LEN - 10, from + STEP_LEN + 16, easeInOut);
          const float = Math.sin((frame + index * 20) / 22) * 10;
          const x = interpolate(enter, [0, 1], [700, 0]) + leave * 240;
          const y = interpolate(enter, [0, 1], [260, 0]) - leave * 220 + float;
          const z = interpolate(enter, [0, 1], [-200, 0]) - leave * 900;
          return (
            <div
              key={step.image}
              style={{
                position: "absolute",
                left: 800,
                top: 170,
                zIndex: 10 + index,
                opacity: interpolate(enter, [0, 0.3], [0, 1], clamp) * (1 - leave * 0.85),
                transform: `translate3d(${x}px, ${y}px, ${z}px) rotateY(${interpolate(enter, [0, 1], [-40, -16]) + leave * 22}deg) rotateX(${interpolate(enter, [0, 1], [18, 6])}deg)`,
                filter: `blur(${leave * 8}px)`,
              }}
            >
              <Browser image={step.image} path={step.path} site={site} />
            </div>
          );
        })}
      </AbsoluteFill>
      {steps.map((step, index) => {
        const from = 12 + index * STEP_LEN;
        const last = index === steps.length - 1;
        return (
          <AbsoluteFill key={step.title} style={{padding: "0 0 0 120px", justifyContent: "center", zIndex: 50}}>
            <div style={{opacity: last ? 1 : interpolate(frame, [from + STEP_LEN - 6, from + STEP_LEN], [1, 0], clamp)}}>
              <div style={{font: `700 190px ${SANS}`, letterSpacing: -8, lineHeight: 1, color: "transparent", WebkitTextStroke: `2px ${C.cinnabar}`, opacity: progress(frame, from, from + 10), transform: `translateX(${(1 - progress(frame, from, from + 20)) * -60}px)`}}>
                0{index + 1}
              </div>
              <Words text={step.title} start={from + 4} stagger={4} style={{fontFamily: SERIF, fontWeight: 600, fontSize: 84, letterSpacing: -2, marginTop: 18, maxWidth: 620, lineHeight: 1}} />
              <div style={{font: `600 32px ${SANS}`, color: C.muted, marginTop: 22, maxWidth: 560, lineHeight: 1.35, opacity: progress(frame, from + 12, from + 24)}}>{step.text}</div>
            </div>
          </AbsoluteFill>
        );
      })}
      <div style={{position: "absolute", left: 120, bottom: 110, width: 560, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)"}}>
        <div style={{height: "100%", borderRadius: 2, width: `${progress(frame, 12, 12 + STEP_LEN * 3, Easing.linear) * 100}%`, background: `linear-gradient(90deg, ${C.rust}, ${C.peach})`, boxShadow: `0 0 16px ${C.cinnabar}`}} />
      </div>
    </Night>
  );
}

/* ───────────────────────── 5. Маршрут ───────────────────────── */

const DRAW_FROM = 22;
const DRAW_TO = 112;
const stopProgress = MAP_STOPS.map(routeProgressNear);
const reachedAt = (index: number) => DRAW_FROM + stopProgress[index] * (DRAW_TO - DRAW_FROM);
// Подложка увеличена на область маршрута, как в вертикальном ролике.
const MAP_ZOOM = {transform: "scale(1.45) translate(4%, 3%)", transformOrigin: "30% 45%"} as const;

function Counter({value, at, label}: {value: number; at: number; label: string}) {
  const frame = useCurrentFrame();
  const shown = progress(frame, at, at + 16);
  return (
    <div style={{opacity: shown, transform: `translateY(${(1 - shown) * 30}px)`}}>
      <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 112, lineHeight: 1, fontVariantNumeric: "lining-nums tabular-nums"}}>{Math.round(value * progress(frame, at, at + 40, Easing.out(Easing.cubic)))}</div>
      <div style={{font: `600 26px ${SANS}`, color: C.teal, marginTop: 6}}>{label}</div>
    </div>
  );
}

export function RouteMap() {
  const frame = useCurrentFrame();
  const drawn = progress(frame, DRAW_FROM, DRAW_TO, easeInOut);
  const head = pointOnRoute(drawn);
  const tilt = interpolate(frame, [0, 60, 160], [62, 30, 24], {...clamp, easing: easeOut});
  const turn = interpolate(frame, [0, 160], [-26, -10], clamp);
  return (
    <Night grid={false}>
      <div style={{position: "absolute", left: 120, top: 100}}>
        <Kicker>Маршрут · {route.title}</Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 124, lineHeight: 0.98, letterSpacing: -3, marginTop: 30}}>
          <Words text="От истории" start={4} stagger={5} />
          <Words text="к истории" start={12} stagger={5} accent={["истории"]} accentItalic />
        </div>
        <div style={{marginTop: 34, display: "flex", flexDirection: "column", gap: 12}}>
          {stops.map((stop, index) => {
            const shown = pop(frame, reachedAt(index), 14);
            return (
              <div key={stop.title} style={{display: "flex", alignItems: "center", gap: 16, transform: `translateX(${(1 - shown) * -80}px)`, opacity: Math.min(1, shown * 1.5)}}>
                <div style={{width: 40, height: 40, borderRadius: "50%", background: C.rust, border: `2px solid ${C.cream}`, display: "flex", alignItems: "center", justifyContent: "center", font: `700 20px ${SANS}`}}>{index + 1}</div>
                <div style={{font: `600 30px ${SANS}`}}>{stop.title}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{position: "absolute", left: 120, bottom: 90, display: "flex", gap: 90}}>
        <Counter value={stops.length} at={64} label="истории" />
        <Counter value={route.walk.distance_m} at={72} label="метра пути" />
        <Counter value={route.duration_min} at={80} label="минут" />
      </div>
      <div style={{position: "absolute", left: 1060, top: 150, width: 780, height: 780, perspective: 2000}}>
        <div style={{width: "100%", height: "100%", transform: `translateY(${interpolate(frame, [0, 50], [300, 0], {...clamp, easing: easeOut})}px) rotateX(${tilt}deg) rotateZ(${turn}deg)`, transformStyle: "preserve-3d", borderRadius: 40, overflow: "hidden", background: C.paper, boxShadow: `0 80px 140px #000a, 0 0 0 10px #fffefa1a, 0 0 160px ${C.rust}44`}}>
          <Img src={staticFile("motion/map-base.svg")} style={{width: "100%", height: "100%", ...MAP_ZOOM}} />
          <svg viewBox="0 0 400 400" style={{position: "absolute", inset: 0, width: "100%", height: "100%", ...MAP_ZOOM}} aria-hidden="true">
            <path d={ROUTE_PATH} fill="none" stroke={C.cream} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${ROUTE_LENGTH} ${ROUTE_LENGTH}`} strokeDashoffset={ROUTE_LENGTH * (1 - drawn)} />
            <path d={ROUTE_PATH} fill="none" stroke={C.rust} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${ROUTE_LENGTH} ${ROUTE_LENGTH}`} strokeDashoffset={ROUTE_LENGTH * (1 - drawn)} />
            {MAP_STOPS.map((stop, index) => {
              const shown = pop(frame, reachedAt(index), 8);
              const ring = progress(frame, reachedAt(index), reachedAt(index) + 30, Easing.out(Easing.cubic));
              return (
                <g key={index} transform={`translate(${stop.x} ${stop.y})`}>
                  {ring > 0 && ring < 1 && <circle r={10 + ring * 34} fill="none" stroke={C.rust} strokeWidth={2} opacity={1 - ring} />}
                  <g transform={`scale(${shown})`}>
                    <circle r={12} fill={C.rust} stroke={C.cream} strokeWidth={3} />
                    <text y={4.2} textAnchor="middle" fill={C.cream} style={{font: `700 12px ${SANS}`}}>{index + 1}</text>
                  </g>
                </g>
              );
            })}
            {drawn > 0 && drawn < 1 && <circle cx={head.x} cy={head.y} r={6} fill={C.peach} stroke={C.cream} strokeWidth={2.5} />}
          </svg>
          <div style={{position: "absolute", right: 16, bottom: 12, background: "#f5f1e8e6", color: C.paperMuted, font: `600 16px ${SANS}`, padding: "4px 8px", borderRadius: 6}}>© OpenStreetMap contributors</div>
        </div>
      </div>
    </Night>
  );
}

/* ───────────────────────── 6. Проверенные факты ───────────────────────── */

export function Facts() {
  const frame = useCurrentFrame();
  const words = firstSentence.split(" ");
  return (
    <Paper>
      <AbsoluteFill style={{padding: "0 0 0 120px", justifyContent: "center"}}>
        <Kicker dark={false}>Факты с источниками</Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 132, lineHeight: 0.98, letterSpacing: -3, marginTop: 36}}>
          <Words text="Каждый факт" start={4} stagger={5} />
          <Words text="можно проверить." start={12} stagger={5} accent={["проверить."]} accentColor={C.rust} accentItalic />
        </div>
        <div style={{font: `600 34px ${SANS}`, color: C.paperMuted, marginTop: 40, maxWidth: 760, lineHeight: 1.4, opacity: progress(frame, 30, 44)}}>
          Источники раскрываются рядом с историей и не мешают слушать.
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 130,
          width: 720,
          padding: "40px 46px 34px",
          borderRadius: 32,
          background: C.cream,
          border: `1px solid ${C.paperLine}`,
          boxShadow: `0 50px 120px rgba(58,42,26,0.16), 0 0 0 10px ${C.rust}0f`,
          opacity: progress(frame, 8, 20),
          transform: `translateY(${(1 - progress(frame, 8, 34, easeBack)) * 120}px) rotate(${(1 - progress(frame, 8, 34)) * 6}deg)`,
        }}
      >
        <div style={{font: `600 22px ${SANS}`, color: C.paperMuted}}>Остановка 1 из {stops.length}</div>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 56, lineHeight: 1.05, marginTop: 8, color: C.green}}>{firstStop.story.opening}</div>
        <div style={{font: `400 28px ${SANS}`, color: C.paperInk, lineHeight: 1.5, marginTop: 18}}>
          {words.map((word, index) => {
            const shown = progress(frame, 24 + index * 3, 36 + index * 3);
            return <span key={index} style={{opacity: 0.15 + shown * 0.85}}>{word} </span>;
          })}
        </div>
        <div style={{height: 1, background: C.paperLine, margin: "26px 0 20px"}} />
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
          <div style={{font: `700 20px ${SANS}`, letterSpacing: 3, textTransform: "uppercase", color: C.rust}}>Источники</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              borderRadius: 999,
              background: "#1f6f6b14",
              color: "#1f6f6b",
              font: `700 20px ${SANS}`,
              transform: `scale(${pop(frame, 88, 10)})`,
            }}
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12.5 9.5 18 20 6" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - progress(frame, 92, 104)} />
            </svg>
            проверено {checkedAt}
          </div>
        </div>
        {firstStop.sources.map((source, index) => {
          const at = 60 + index * 10;
          const shown = progress(frame, at, at + 18);
          return (
            <div key={source.id} style={{display: "flex", gap: 14, alignItems: "flex-start", marginTop: 16, opacity: shown, transform: `translateX(${(1 - shown) * 60}px)`}}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.rust} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink: 0, marginTop: 3}} aria-hidden="true">
                <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
              </svg>
              <div style={{font: `600 24px ${SANS}`, color: C.paperInk, lineHeight: 1.35}}>{source.title}</div>
            </div>
          );
        })}
      </div>
    </Paper>
  );
}

/* ───────────────────────── 7. Финал ───────────────────────── */

const LOCKUP = WIDE_LOCKUP_FRAME;

export function Outro({site = SITE}: {site?: string} = {}) {
  const frame = useCurrentFrame();
  const grow = progress(frame, 0, LOCKUP, easeIn);
  return (
    <Night glow={interpolate(frame, [LOCKUP - 6, LOCKUP + 10], [0.6, 1.1], clamp)}>
      {/* До сборки: точка-источник звука и расходящиеся волны. */}
      {frame < LOCKUP + 4 && (
        <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
          {Array.from({length: 5}, (_, index) => {
            const life = progress(frame, index * 9, index * 9 + 40, Easing.out(Easing.cubic));
            if (life <= 0 || life >= 1) return null;
            return <div key={index} style={{position: "absolute", width: 1200 * life, height: 1200 * life, borderRadius: "50%", border: `2px solid ${C.peach}`, opacity: 1 - life}} />;
          })}
          <div style={{width: 60 + grow * 260, height: 60 + grow * 260, borderRadius: "50%", background: C.cinnabar, boxShadow: `0 0 ${80 + grow * 200}px ${C.cinnabar}`, opacity: interpolate(frame, [LOCKUP - 2, LOCKUP + 4], [1, 0], clamp)}} />
        </AbsoluteFill>
      )}
      <Rings at={LOCKUP} count={3} />
      <Sparks at={LOCKUP} count={50} spread={1100} seed="wide-outro" />
      <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}>
        <div style={{display: "flex", alignItems: "baseline", fontFamily: SERIF, fontWeight: 600, fontSize: 110, letterSpacing: -3, opacity: progress(frame, LOCKUP, LOCKUP + 8), transform: `scale(${interpolate(frame, [LOCKUP, LOCKUP + 18], [0.6, 1], {...clamp, easing: easeBack})})`}}>
          Отголосок<span style={{color: C.cinnabar}}>.</span>
        </div>
        <div
          style={{
            marginTop: 20,
            font: `700 128px ${SANS}`,
            lineHeight: 1.1,
            letterSpacing: interpolate(frame, [LOCKUP + 8, LOCKUP + 40], [8, -5], {...clamp, easing: easeOut}),
            backgroundImage: `linear-gradient(100deg, ${C.ink} 0%, ${C.peach} 40%, ${C.cinnabar} 70%, ${C.ink} 100%)`,
            backgroundSize: "200% 100%",
            backgroundPosition: `${interpolate(frame, [LOCKUP, 150], [0, 100], clamp)}% 0`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            opacity: progress(frame, LOCKUP + 8, LOCKUP + 18),
            filter: `blur(${interpolate(frame, [LOCKUP + 8, LOCKUP + 20], [20, 0], clamp)}px)`,
          }}
        >
          {site}
        </div>
        <div style={{marginTop: 24, fontFamily: SERIF, fontStyle: "italic", fontWeight: 600, fontSize: 56, color: C.muted, opacity: progress(frame, LOCKUP + 24, LOCKUP + 36)}}>
          Город говорит там, где случилась <span style={{color: C.peach}}>история</span>
        </div>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            marginTop: 50,
            padding: "26px 56px",
            borderRadius: 999,
            background: C.rust,
            color: C.cream,
            font: `700 40px ${SANS}`,
            boxShadow: `0 0 70px ${C.rust}aa`,
            opacity: progress(frame, LOCKUP + 34, LOCKUP + 44),
            transform: `translateY(${(1 - progress(frame, LOCKUP + 34, LOCKUP + 52, easeBack)) * 40}px)`,
          }}
        >
          Начать прогулку →
          <div style={{position: "absolute", top: 0, bottom: 0, width: 120, left: interpolate(frame, [LOCKUP + 60, LOCKUP + 80], [-160, 560], clamp), background: "linear-gradient(100deg, transparent, rgba(255,254,250,0.45), transparent)", transform: "skewX(-20deg)"}} />
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{background: "#fff", opacity: interpolate(frame, [LOCKUP - 2, LOCKUP, LOCKUP + 8], [0, 0.5, 0], clamp)}} />
      <AbsoluteFill style={{background: "#000", opacity: progress(frame, 140, 150)}} />
    </Night>
  );
}
