import type {CSSProperties, ReactNode} from "react";
import {AbsoluteFill, Easing, interpolate, random, useCurrentFrame} from "remotion";
import {SANS, SERIF} from "../guide-fonts";

// Палитры «Прогулка» и «Читальня» из DESIGN.md.
export const C = {
  night: "#0d0b0a",
  surface: "#1c1917",
  ink: "#f2ede4",
  muted: "#b5ada2",
  cinnabar: "#ff7a5c",
  peach: "#f5b296",
  teal: "#5ccfc5",
  ochre: "#e0b25c",
  rust: "#b64b28",
  green: "#203e38",
  paper: "#f5f1e8",
  cream: "#fffefa",
  paperInk: "#1a1714",
  paperMuted: "#57504a",
  paperLine: "#dce2da",
};

export {SANS, SERIF};

export const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeIn = Easing.bezier(0.7, 0, 0.84, 0);
export const easeInOut = Easing.bezier(0.83, 0, 0.17, 1);
export const easeBack = Easing.bezier(0.34, 1.56, 0.64, 1);

export function progress(frame: number, from: number, to: number, easing = easeOut) {
  return interpolate(frame, [from, to], [0, 1], {...clamp, easing});
}

/** Зерно плёнки; зерно меняется через кадр. */
export function Grain({opacity = 0.09}: {opacity?: number}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{opacity, mixBlendMode: "overlay", pointerEvents: "none"}}>
      <svg width="100%" height="100%" aria-hidden="true">
        <filter id="wide-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={Math.floor(frame / 2)} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#wide-grain)" />
      </svg>
    </AbsoluteFill>
  );
}

/** Сетка улиц-«пол», уходящая к горизонту и бегущая на зрителя. */
export function FloorGrid({color = "rgba(255,122,92,0.22)", speed = 3}: {color?: string; speed?: number}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{perspective: 900, overflow: "hidden"}}>
      <div
        style={{
          position: "absolute",
          left: -1200,
          right: -1200,
          top: "58%",
          height: 1400,
          transformOrigin: "50% 0%",
          transform: "rotateX(74deg)",
          backgroundImage: `linear-gradient(${color} 1.5px, transparent 1.5px), linear-gradient(90deg, ${color} 1.5px, transparent 1.5px)`,
          backgroundSize: "96px 96px",
          backgroundPosition: `0px ${frame * speed}px`,
          maskImage: "linear-gradient(to bottom, transparent 0%, #000 22%, #000 60%, transparent 100%)",
        }}
      />
    </AbsoluteFill>
  );
}

/** Ночной фон режима «Прогулка»: тёплое и бирюзовое свечение, сетка, зерно, виньетка. */
export function Night({children, grid = true, glow = 1}: {children?: ReactNode; grid?: boolean; glow?: number}) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  return (
    <AbsoluteFill style={{background: C.night, overflow: "hidden", fontFamily: SANS, color: C.ink}}>
      <div style={{position: "absolute", width: 1500, height: 1500, left: 160 + Math.sin(t * 0.55) * 260, top: -640 + Math.cos(t * 0.4) * 120, borderRadius: "50%", opacity: 0.55 * glow, background: `radial-gradient(circle, ${C.rust} 0%, transparent 62%)`, filter: "blur(60px)"}} />
      <div style={{position: "absolute", width: 1100, height: 1100, left: 1080 + Math.cos(t * 0.5) * 200, top: 360 + Math.sin(t * 0.35) * 140, borderRadius: "50%", opacity: 0.4 * glow, background: `radial-gradient(circle, #1f6f6b 0%, transparent 60%)`, filter: "blur(80px)"}} />
      {grid ? <FloorGrid /> : null}
      <AbsoluteFill>{children}</AbsoluteFill>
      <AbsoluteFill style={{background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 100%)", pointerEvents: "none"}} />
      <Grain />
    </AbsoluteFill>
  );
}

/** Светлый фон «Читальня» с тонкой сеткой бумаги. */
export function Paper({children}: {children?: ReactNode}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: C.paper, overflow: "hidden", fontFamily: SANS, color: C.paperInk}}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(#e6dfd1 1px, transparent 1px), linear-gradient(90deg, #e6dfd1 1px, transparent 1px)`,
          backgroundSize: "120px 120px",
          backgroundPosition: `${frame * 0.4}px ${frame * 0.4}px`,
          maskImage: "radial-gradient(ellipse at 50% 45%, #000 0%, transparent 75%)",
        }}
      />
      <div style={{position: "absolute", width: 1200, height: 1200, right: -300, top: -420, borderRadius: "50%", background: `radial-gradient(circle, ${C.rust}1f 0%, transparent 60%)`}} />
      <AbsoluteFill>{children}</AbsoluteFill>
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
}

