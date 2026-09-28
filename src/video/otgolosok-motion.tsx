import type {CSSProperties, ReactNode} from "react";
import {
  AbsoluteFill,
  Easing,
  Html5Audio,
  Img,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import route from "../../public/data/routes/paveletskaya.json";
import {SANS, SERIF} from "./guide-fonts";
import {MOTION_FPS, MOTION_SCENES, getMotionFrameState, type MotionSceneId} from "./motion-timeline";
import {MAP_STOPS, pointOnRoute, routeProgressNear, ROUTE_LENGTH, ROUTE_PATH} from "./route-geometry";

const green = "#203e38";
const deep = "#0d1714";
const cream = "#fffefa";
const paper = "#f5f1e8";
const ink = "#1a1714";
const rust = "#b64b28";
const peach = "#f5b296";
const sage = "#9fbfb1";

const facade = staticFile("video/brick-facade.webp");
const city = staticFile("video/moscow-evening.webp");
const mapBase = staticFile("motion/map-base.svg");
const listenScreen = staticFile("guide/listen.png");
const story = staticFile("audio/walk/kozhevniki-d2ccb2df8e45.mp3");

const expo = Easing.bezier(0.16, 1, 0.3, 1);
const swing = Easing.bezier(0.65, 0, 0.35, 1);

function progress(frame: number, from: number, to: number, easing = expo) {
  return interpolate(frame, [from, to], [0, 1], {easing, extrapolateLeft: "clamp", extrapolateRight: "clamp"});
}

function pop(frame: number, delay: number, damping = 11) {
  return spring({frame: frame - delay, fps: MOTION_FPS, config: {damping, stiffness: 170, mass: 0.7}});
}

/** Буквы выезжают из-под маски строки по одной. */
function Chars({text, frame, at, step = 1.6, style}: {text: string; frame: number; at: number; step?: number; style?: CSSProperties}) {
  return (
    <span style={{display: "inline-flex", overflow: "hidden", paddingBottom: "0.12em", marginBottom: "-0.12em", ...style}}>
      {Array.from(text).map((char, index) => {
        const shown = progress(frame, at + index * step, at + index * step + 18);
        return (
          <span key={index} style={{display: "inline-block", whiteSpace: "pre", transform: `translateY(${(1 - shown) * 105}%) rotate(${(1 - shown) * 12}deg)`, transformOrigin: "0 100%"}}>
            {char}
          </span>
        );
      })}
    </span>
  );
}

/** Круги расходятся от точки — визуальный «отголосок». */
function Ripples({x, y, frame, from, every, count, size, color, width = 3}: {
  x: number; y: number; frame: number; from: number; every: number; count: number; size: number; color: string; width?: number;
}) {
  return (
    <>
      {Array.from({length: count}, (_, index) => {
        const life = progress(frame, from + index * every, from + index * every + 70, Easing.out(Easing.cubic));
        if (life <= 0 || life >= 1) return null;
        const diameter = size * life;
        return (
          <div key={index} style={{position: "absolute", left: x - diameter / 2, top: y - diameter / 2, width: diameter, height: diameter, borderRadius: "50%", border: `${width}px solid ${color}`, opacity: (1 - life) * 0.9}} />
        );
      })}
    </>
  );
}

function Kicker({children, color, style}: {children: ReactNode; color: string; style?: CSSProperties}) {
  return <div style={{font: `700 26px ${SANS}`, letterSpacing: 6, textTransform: "uppercase", color, ...style}}>{children}</div>;
}

function Echo({frame}: {frame: number}) {
  const dot = pop(frame, 2, 9);
  const lift = progress(frame, 70, 120, swing);
  const spin = frame * 0.9;
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 36%, #1d3530 0%, ${deep} 62%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff14" />
      <div style={{position: "absolute", inset: 0, transform: `translateY(${-lift * 90}px)`}}>
        <Ripples x={540} y={700} frame={frame} from={4} every={13} count={9} size={1500} color={peach} width={2} />
        <svg width={1080} height={1400} style={{position: "absolute", inset: 0}} aria-hidden="true">
          <circle cx={540} cy={700} r={170} fill="none" stroke={sage} strokeWidth={2} strokeDasharray="2 14" strokeLinecap="round" transform={`rotate(${spin} 540 700)`} opacity={dot} />
          <circle cx={540} cy={700} r={250} fill="none" stroke="#ffffff30" strokeWidth={1.5} strokeDasharray="60 18" transform={`rotate(${-spin * 0.6} 540 700)`} opacity={dot} />
        </svg>
        <div style={{position: "absolute", left: 540 - 46, top: 700 - 46, width: 92, height: 92, borderRadius: "50%", background: rust, transform: `scale(${dot})`, boxShadow: `0 0 80px ${rust}`}} />
      </div>
      <div style={{position: "absolute", left: 90, top: 110, right: 90, display: "flex", justifyContent: "space-between", opacity: progress(frame, 6, 26)}}>
        <Kicker color="#ffffffb0">Отголосок</Kicker>
        <Kicker color="#ffffffb0">Москва</Kicker>
      </div>
      <div style={{position: "absolute", left: 90, top: 1130 - lift * 70, fontFamily: SERIF, fontWeight: 600, fontSize: 196, lineHeight: 0.92, letterSpacing: -6}}>
        <div><Chars text="У города" frame={frame} at={14} /></div>
        <div><Chars text="есть" frame={frame} at={28} /></div>
        <div style={{color: peach, fontStyle: "italic"}}><Chars text="голос." frame={frame} at={40} /></div>
      </div>
    </AbsoluteFill>
  );
}

