import type {ReactNode} from "react";
import {AbsoluteFill, Easing, Html5Audio, Sequence, interpolate, staticFile, useCurrentFrame} from "remotion";
import {cameraFor, mixCamera, project, screenScale, type Camera} from "./guide-camera";
import {Attribution, BrowserWindow, Cursor, Screen, VIEWPORT} from "./guide-browser";
import {SANS, SERIF} from "./guide-fonts";
import type {GuideSpec, GuideStep, stepTiming} from "./guide-timeline";

export const GREEN = "#203e38";
export const RUST = "#b64b28";
export const PAPER = "#f4efe6";
export const MUTED = "#627169";

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function progress(frame: number, from: number, to: number, easing = ease) {
  return interpolate(frame, [from, to], [0, 1], {...clamp, easing});
}

export function Rise({frame, at, children}: {frame: number; at: number; children: ReactNode}) {
  const shown = progress(frame, at, at + 18, easeOut);
  return <div style={{opacity: shown, translate: `0 ${(1 - shown) * 22}px`}}>{children}</div>;
}

export function Header({label}: {label: string}) {
  return <>
    <div style={{position: "absolute", left: 96, top: 44, fontFamily: SERIF, fontWeight: 600, fontSize: 44, color: GREEN}}>Отголосок<span style={{color: RUST}}>.</span></div>
    <div style={{position: "absolute", right: 72, top: 62, fontFamily: SANS, fontWeight: 600, fontSize: 18, letterSpacing: 2.5, textTransform: "uppercase", color: MUTED}}>{label}</div>
  </>;
}

/** Камера шага в кадре frame: наезд на цель, затем переход к результату. */
export function stepCamera(step: GuideStep, from: Camera, clickFrame: number, frame: number) {
  const toTarget = mixCamera(from, cameraFor(step.focus), progress(frame, 0, 45));
  return mixCamera(toTarget, cameraFor(step.resultFocus), progress(frame, clickFrame + 10, clickFrame + 55));
}

