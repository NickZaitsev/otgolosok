import type {CSSProperties, ReactNode} from "react";
import {AbsoluteFill, Easing, Img, interpolate, spring} from "remotion";
import {SANS} from "./guide-fonts";

// Общие приёмы вертикальных моушн-роликов: палитра, кинетический текст,
// «отголоски», зерно плёнки и полосы на склейках.
export const MOTION_KIT_FPS = 30;

export const green = "#203e38";
export const deep = "#0d1714";
export const cream = "#fffefa";
export const paper = "#f5f1e8";
export const ink = "#1a1714";
export const rust = "#b64b28";
export const peach = "#f5b296";
export const sage = "#9fbfb1";

export const expo = Easing.bezier(0.16, 1, 0.3, 1);
export const swing = Easing.bezier(0.65, 0, 0.35, 1);

export function progress(frame: number, from: number, to: number, easing = expo) {
  return interpolate(frame, [from, to], [0, 1], {easing, extrapolateLeft: "clamp", extrapolateRight: "clamp"});
}

export function pop(frame: number, delay: number, damping = 11) {
  return spring({frame: frame - delay, fps: MOTION_KIT_FPS, config: {damping, stiffness: 170, mass: 0.7}});
}

/** Буквы выезжают из-под маски строки по одной. */
export function Chars({text, frame, at, step = 1.6, style}: {text: string; frame: number; at: number; step?: number; style?: CSSProperties}) {
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
export function Ripples({x, y, frame, from, every, count, size, color, width = 3}: {
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

export function Kicker({children, color, style}: {children: ReactNode; color: string; style?: CSSProperties}) {
  return <div style={{font: `700 26px ${SANS}`, letterSpacing: 6, textTransform: "uppercase", color, ...style}}>{children}</div>;
}


export function DotGrid({frame, color}: {frame: number; color: string}) {
  return (
    <AbsoluteFill style={{backgroundImage: `radial-gradient(${color} 2px, transparent 2.5px)`, backgroundSize: "54px 54px", backgroundPosition: `0 ${-frame * 0.6}px`}} />
  );
}


/** Полосы-акценты, проходящие по экрану на склейке. */
export function CutBands({t, colors = [rust, peach, cream]}: {t: number; colors?: readonly string[]}) {
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

export function Grain({frame}: {frame: number}) {
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


/** Прямоугольник снимка экрана в пикселях снимка. */
export type ScreenRect = {x: number; y: number; width: number; height: number};

/** Снимки интерфейса сняты в 1280×800 CSS-пикселей с deviceScaleFactor 2. */
export const SCREEN_SIZE = {width: 2560, height: 1600};

/** Вырезка снимка экрана заданной ширины. */
export function ScreenCrop({src, rect, width, radius = 40, style}: {src: string; rect: ScreenRect; width: number; radius?: number; style?: CSSProperties}) {
  const scale = width / rect.width;
  return (
    <div style={{position: "relative", width, height: rect.height * scale, borderRadius: radius, overflow: "hidden", ...style}}>
      <Img src={src} style={{position: "absolute", maxWidth: "none", width: SCREEN_SIZE.width * scale, height: SCREEN_SIZE.height * scale, left: -rect.x * scale, top: -rect.y * scale}} />
    </div>
  );
}

/** Касание пальцем: круг подлетает, нажимает в кадре at и расходится кольцами. */
export function TapMark({x, y, frame, at}: {x: number; y: number; frame: number; at: number}) {
  const appear = progress(frame, at - 14, at - 4);
  const press = interpolate(frame, [at - 4, at, at + 6], [1, 0.72, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const leave = 1 - progress(frame, at + 12, at + 24);
  const opacity = Math.min(appear, leave);
  if (opacity <= 0) return null;
  return (
    <>
      <Ripples x={x} y={y} frame={frame} from={at} every={7} count={2} size={260} color={cream} width={4} />
      <div style={{position: "absolute", left: x - 42, top: y - 42, width: 84, height: 84, borderRadius: "50%", background: "#fffefacc", border: `4px solid ${rust}`, boxShadow: "0 10px 30px #0006", opacity, transform: `translate(${(1 - appear) * 60}px, ${(1 - appear) * 90}px) scale(${press})`}} />
    </>
  );
}