function DotGrid({frame, color}: {frame: number; color: string}) {
  return (
    <AbsoluteFill style={{backgroundImage: `radial-gradient(${color} 2px, transparent 2.5px)`, backgroundSize: "54px 54px", backgroundPosition: `0 ${-frame * 0.6}px`}} />
  );
}

/** Круговая надпись, медленно вращается вокруг центра. */
function Badge({text, frame, size, color, delay}: {text: string; frame: number; size: number; color: string; delay: number}) {
  const shown = pop(frame, delay, 14);
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{transform: `scale(${shown}) rotate(${frame * 0.8 - 40 * (1 - shown)}deg)`}} aria-hidden="true">
      <defs><path id="badge-circle" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0" /></defs>
      <circle cx={100} cy={100} r={98} fill={rust} />
      <text fill={color} style={{font: `700 17.5px ${SANS}`, letterSpacing: 3.2}}>
        <textPath href="#badge-circle">{text}</textPath>
      </text>
      <circle cx={100} cy={100} r={9} fill={color} />
      <circle cx={100} cy={100} r={22} fill="none" stroke={color} strokeWidth={3} opacity={0.7} />
      <circle cx={100} cy={100} r={36} fill="none" stroke={color} strokeWidth={2} opacity={0.4} />
    </svg>
  );
}

// Остановки маршрута: заметки и главная точка.
const stopCount = route.notes.length + route.pois.length;
// Вопросы, на которые отвечают истории прогулки, — без привязки к конкретному маршруту.
const placeQuestions = ["Что здесь было раньше", "Кто здесь жил", "Почему такое название"];
// Озвучка kozhevniki-*.mp3 — история первой остановки, она же на снимке listen.png.
const firstStop = route.notes[0].story;
const firstSentence = firstStop.paragraphs[0].text.split(/(?<=[.!?])\s/)[0];