/** Слова поднимаются из-под маски по одному и при желании уходят вверх. */
export function Words({text, start = 0, stagger = 4, exit, accent = [], accentColor = C.peach, accentItalic = false, style}: {
  text: string;
  start?: number;
  stagger?: number;
  exit?: number;
  accent?: string[];
  accentColor?: string;
  accentItalic?: boolean;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  return (
    <div style={{display: "flex", flexWrap: "wrap", columnGap: "0.24em", ...style}}>
      {text.split(" ").map((word, index) => {
        const inAt = start + index * stagger;
        const outAt = exit === undefined ? Infinity : exit + index * 2;
        const shift = frame < outAt ? (1 - progress(frame, inAt, inAt + 18)) * 110 : -progress(frame, outAt, outAt + 12, easeIn) * 115;
        const accented = accent.includes(word);
        return (
          <span key={index} style={{display: "inline-block", overflow: "hidden", paddingBottom: "0.14em", marginBottom: "-0.14em"}}>
            <span
              style={{
                display: "inline-block",
                color: accented ? accentColor : undefined,
                fontStyle: accented && accentItalic ? "italic" : undefined,
                transform: `translateY(${shift}%) rotate(${(1 - progress(frame, inAt, inAt + 18)) * 6}deg)`,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Расходящиеся круги — визуальный «отголосок». */
export function Rings({at, count = 3, color = C.peach, size = 1400, x = "50%", y = "50%"}: {at: number; count?: number; color?: string; size?: number; x?: string; y?: string}) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{pointerEvents: "none"}}>
      {Array.from({length: count}, (_, index) => {
        const from = at + index * 6;
        const life = progress(frame, from, from + 40);
        if (frame < from || life >= 1) return null;
        const scale = 0.05 + life * (1 - index * 0.18);
        return (
          <div key={index} style={{position: "absolute", left: x, top: y, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: "50%", border: `${3 - index}px solid ${color}`, transform: `scale(${scale})`, opacity: 1 - life}} />
        );
      })}
    </AbsoluteFill>
  );
}

/** Детерминированный сноп искр из центра. */
export function Sparks({at, count = 36, spread = 820, color = C.peach, seed = "sparks"}: {at: number; count?: number; spread?: number; color?: string; seed?: string}) {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "center", pointerEvents: "none"}}>
      {Array.from({length: count}, (_, index) => {
        const angle = random(`${seed}-a-${index}`) * Math.PI * 2;
        const distance = spread * (0.35 + random(`${seed}-d-${index}`) * 0.65);
        const life = progress(frame, at, at + 30 + random(`${seed}-l-${index}`) * 30);
        const radius = 2 + random(`${seed}-s-${index}`) * 5;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              width: radius * 2,
              height: radius * 2,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 ${radius * 4}px ${color}`,
              transform: `translate(${Math.cos(angle) * distance * life}px, ${Math.sin(angle) * distance * life}px)`,
              opacity: interpolate(life, [0, 0.1, 1], [0, 1, 0]),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

/** Короткая метка-пилюля над заголовком сцены. */
export function Kicker({children, at = 0, dark = true, style}: {children: ReactNode; at?: number; dark?: boolean; style?: CSSProperties}) {
  const frame = useCurrentFrame();
  const shown = progress(frame, at, at + 18);
  return (
    <div
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        alignItems: "center",
        gap: 14,
        padding: "12px 24px",
        borderRadius: 999,
        border: `1px solid ${dark ? "rgba(245,178,150,0.35)" : C.paperLine}`,
        background: dark ? "rgba(182,75,40,0.16)" : C.cream,
        color: dark ? C.peach : C.rust,
        font: `700 24px ${SANS}`,
        letterSpacing: 4,
        textTransform: "uppercase",
        opacity: shown,
        transform: `translateY(${(1 - shown) * 20}px)`,
        ...style,
      }}
    >
      <span style={{width: 10, height: 10, borderRadius: "50%", background: dark ? C.cinnabar : C.rust, boxShadow: `0 0 14px ${C.cinnabar}`}} />
      {children}
    </div>
  );
}