export function GuideStepScene({guide, step, index, timing, from}: {guide: GuideSpec; step: GuideStep; index: number; timing: ReturnType<typeof stepTiming>; from: Camera}) {
  const frame = useCurrentFrame();
  const {clickFrame: click, doFrom, doneFrom, duration} = timing;
  const camera = stepCamera(step, from, click, frame);
  const scale = screenScale(camera, VIEWPORT);
  const box = guide.targets[step.before];
  if (!box) throw new Error(`Нет цели для снимка «${step.before}»: переснимите материалы инструкции`);
  // Шаг без нажатия (идти по маршруту): только подсветка цели и подсказка.
  const clicks = step.gesture !== "look";
  const center = {x: box.x + box.width / 2, y: box.y + box.height / 2};

  // Курсор движется по странице и поэтому едет вместе с камерой, как при записи экрана.
  const travel = progress(frame, 22, click - 8, Easing.bezier(0.45, 0, 0.2, 1));
  const pointer = project({x: center.x + (1 - travel) * 150, y: center.y + (1 - travel) * 110}, camera, VIEWPORT);
  const press = interpolate(frame, [click - 4, click, click + 7], [1, 0.8, 1], clamp);

  const topLeft = project({x: box.x, y: box.y}, camera, VIEWPORT);
  const ring = {left: topLeft.x - 9, top: topLeft.y - 9, width: box.width * scale + 18, height: box.height * scale + 18};
  const spotlight = progress(frame, 32, 48) * (1 - progress(frame, click + 2, click + 14));
  const pulse = 0.5 + 0.5 * Math.sin((frame / 30) * Math.PI * 1.6);
  const ripple = clicks ? progress(frame, click, click + 22, easeOut) : 0;
  const tipShown = progress(frame, 42, 54, easeOut) * (1 - progress(frame, click, click + 8));
  const tipAbove = ring.top > 90;

  const after = progress(frame, click + 4, click + 16);
  const resultShown = progress(frame, click + 14, click + 32, easeOut);

  return <AbsoluteFill style={{background: `radial-gradient(1200px 800px at 12% 8%, #fbf8f2 0%, ${PAPER} 60%)`, fontFamily: SANS, color: GREEN}}>
    <Header label={guide.label} />

    <div style={{position: "absolute", left: 96, top: 212, width: 450}}>
      <Rise frame={frame} at={2}><div style={{fontFamily: SERIF, fontWeight: 600, fontSize: 132, lineHeight: 0.9, color: RUST, fontVariantNumeric: "lining-nums"}}>{String(index + 1).padStart(2, "0")}</div></Rise>
      <Rise frame={frame} at={7}><h1 style={{fontSize: 54, lineHeight: 1.08, letterSpacing: -1.5, fontWeight: 700, margin: "30px 0 26px"}}>{step.title}</h1></Rise>
      <Rise frame={frame} at={12}><p style={{fontSize: 30, lineHeight: 1.45, margin: 0, color: "#35504a"}}>{step.description}</p></Rise>
      <div style={{marginTop: 38, opacity: resultShown, translate: `0 ${(1 - resultShown) * 18}px`, display: "flex", gap: 16, alignItems: "flex-start",
        background: "#fffefa", border: "1px solid #dce2da", borderRadius: 16, padding: "20px 22px", boxShadow: "0 10px 30px #203e3812"}}>
        <svg width="34" height="34" viewBox="0 0 34 34" style={{flex: "none"}}><circle cx="17" cy="17" r="17" fill={GREEN} /><path d="M10 17.5 L15 22.5 L24.5 12" fill="none" stroke="#fffefa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <div style={{fontSize: 25, lineHeight: 1.4, fontWeight: 600}}>{step.result}</div>
      </div>
    </div>

    <BrowserWindow page={frame < click + 4 ? step.page : step.resultPage}>
      <Screen name={step.before} camera={camera} />
      {after > 0 && <Screen name={step.after} camera={camera} opacity={after} />}
      {spotlight > 0 && <div style={{position: "absolute", ...ring, borderRadius: 14, border: `3px solid ${RUST}`,
        boxShadow: `0 0 0 ${4 + pulse * 5}px #b64b2833, 0 0 0 4000px rgba(24, 38, 33, ${0.22 * spotlight})`, opacity: spotlight}} />}
      {ripple > 0 && ripple < 1 && <div style={{position: "absolute", left: pointer.x - 60 * ripple, top: pointer.y - 60 * ripple, width: 120 * ripple, height: 120 * ripple,
        borderRadius: "50%", border: `3px solid ${RUST}`, opacity: 1 - ripple}} />}
      {tipShown > 0 && <div style={{position: "absolute", left: Math.min(Math.max(ring.left + ring.width / 2, 170), VIEWPORT.width - 170), top: tipAbove ? ring.top - 16 : ring.top + ring.height + 16,
        translate: `-50% ${tipAbove ? "-100%" : "0"}`, opacity: tipShown, scale: String(0.94 + 0.06 * tipShown), background: GREEN, color: "#fffefa",
        padding: "10px 18px", borderRadius: 12, fontSize: 22, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 10px 24px #0003"}}>
        {step.tip ?? `Нажмите «${step.action}»`}
      </div>}
      {clicks && <Cursor x={pointer.x} y={pointer.y} scale={press} opacity={progress(frame, 16, 26) * (1 - progress(frame, click + 22, click + 36))} />}
      <Attribution screens={[step.before, step.after]} />
    </BrowserWindow>

    <div style={{position: "absolute", left: 96, bottom: 70, width: 450}}>
      <div style={{fontSize: 20, fontWeight: 600, color: MUTED, marginBottom: 14}}>Шаг {index + 1} из {guide.steps.length}</div>
      <div style={{display: "flex", gap: 8}}>{guide.steps.map((item, i) => <div key={item.id} style={{flex: 1, height: 6, borderRadius: 3, background: "#dcd9cd", overflow: "hidden"}}>
        <div style={{height: "100%", background: RUST, width: `${i < index ? 100 : i > index ? 0 : progress(frame, 0, duration, Easing.linear) * 100}%`}} />
      </div>)}</div>
    </div>

    <Sequence from={doFrom} name="Голос: инструкция"><Html5Audio src={staticFile(`${guide.voiceDir}/${step.id}-do.mp3`)} /></Sequence>
    {clicks && <Sequence from={click} durationInFrames={15} name="Щелчок"><Html5Audio src={staticFile("guide/click.wav")} volume={0.55} /></Sequence>}
    <Sequence from={doneFrom} name="Голос: результат"><Html5Audio src={staticFile(`${guide.voiceDir}/${step.id}-done.mp3`)} /></Sequence>
  </AbsoluteFill>;
}