function Place({frame}: {frame: number}) {
  const open = progress(frame, 2, 34);
  const zoom = interpolate(frame, [0, 150], [1.35, 1.06], {easing: Easing.out(Easing.quad), extrapolateRight: "clamp"});
  const archTop = 400;
  const archHeight = 1080;
  const chipSlots = [
    {left: 36, top: 1090, rotate: -5},
    {left: 520, top: 1250, rotate: 4},
    {left: 70, top: 1400, rotate: 3},
  ];
  return (
    <AbsoluteFill style={{background: paper, color: ink, overflow: "hidden"}}>
      <div style={{position: "absolute", left: -40, top: 1560, whiteSpace: "nowrap", font: `600 300px ${SERIF}`, color: "#e8dfcf", transform: `translateX(${-frame * 3}px)`}}>
        история · история · история
      </div>
      <div style={{position: "absolute", left: 160, top: archTop, width: 760, height: archHeight, borderRadius: "380px 380px 36px 36px", overflow: "hidden", clipPath: `inset(${(1 - open) * 100}% 0 0 0 round 380px 380px 36px 36px)`, boxShadow: "0 50px 120px #3a2a1a40"}}>
        <Img src={facade} style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`}} />
        <AbsoluteFill style={{background: "linear-gradient(180deg, transparent 55%, #1a1714aa 100%)"}} />
      </div>
      <div style={{position: "absolute", left: 160, top: archTop, width: 760, height: archHeight, borderRadius: "380px 380px 36px 36px", border: `3px solid ${rust}`, transform: `translate(${22 * open}px, ${22 * open}px)`, opacity: open * 0.8}} />
      <div style={{position: "absolute", left: 80, top: 130, fontFamily: SERIF, fontWeight: 600, fontSize: 132, lineHeight: 0.95, letterSpacing: -3}}>
        <div><Chars text="У каждого дома —" frame={frame} at={8} step={1.1} /></div>
        <div style={{color: rust, fontStyle: "italic"}}><Chars text="своя история" frame={frame} at={22} step={1.3} /></div>
      </div>
      {placeQuestions.map((title, index) => {
        const shown = pop(frame, 40 + index * 10, 12);
        const slot = chipSlots[index];
        const float = Math.sin((frame + index * 20) / 18) * 8;
        return (
          <div key={title} style={{position: "absolute", left: slot.left, top: slot.top + float, transform: `scale(${shown}) rotate(${slot.rotate}deg)`, transformOrigin: "left center", background: index === 1 ? green : cream, color: index === 1 ? cream : green, borderRadius: 999, padding: "22px 34px", boxShadow: "0 18px 50px #2a1d1030", display: "flex", alignItems: "baseline"}}>
            <span style={{font: `700 32px ${SANS}`}}>{title}<span style={{color: index === 1 ? peach : rust}}>?</span></span>
          </div>
        );
      })}
      <div style={{position: "absolute", right: 70, top: 330}}>
        <Badge text="ИСТОРИИ РЯДОМ • ИСТОРИИ РЯДОМ • " frame={frame} size={230} color={cream} delay={30} />
      </div>
    </AbsoluteFill>
  );
}

const stopProgress = MAP_STOPS.map(routeProgressNear);

function Counter({value, frame, at, label}: {value: number; frame: number; at: number; label: string}) {
  const count = value * progress(frame, at, at + 40, Easing.out(Easing.cubic));
  const shown = progress(frame, at, at + 16);
  return (
    <div style={{opacity: shown, transform: `translateY(${(1 - shown) * 40}px)`}}>
      <div style={{font: `600 118px ${SERIF}`, lineHeight: 1, fontVariantNumeric: "tabular-nums"}}>{Math.round(count)}</div>
      <div style={{font: `600 26px ${SANS}`, color: sage, marginTop: 8}}>{label}</div>
    </div>
  );
}

function Route({frame}: {frame: number}) {
  const drawn = progress(frame, 34, 150, swing);
  const head = pointOnRoute(drawn);
  const tilt = interpolate(frame, [0, 60, 210], [62, 26, 18], {easing: expo, extrapolateRight: "clamp"});
  const turn = interpolate(frame, [0, 210], [-24, -6], {easing: Easing.out(Easing.quad), extrapolateRight: "clamp"});
  const lift = interpolate(frame, [0, 60], [260, 0], {easing: expo, extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 55%, #2c5249 0%, ${green} 45%, #152a25 100%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff10" />
      <div style={{position: "absolute", left: 80, top: 120}}>
        <Kicker color={peach}><Chars text="Маршрут" frame={frame} at={4} /></Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 124, lineHeight: 0.95, letterSpacing: -3, marginTop: 24}}>
          <div><Chars text="Идите от истории" frame={frame} at={8} step={1.1} /></div>
          <div style={{color: peach, fontStyle: "italic"}}><Chars text="к истории" frame={frame} at={20} step={1.3} /></div>
        </div>
      </div>
      <div style={{position: "absolute", left: 90, top: 560, width: 900, height: 900, perspective: 2200}}>
        <div style={{width: "100%", height: "100%", transform: `translateY(${lift}px) rotateX(${tilt}deg) rotateZ(${turn}deg)`, transformStyle: "preserve-3d", borderRadius: 40, overflow: "hidden", background: paper, boxShadow: "0 80px 140px #0009, 0 0 0 10px #fffefa22"}}>
          <Img src={mapBase} style={{width: "100%", height: "100%", transform: "scale(1.45) translate(4%, 3%)", transformOrigin: "30% 45%"}} />
          <svg viewBox="0 0 400 400" style={{position: "absolute", inset: 0, width: "100%", height: "100%", transform: "scale(1.45) translate(4%, 3%)", transformOrigin: "30% 45%"}} aria-hidden="true">
            <path d={ROUTE_PATH} fill="none" stroke={cream} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${ROUTE_LENGTH} ${ROUTE_LENGTH}`} strokeDashoffset={ROUTE_LENGTH * (1 - drawn)} />
            <path d={ROUTE_PATH} fill="none" stroke={rust} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${ROUTE_LENGTH} ${ROUTE_LENGTH}`} strokeDashoffset={ROUTE_LENGTH * (1 - drawn)} />
            {MAP_STOPS.map((stop, index) => {
              const reachedAt = 34 + stopProgress[index] * 116;
              const shown = pop(frame, reachedAt, 8);
              const ring = progress(frame, reachedAt, reachedAt + 30, Easing.out(Easing.cubic));
              return (
                <g key={index} transform={`translate(${stop.x} ${stop.y})`}>
                  {ring > 0 && ring < 1 && <circle r={10 + ring * 30} fill="none" stroke={rust} strokeWidth={2} opacity={1 - ring} />}
                  <g transform={`scale(${shown})`}>
                    <circle r={12} fill={rust} stroke={cream} strokeWidth={3} />
                    <text y={4.2} textAnchor="middle" fill={cream} style={{font: `700 12px ${SANS}`}}>{index + 1}</text>
                  </g>
                </g>
              );
            })}
            {drawn > 0 && drawn < 1 && <circle cx={head.x} cy={head.y} r={6} fill={peach} stroke={cream} strokeWidth={2.5} />}
          </svg>
          <div style={{position: "absolute", right: 18, bottom: 14, background: "#f5f1e8e6", color: "#57504a", font: `600 17px ${SANS}`, padding: "4px 8px", borderRadius: 6}}>© OpenStreetMap contributors</div>
        </div>
      </div>
      <div style={{position: "absolute", left: 80, right: 80, bottom: 130, display: "flex", justifyContent: "space-between"}}>
        <Counter value={stopCount} frame={frame} at={60} label="истории" />
        <Counter value={route.walk.distance_m} frame={frame} at={72} label="метра пути" />
        <Counter value={route.duration_min} frame={frame} at={84} label="минут прогулки" />
      </div>
    </AbsoluteFill>
  );
}

// Панель прослушивания на снимке listen.png (2560×1600), в пикселях снимка.
const PANEL = {x: 860, y: 700, width: 840, height: 680};
// Полоса панели со служебным «Геопозиция недоступна…» (снимок сделан без GPS):
// в рекламе её вырезаем, а части выше и ниже ставим стык в стык.
const PANEL_CUT = {from: 325, to: 435};
const PANEL_SLICES = [
  {from: 0, to: PANEL_CUT.from},
  {from: PANEL_CUT.to, to: PANEL.height},
];
const PANEL_VISIBLE_HEIGHT = PANEL.height - (PANEL_CUT.to - PANEL_CUT.from);

function Waveform({frame, radius, bars}: {frame: number; radius: number; bars: number}) {
  return (
    <svg width={radius * 2 + 260} height={radius * 2 + 260} viewBox={`${-radius - 130} ${-radius - 130} ${radius * 2 + 260} ${radius * 2 + 260}`} aria-hidden="true">
      {Array.from({length: bars}, (_, index) => {
        const angle = (index / bars) * Math.PI * 2;
        const level = 0.25 + 0.75 * Math.abs(Math.sin(index * 0.9 + frame * 0.21) * Math.cos(index * 0.37 - frame * 0.13));
        const jitter = random(`bar-${index}-${Math.floor(frame / 3)}`) * 0.25;
        const length = 16 + (level + jitter) * 100;
        const x1 = Math.cos(angle) * radius;
        const y1 = Math.sin(angle) * radius;
        return <line key={index} x1={x1} y1={y1} x2={Math.cos(angle) * (radius + length)} y2={Math.sin(angle) * (radius + length)} stroke={index % 3 === 0 ? peach : "#9fbfb188"} strokeWidth={7} strokeLinecap="round" />;
      })}
    </svg>
  );
}

function Listen({frame}: {frame: number}) {
  const card = pop(frame, 12, 13);
  const sway = Math.sin(frame / 38) * 6;
  const scale = 1040 / PANEL.width;
  const words = firstSentence.split(" ");
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
      <div style={{position: "absolute", left: 540, top: 1010, transform: "translate(-50%, -50%)", opacity: progress(frame, 10, 40)}}>
        <Waveform frame={frame} radius={330} bars={72} />
      </div>
      <div style={{position: "absolute", left: 20, top: 700, width: 1040, height: PANEL_VISIBLE_HEIGHT * scale, perspective: 1800}}>
        <div style={{width: "100%", height: "100%", borderRadius: 48, overflow: "hidden", transform: `translateY(${(1 - card) * 500}px) rotateY(${sway}deg) rotateX(${(1 - card) * 30 + 4}deg)`, boxShadow: "0 60px 140px #000c", background: "#fdf8ee"}}>
          {PANEL_SLICES.map((slice, index) => (
            <div key={slice.from} style={{position: "absolute", left: 0, right: 0, top: (index === 0 ? 0 : PANEL_SLICES[0].to) * scale, height: (slice.to - slice.from) * scale, overflow: "hidden"}}>
              <Img src={listenScreen} style={{position: "absolute", width: 2560 * scale, height: 1600 * scale, left: -PANEL.x * scale, top: -(PANEL.y + slice.from) * scale, maxWidth: "none"}} />
            </div>
          ))}
        </div>
      </div>
      <div style={{position: "absolute", left: 80, right: 80, bottom: 150, textAlign: "center", fontFamily: SERIF, fontStyle: "italic", fontSize: 64, lineHeight: 1.15, color: "#f2ede4"}}>
        {words.map((word, index) => {
          const shown = progress(frame, 60 + index * 6, 80 + index * 6);
          return <span key={index} style={{display: "inline-block", marginRight: 16, opacity: shown, filter: `blur(${(1 - shown) * 12}px)`, transform: `translateY(${(1 - shown) * 20}px)`}}>{index === 0 ? `«${word}` : word}{index === words.length - 1 ? "»" : ""}</span>;
        })}
        <div style={{font: `600 24px ${SANS}`, fontStyle: "normal", color: sage, letterSpacing: 4, textTransform: "uppercase", marginTop: 28, opacity: progress(frame, 110, 130)}}>{firstStop.opening}</div>
      </div>
    </AbsoluteFill>
  );
}

const promises = [
  {text: ["Проверенные", "факты"], background: cream, color: green, accent: rust, icon: "check"},
  {text: ["Источники —", "рядом"], background: rust, color: cream, accent: peach, icon: "link"},
  {text: ["Слушайте", "на ходу"], background: green, color: cream, accent: peach, icon: "pin"},
] as const;

function Icon({kind, color, draw}: {kind: (typeof promises)[number]["icon"]; color: string; draw: number}) {
  const paths = {
    check: "M30 82 L68 118 L140 40",
    link: "M60 120 L130 50 M80 48 L132 48 L132 100",
    pin: "M85 150 C85 150 35 98 35 68 A50 50 0 0 1 135 68 C135 98 85 150 85 150 Z M85 50 A18 18 0 1 0 85.1 50",
  };
  return (
    <svg width={170} height={170} viewBox="0 0 170 170" aria-hidden="true">
      <path d={paths[kind]} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
    </svg>
  );
}

function Trust({frame}: {frame: number}) {
  const index = Math.min(promises.length - 1, Math.floor(frame / 30));
  const local = frame - index * 30;
  const item = promises[index];
  const slam = spring({frame: local, fps: MOTION_FPS, config: {damping: 12, stiffness: 260, mass: 0.6}});
  const shake = local < 8 ? (random(`shake-${frame}`) - 0.5) * 14 * (1 - local / 8) : 0;
  return (
    <AbsoluteFill style={{background: item.background, color: item.color, overflow: "hidden"}}>
      <div style={{position: "absolute", left: -200, right: -200, top: 860, height: 200, background: item.accent, opacity: 0.18, transform: `rotate(-8deg) translateX(${(1 - progress(local, 0, 20)) * -1400}px)`}} />
      <div style={{position: "absolute", left: 80, top: 460, transform: `translate(${shake}px, ${shake}px)`}}>
        <div style={{transform: `scale(${0.6 + slam * 0.4})`, transformOrigin: "left center", opacity: Math.min(1, slam * 2)}}>
          <Icon kind={item.icon} color={item.accent} draw={progress(local, 4, 22)} />
        </div>
        <div style={{marginTop: 50, font: `700 138px ${SANS}`, lineHeight: 1.02, letterSpacing: -4 + (1 - slam) * 20}}>
          {item.text.map((line, lineIndex) => (
            <div key={line} style={{transform: `translateX(${(1 - pop(local, lineIndex * 3, 14)) * 700 * (lineIndex % 2 ? -1 : 1)}px)`, color: lineIndex === 1 ? item.accent : item.color}}>{line}</div>
          ))}
        </div>
      </div>
      <div style={{position: "absolute", left: 80, right: 80, bottom: 150, display: "flex", gap: 14}}>
        {promises.map((_, dot) => (
          <div key={dot} style={{flex: 1, height: 8, borderRadius: 8, background: `${item.color}33`, overflow: "hidden"}}>
            <div style={{height: "100%", width: `${dot < index ? 100 : dot === index ? progress(local, 0, 30, Easing.linear) * 100 : 0}%`, background: item.color}} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Brand({frame}: {frame: number}) {
  const drop = spring({frame: frame - 22, fps: MOTION_FPS, config: {damping: 7, stiffness: 180, mass: 0.8}});
  const landed = frame >= 30;
  const cta = pop(frame, 58, 12);
  const shine = progress(frame, 72, 100, Easing.inOut(Easing.quad));
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 42%, #2c5249 0%, ${green} 50%, #132622 100%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff0e" />
      <Ripples x={862} y={832} frame={frame} from={30} every={11} count={6} size={1700} color={peach} width={2} />
      <div style={{position: "absolute", left: 0, right: 0, top: 690, textAlign: "center", font: `600 196px ${SERIF}`, letterSpacing: -6, lineHeight: 1}}>
        <Chars text="Отголосок" frame={frame} at={2} step={2} />
        <span style={{display: "inline-block", color: rust, transform: `translateY(${(1 - drop) * -700}px) scale(${landed ? 1 : 1.4})`}}>.</span>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, top: 1000, textAlign: "center", font: `600 44px ${SANS}`, lineHeight: 1.4, color: "#e9efe9"}}>
        <div><Chars text="Город говорит там," frame={frame} at={36} step={0.8} /></div>
        <div><Chars text="где случилась история" frame={frame} at={46} step={0.8} /></div>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, top: 1260, display: "flex", justifyContent: "center"}}>
        <div style={{position: "relative", overflow: "hidden", transform: `scale(${cta})`, background: cream, color: green, borderRadius: 999, padding: "34px 64px", font: `700 36px ${SANS}`, boxShadow: "0 24px 70px #0007"}}>
          otgolosok.online
          <div style={{position: "absolute", top: 0, bottom: 0, width: 120, left: `${-30 + shine * 140}%`, background: "linear-gradient(90deg, transparent, #f5b29688, transparent)", transform: "skewX(-20deg)"}} />
        </div>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 130, textAlign: "center", opacity: progress(frame, 70, 90)}}>
        <Kicker color={sage}>Аудиопрогулки по Москве</Kicker>
      </div>
    </AbsoluteFill>
  );
}

const scenes: Record<MotionSceneId, (props: {frame: number}) => ReactNode> = {
  echo: Echo,
  place: Place,
  route: Route,
  listen: Listen,
  trust: Trust,
  brand: Brand,
};

/** Как входящая сцена открывается поверх уходящей. */
const reveals: Record<MotionSceneId, (t: number) => {clipPath: string; transform?: string}> = {
  echo: () => ({clipPath: "none"}),
  // Круг расходится от точки, как волна «отголоска».
  place: (t) => ({clipPath: `circle(${t * 125}% at 50% 36%)`}),
  // Диагональная шторка снизу вверх.
  route: (t) => ({clipPath: `polygon(0 ${100 - t * 180}%, 100% ${160 - t * 180}%, 100% 100%, 0 100%)`}),
  // Раскрытие из точки финиша маршрута.
  listen: (t) => ({clipPath: `circle(${t * 130}% at 62% 72%)`, transform: `scale(${1.25 - t * 0.25})`}),
  trust: (t) => ({clipPath: `inset(0 0 ${100 - t * 100}% 0)`}),
  brand: (t) => ({clipPath: `circle(${t * 125}% at 50% 50%)`}),
};

/** Полосы-акценты, проходящие по экрану на склейке. */
function CutBands({id, t}: {id: MotionSceneId; t: number}) {
  const colors = id === "trust" ? [peach, rust] : [rust, peach, cream];
  return (
    <>
      {colors.map((color, index) => {
        const local = Math.max(0, Math.min(1, t * 1.6 - index * 0.18));
        if (local <= 0 || local >= 1) return null;
        return <div key={color} style={{position: "absolute", left: -300, right: -300, height: 60 - index * 16, top: `${110 - local * 130}%`, background: color, transform: "rotate(-12deg)", opacity: 0.9}} />;
      })}
    </>
  );
}

function Grain({frame}: {frame: number}) {
  return (
    <svg width={1080} height={1920} style={{position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: 0.16, pointerEvents: "none"}} aria-hidden="true">
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 12} />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
}

export function OtgolosokMotion() {
  const frame = useCurrentFrame();
  const {id, localFrame, outgoing, transition} = getMotionFrameState(frame);
  const Current = scenes[id];
  const eased = swing(transition);
  const reveal = outgoing ? reveals[id](eased) : null;
  const listen = MOTION_SCENES.find((scene) => scene.id === "listen")!;
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
      {outgoing && <CutBands id={id} t={transition} />}
      <AbsoluteFill style={{background: "radial-gradient(circle at 50% 50%, transparent 60%, #00000055 100%)", pointerEvents: "none"}} />
      <Grain frame={frame} />
      <Html5Audio src={staticFile("motion/bed.wav")} volume={0.9} />
      <Sequence from={listen.start + 20} durationInFrames={listen.end - listen.start - 20} name="Фрагмент истории">
        <Html5Audio src={story} volume={(audioFrame) => Math.min(1, audioFrame / 12, (listen.end - listen.start - 20 - audioFrame) / 20)} />
      </Sequence>
    </AbsoluteFill>
  );
}
