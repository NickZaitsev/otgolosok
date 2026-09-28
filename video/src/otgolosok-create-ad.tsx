import type {ReactNode} from "react";
import {AbsoluteFill, Easing, Html5Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import {SANS, SERIF} from "./guide-fonts";
import {CREATE_AD_VOICE_FRAME, getCreateAdFrameState, tapAt, type CreateAdSceneId} from "./create-ad-timeline";
import {Chars, CutBands, DotGrid, Grain, Kicker, Ripples, ScreenCrop, TapMark, cream, deep, green, peach, pop, progress, rust, sage, swing, type ScreenRect} from "./motion-kit";

// Снимки сценария «своя прогулка» из e2e/video-create-guide.spec.ts.
const screen = (name: string) => staticFile(`guide/create/${name}.png`);

// Области снимков в пикселях снимка (2560×1600).
const PANEL_START: ScreenRect = {x: 860, y: 200, width: 840, height: 430};
const PANEL_TIME: ScreenRect = {x: 860, y: 200, width: 840, height: 800};
const PANEL_READY: ScreenRect = {x: 860, y: 200, width: 840, height: 600};
const ROUTE_PREVIEW: ScreenRect = {x: 1780, y: 400, width: 660, height: 680};
const WALK_BUTTON: ScreenRect = {x: 890, y: 1234, width: 776, height: 116};
const WALK_MAP: ScreenRect = {x: 880, y: 120, width: 720, height: 680};
// Место нажатия на пустой карте (targets.json create/empty) и метка старта после него.
const LENS_EMPTY: ScreenRect = {x: 20, y: 180, width: 900, height: 900};
const LENS_START: ScreenRect = {x: 1660, y: 310, width: 900, height: 900};

/** Точка на вырезке в координатах кадра. */
function onCard(card: {left: number; top: number; width: number}, rect: ScreenRect, x: number, y: number) {
  const scale = card.width / rect.width;
  return {x: card.left + x * scale, y: card.top + y * scale};
}

function StepBackdrop({src, frame}: {src: string; frame: number}) {
  const zoom = interpolate(frame, [0, 170], [1.3, 1.15], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: deep, overflow: "hidden"}}>
      <Img src={src} style={{position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, filter: "blur(16px) saturate(0.7) brightness(0.55)"}} />
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${deep}f2 0%, #0d1714b8 30%, #0d1714c8 70%, ${deep}f5 100%)`}} />
    </AbsoluteFill>
  );
}

function StepHeader({frame, number, kicker, line, accent}: {frame: number; number?: string; kicker: string; line: string; accent: string}) {
  const numberIn = progress(frame, 0, 26);
  return (
    <>
      {number && (
        <div style={{position: "absolute", right: 40, top: 40, font: `600 400px ${SERIF}`, lineHeight: 1, fontVariantNumeric: "lining-nums", color: "transparent", WebkitTextStroke: `2px ${peach}`, opacity: numberIn * 0.22, transform: `translateX(${(1 - numberIn) * 160}px)`}}>{number}</div>
      )}
      <div style={{position: "absolute", left: 80, top: 130, color: cream}}>
        <Kicker color={peach}><Chars text={kicker} frame={frame} at={2} step={1} /></Kicker>
        <div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 138, lineHeight: 0.95, letterSpacing: -3, marginTop: 26}}>
          <div><Chars text={line} frame={frame} at={6} step={1.4} /></div>
          <div style={{color: peach, fontStyle: "italic"}}><Chars text={accent} frame={frame} at={16} step={1.4} /></div>
        </div>
      </div>
    </>
  );
}

function Caption({frame, at, children}: {frame: number; at: number; children: ReactNode}) {
  const shown = progress(frame, at, at + 18);
  return (
    <div style={{position: "absolute", left: 80, right: 80, bottom: 120, display: "flex", alignItems: "center", gap: 22, opacity: shown, transform: `translateY(${(1 - shown) * 30}px)`, color: "#e9efe9", font: `600 36px ${SANS}`, lineHeight: 1.3}}>
      <span style={{flex: "none", width: 64, height: 3, background: peach, transform: `scaleX(${shown})`, transformOrigin: "left"}} />
      <span>{children}</span>
    </div>
  );
}

function Hook({frame}: {frame: number}) {
  const steps = ["Начало", "Время", "Маршрут"];
  const xs = [220, 540, 860];
  const line = progress(frame, 22, 52, swing);
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 40%, #1d3530 0%, ${deep} 65%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff12" />
      <div style={{position: "absolute", left: 90, right: 90, top: 110, display: "flex", justifyContent: "space-between", opacity: progress(frame, 2, 18)}}>
        <Kicker color="#ffffffb0">Отголосок</Kicker>
        <Kicker color="#ffffffb0">Москва</Kicker>
      </div>
      <div style={{position: "absolute", left: 90, top: 560, fontFamily: SERIF, fontWeight: 600, fontSize: 168, lineHeight: 0.92, letterSpacing: -5}}>
        <div><Chars text="Своя" frame={frame} at={2} /></div>
        <div><Chars text="прогулка" frame={frame} at={8} step={1.2} /></div>
        <div style={{color: peach, fontStyle: "italic"}}><Chars text="за три шага" frame={frame} at={16} step={1.2} /></div>
      </div>
      <svg width={1080} height={1920} style={{position: "absolute", inset: 0}} aria-hidden="true">
        <line x1={xs[0]} y1={1330} x2={xs[0] + (xs[2] - xs[0]) * line} y2={1330} stroke={sage} strokeWidth={4} strokeDasharray="4 14" strokeLinecap="round" />
      </svg>
      <Ripples x={xs[0]} y={1330} frame={frame} from={26} every={14} count={3} size={420} color={peach} width={2} />
      {steps.map((label, index) => {
        const shown = pop(frame, 24 + index * 8, 10);
        return (
          <div key={label} style={{position: "absolute", left: xs[index] - 80, top: 1250, width: 160, textAlign: "center", transform: `scale(${shown})`}}>
            <div style={{width: 160, height: 160, borderRadius: "50%", background: index === 0 ? rust : green, border: `4px solid ${index === 0 ? rust : sage}`, display: "grid", placeItems: "center", font: `600 88px ${SERIF}`, fontVariantNumeric: "lining-nums", boxShadow: "0 20px 50px #0008"}}>{index + 1}</div>
            <div style={{marginTop: 26, font: `700 30px ${SANS}`, color: sage}}>{label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Start({frame}: {frame: number}) {
  const tap = tapAt("start");
  const lens = {left: 240, top: 560, width: 600};
  const lensSwap = progress(frame, tap + 2, tap + 14);
  const pin = onCard(lens, LENS_START, 468, 430);
  const panel = {left: 80, top: 1220, width: 920};
  const panelSwap = progress(frame, tap + 8, tap + 20);
  const sweep = progress(frame, tap + 14, tap + 40, Easing.inOut(Easing.quad));
  const row = {top: panel.top + 120 * (panel.width / PANEL_START.width), height: 150 * (panel.width / PANEL_START.width)};
  const lensIn = pop(frame, 8, 13);
  const panelIn = pop(frame, 16, 14);
  return (
    <AbsoluteFill style={{color: cream}}>
      <StepBackdrop src={screen("start")} frame={frame} />
      <StepHeader frame={frame} number="01" kicker="Шаг 1 из 3" line="Отметьте" accent="начало" />
      <div style={{position: "absolute", left: lens.left, top: lens.top, width: lens.width, height: lens.width, transform: `scale(${lensIn})`}}>
        <div style={{position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", border: `6px solid ${cream}`, boxShadow: "0 40px 100px #000a"}}>
          <ScreenCrop src={screen("empty")} rect={LENS_EMPTY} width={lens.width - 12} radius={0} />
          <div style={{position: "absolute", inset: 0, opacity: lensSwap}}>
            <ScreenCrop src={screen("start")} rect={LENS_START} width={lens.width - 12} radius={0} />
          </div>
        </div>
        <svg width={lens.width + 120} height={lens.width + 120} style={{position: "absolute", left: -60, top: -60}} aria-hidden="true">
          <circle cx={(lens.width + 120) / 2} cy={(lens.width + 120) / 2} r={lens.width / 2 + 36} fill="none" stroke={peach} strokeWidth={2} strokeDasharray="3 16" strokeLinecap="round" transform={`rotate(${frame * 0.8} ${(lens.width + 120) / 2} ${(lens.width + 120) / 2})`} />
        </svg>
      </div>
      <TapMark x={lens.left + lens.width / 2} y={lens.top + lens.width / 2} frame={frame} at={tap} />
      {lensSwap > 0 && <Ripples x={pin.x} y={pin.y} frame={frame} from={tap + 6} every={10} count={3} size={320} color={rust} width={4} />}
      <div style={{position: "absolute", left: panel.left, top: panel.top, transform: `translateY(${(1 - panelIn) * 500}px)`, boxShadow: "0 40px 100px #000b", borderRadius: 40}}>
        <ScreenCrop src={screen("empty")} rect={PANEL_START} width={panel.width} />
        <div style={{position: "absolute", inset: 0, opacity: panelSwap}}>
          <ScreenCrop src={screen("start")} rect={PANEL_START} width={panel.width} />
        </div>
      </div>
      {sweep > 0 && sweep < 1 && (
        <div style={{position: "absolute", left: panel.left + 50, top: row.top, width: panel.width - 100, height: row.height, overflow: "hidden", borderRadius: 20, pointerEvents: "none"}}>
          <div style={{position: "absolute", top: 0, bottom: 0, width: 220, left: `${-30 + sweep * 130}%`, background: "linear-gradient(90deg, transparent, #f5b29666, transparent)", transform: "skewX(-18deg)"}} />
        </div>
      )}
      <Caption frame={frame} at={tap + 20}>Нажмите на карту — адрес найдётся сам</Caption>
    </AbsoluteFill>
  );
}

function Time({frame}: {frame: number}) {
  const tap = tapAt("time");
  const panel = {left: 90, top: 560, width: 900};
  const chip = onCard(panel, PANEL_TIME, 420, 526);
  const swap = progress(frame, tap + 2, tap + 10);
  const roll = progress(frame, tap, tap + 16);
  const panelIn = pop(frame, 10, 14);
  const lineIn = progress(frame, 24, 44);
  return (
    <AbsoluteFill style={{color: cream}}>
      <StepBackdrop src={screen("time-60")} frame={frame} />
      <StepHeader frame={frame} number="02" kicker="Шаг 2 из 3" line="Выберите" accent="время" />
      <div style={{position: "absolute", left: panel.left, top: panel.top, transform: `translateY(${(1 - panelIn) * 600}px) rotate(${(1 - panelIn) * 6}deg)`, boxShadow: "0 40px 100px #000b", borderRadius: 40}}>
        <ScreenCrop src={screen("time")} rect={PANEL_TIME} width={panel.width} />
        <div style={{position: "absolute", inset: 0, opacity: swap}}>
          <ScreenCrop src={screen("time-60")} rect={PANEL_TIME} width={panel.width} />
        </div>
      </div>
      <TapMark x={chip.x} y={chip.y} frame={frame} at={tap} />
      <div style={{position: "absolute", left: 80, top: 1460, display: "flex", alignItems: "flex-end", gap: 26, opacity: lineIn, transform: `translateY(${(1 - lineIn) * 40}px)`}}>
        <div style={{height: 210, overflow: "hidden", font: `600 210px ${SERIF}`, lineHeight: 1, fontVariantNumeric: "lining-nums tabular-nums"}}>
          <div style={{transform: `translateY(${-roll * 210}px)`}}>
            <div>30</div>
            <div style={{color: peach}}>60</div>
          </div>
        </div>
        <div style={{paddingBottom: 30}}>
          <div style={{font: `700 44px ${SANS}`}}>минут</div>
          <div style={{font: `600 30px ${SANS}`, color: sage, marginTop: 6}}>и обратно к началу</div>
        </div>
      </div>
      <Caption frame={frame} at={tap + 22}>Маршрут подстроится под ваше время</Caption>
    </AbsoluteFill>
  );
}

function Counter({value, frame, at, label, decimals = 0}: {value: number; frame: number; at: number; label: string; decimals?: number}) {
  const count = value * progress(frame, at, at + 36, Easing.out(Easing.cubic));
  const shown = progress(frame, at, at + 14);
  return (
    <div style={{opacity: shown, transform: `translateY(${(1 - shown) * 40}px)`}}>
      <div style={{font: `600 150px ${SERIF}`, lineHeight: 1, fontVariantNumeric: "lining-nums tabular-nums"}}>{count.toFixed(decimals).replace(".", ",")}</div>
      <div style={{font: `600 30px ${SANS}`, color: sage, marginTop: 6}}>{label}</div>
    </div>
  );
}

function Build({frame}: {frame: number}) {
  const tap = tapAt("build");
  const panel = {left: 90, top: 640, width: 900};
  const button = onCard(panel, PANEL_READY, 420, 514);
  const panelIn = pop(frame, 6, 14);
  const panelOut = progress(frame, tap + 8, tap + 24, swing);
  const card = {left: 150, top: 560, width: 780};
  const cardIn = pop(frame, tap + 16, 13);
  const reveal = progress(frame, tap + 16, tap + 60, Easing.inOut(Easing.cubic));
  return (
    <AbsoluteFill style={{color: cream}}>
      <StepBackdrop src={screen("preview")} frame={frame} />
      <StepHeader frame={frame} number="03" kicker="Шаг 3 из 3" line="Постройте" accent="прогулку" />
      {panelOut < 1 && (
        <div style={{position: "absolute", left: panel.left, top: panel.top, opacity: 1 - panelOut, transform: `translateY(${(1 - panelIn) * 600 + panelOut * 200}px) scale(${1 - panelOut * 0.2})`, boxShadow: "0 40px 100px #000b", borderRadius: 40}}>
          <ScreenCrop src={screen("ready")} rect={PANEL_READY} width={panel.width} />
        </div>
      )}
      <TapMark x={button.x} y={button.y} frame={frame} at={tap} />
      {frame >= tap + 16 && (
        <div style={{position: "absolute", left: card.left, top: card.top, transform: `scale(${0.8 + cardIn * 0.2}) rotate(${(1 - cardIn) * -4}deg)`, opacity: Math.min(1, cardIn * 2), boxShadow: "0 50px 120px #000c", borderRadius: 44, border: `6px solid ${cream}`}}>
          <div style={{clipPath: `circle(${reveal * 150}% at 21% 21%)`}}>
            <ScreenCrop src={screen("preview")} rect={ROUTE_PREVIEW} width={card.width - 12} radius={38} />
          </div>
        </div>
      )}
      <div style={{position: "absolute", left: 110, right: 110, top: 1440, display: "flex", gap: 120}}>
        <Counter value={52} frame={frame} at={tap + 40} label="минут пешком" />
        <Counter value={4.2} frame={frame} at={tap + 50} label="километра" decimals={1} />
      </div>
      <Caption frame={frame} at={tap + 70}>Путь и остановки — автоматически</Caption>
    </AbsoluteFill>
  );
}

function Bars({frame}: {frame: number}) {
  return (
    <div style={{display: "flex", alignItems: "center", gap: 6, height: 50}}>
      {Array.from({length: 7}, (_, index) => (
        <div key={index} style={{width: 7, borderRadius: 4, background: peach, height: 12 + Math.abs(Math.sin(frame * 0.3 + index * 1.3)) * 36}} />
      ))}
    </div>
  );
}

function Walk({frame}: {frame: number}) {
  const tap = tapAt("walk");
  const button = {left: 130, top: 560, width: 820};
  const press = interpolate(frame, [tap - 3, tap, tap + 5], [1, 0.93, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const buttonIn = pop(frame, 2, 12);
  const buttonOut = progress(frame, tap + 10, tap + 24, swing);
  const map = {left: 110, top: 560, width: 860};
  const mapIn = pop(frame, tap + 14, 13);
  const dot = onCard(map, WALK_MAP, 186, 124);
  const chipIn = pop(frame, tap + 40, 12);
  return (
    <AbsoluteFill style={{color: cream}}>
      <StepBackdrop src={screen("walking")} frame={frame} />
      <StepHeader frame={frame} kicker="Готово" line="И просто" accent="идите" />
      {frame >= tap + 14 && (
        <div style={{position: "absolute", left: map.left, top: map.top, transform: `translateY(${(1 - mapIn) * 400}px) scale(${0.9 + mapIn * 0.1})`, boxShadow: "0 50px 120px #000c", borderRadius: 44, border: `6px solid ${cream}`, overflow: "hidden"}}>
          <ScreenCrop src={screen("walking")} rect={WALK_MAP} width={map.width - 12} radius={38} />
        </div>
      )}
      {frame >= tap + 24 && <Ripples x={dot.x} y={dot.y} frame={frame} from={tap + 24} every={16} count={6} size={340} color="#4a8fe0" width={4} />}
      {buttonOut < 1 && (
        <div style={{position: "absolute", left: button.left, top: button.top, opacity: 1 - buttonOut, transform: `translateY(${(1 - buttonIn) * 300 - buttonOut * 120}px) scale(${press * (1 - buttonOut * 0.3)})`, boxShadow: "0 30px 80px #000b", borderRadius: 999}}>
          <ScreenCrop src={screen("walk")} rect={WALK_BUTTON} width={button.width} radius={999} />
        </div>
      )}
      <TapMark x={button.left + button.width / 2} y={button.top + 60} frame={frame} at={tap} />
      <div style={{position: "absolute", left: 110, right: 110, top: 1470, display: "flex", alignItems: "center", gap: 28, padding: "30px 40px", borderRadius: 999, background: "#203e38ee", border: `2px solid ${sage}55`, transform: `scale(${chipIn})`, boxShadow: "0 24px 70px #0009"}}>
        <Bars frame={frame} />
        <span style={{font: `700 36px ${SANS}`}}>Истории звучат у каждого дома</span>
      </div>
    </AbsoluteFill>
  );
}

function Brand({frame}: {frame: number}) {
  const drop = pop(frame - 20, 0, 7);
  const cta = pop(frame, 50, 12);
  const shine = progress(frame, 64, 92, Easing.inOut(Easing.quad));
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 50% 42%, #2c5249 0%, ${green} 50%, #132622 100%)`, color: cream, overflow: "hidden"}}>
      <DotGrid frame={frame} color="#ffffff0e" />
      <Ripples x={862} y={832} frame={frame} from={28} every={11} count={6} size={1700} color={peach} width={2} />
      <div style={{position: "absolute", left: 0, right: 0, top: 690, textAlign: "center", font: `600 196px ${SERIF}`, letterSpacing: -6, lineHeight: 1}}>
        <Chars text="Отголосок" frame={frame} at={2} step={2} />
        <span style={{display: "inline-block", color: rust, transform: `translateY(${(1 - drop) * -700}px)`}}>.</span>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, top: 1000, textAlign: "center", font: `600 44px ${SANS}`, lineHeight: 1.4, color: "#e9efe9"}}>
        <div><Chars text="Соберите свою прогулку" frame={frame} at={30} step={0.7} /></div>
        <div><Chars text="за три шага" frame={frame} at={40} step={0.8} /></div>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, top: 1260, display: "flex", justifyContent: "center"}}>
        <div style={{position: "relative", overflow: "hidden", transform: `scale(${cta})`, background: cream, color: green, borderRadius: 999, padding: "34px 64px", font: `700 36px ${SANS}`, boxShadow: "0 24px 70px #0007"}}>
          otgolosok.online
          <div style={{position: "absolute", top: 0, bottom: 0, width: 120, left: `${-30 + shine * 140}%`, background: "linear-gradient(90deg, transparent, #f5b29688, transparent)", transform: "skewX(-20deg)"}} />
        </div>
      </div>
      <div style={{position: "absolute", left: 0, right: 0, bottom: 130, textAlign: "center", opacity: progress(frame, 60, 80)}}>
        <Kicker color={sage}>Аудиопрогулки по Москве</Kicker>
      </div>
    </AbsoluteFill>
  );
}

const scenes: Record<CreateAdSceneId, (props: {frame: number}) => ReactNode> = {
  hook: Hook,
  start: Start,
  time: Time,
  build: Build,
  walk: Walk,
  brand: Brand,
};

/** Как входящая сцена открывается поверх уходящей. */
const reveals: Record<CreateAdSceneId, (t: number) => {clipPath: string; transform?: string}> = {
  hook: () => ({clipPath: "none"}),
  // Раскрытие из первого шага схемы «1 → 2 → 3».
  start: (t) => ({clipPath: `circle(${t * 140}% at 20% 69%)`}),
  time: (t) => ({clipPath: `polygon(0 ${100 - t * 180}%, 100% ${160 - t * 180}%, 100% 100%, 0 100%)`}),
  build: (t) => ({clipPath: `inset(${100 - t * 100}% 0 0 0)`}),
  walk: (t) => ({clipPath: `circle(${t * 130}% at 50% 55%)`, transform: `scale(${1.2 - t * 0.2})`}),
  brand: (t) => ({clipPath: `circle(${t * 125}% at 50% 50%)`}),
};

export function OtgolosokCreateAd() {
  const frame = useCurrentFrame();
  const {id, localFrame, outgoing, transition} = getCreateAdFrameState(frame);
  const Current = scenes[id];
  const eased = swing(transition);
  const Outgoing = outgoing ? scenes[outgoing.id] : null;

  return (
    <AbsoluteFill style={{background: deep, fontFamily: SANS}}>
      {Outgoing && outgoing && (
        <AbsoluteFill style={{transform: `scale(${1 + eased * 0.08})`, filter: `brightness(${1 - eased * 0.4})`}}>
          <Outgoing frame={outgoing.localFrame} />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={outgoing ? reveals[id](eased) : undefined}>
        <Current frame={localFrame} />
      </AbsoluteFill>
      {outgoing && <CutBands t={transition} />}
      <AbsoluteFill style={{background: "radial-gradient(circle at 50% 50%, transparent 60%, #00000055 100%)", pointerEvents: "none"}} />
      <Grain frame={frame} />
      <Html5Audio src={staticFile("motion/create-bed.wav")} volume={0.9} />
      <Sequence from={CREATE_AD_VOICE_FRAME} name="Фрагмент истории">
        <Html5Audio src={staticFile("guide/create-ad/voice/story.mp3")} volume={(audioFrame) => Math.min(1, audioFrame / 6)} />
      </Sequence>
    </AbsoluteFill>
  );
}
