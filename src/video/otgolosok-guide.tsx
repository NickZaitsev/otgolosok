import {TransitionSeries, linearTiming} from "@remotion/transitions";
import {fade} from "@remotion/transitions/fade";
import {AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {cameraFor, mixCamera} from "./guide-camera";
import {Attribution, BrowserWindow, Screen} from "./guide-browser";
import {SANS, SERIF} from "./guide-fonts";
import {GREEN, GuideStepScene, Rise, progress} from "./guide-step";
import {BOOKEND_VOICE_FROM, GUIDE_INTRO_FRAMES, GUIDE_OUTRO_FRAMES, GUIDE_STEPS, GUIDE_TIMINGS, GUIDE_TRANSITION_FRAMES} from "./guide-timeline";

const CREAM = "#fffefa";
const SOFT = "#c9d5c6";

function Intro() {
  const frame = useCurrentFrame();
  const shown = progress(frame, 6, 40);
  const camera = mixCamera(cameraFor(), cameraFor({x: 300, y: 30, width: 680, height: 760}), progress(frame, 10, GUIDE_INTRO_FRAMES));
  return <AbsoluteFill style={{background: `radial-gradient(1100px 900px at 85% 30%, #2d5048 0%, ${GREEN} 65%)`, color: CREAM, fontFamily: SANS}}>
    <BrowserWindow page="Прогулка" style={{left: 840, top: 200, opacity: shown, scale: "0.8", transformOrigin: "0 0",
      transform: `perspective(2400px) rotateY(${16 - shown * 6}deg) translateY(${(1 - shown) * 40}px)`, boxShadow: "0 40px 120px #0008"}}>
      <Screen name="route" camera={camera} />
      <Attribution screens={["route"]} />
    </BrowserWindow>
    <div style={{position: "absolute", left: 110, top: 96, fontFamily: SERIF, fontWeight: 600, fontSize: 48}}>Отголосок<span style={{color: "#e27a57"}}>.</span></div>
    <div style={{position: "absolute", left: 110, top: 300, width: 780}}>
      <Rise frame={frame} at={8}><div style={{fontSize: 22, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: SOFT}}>Инструкция по сайту</div></Rise>
      <Rise frame={frame} at={14}><h1 style={{fontFamily: SERIF, fontWeight: 600, fontSize: 128, lineHeight: 0.98, letterSpacing: -2, margin: "28px 0 40px"}}>Как гулять<br />с Отголоском</h1></Rise>
      <Rise frame={frame} at={24}><p style={{fontSize: 34, lineHeight: 1.45, margin: 0, color: "#e4ebe1", maxWidth: 680}}>От выбора маршрута до следующей истории — восемь простых шагов.</p></Rise>
    </div>
    <Sequence from={BOOKEND_VOICE_FROM} name="Голос: вступление"><Html5Audio src={staticFile("guide/voice/intro.mp3")} /></Sequence>
  </AbsoluteFill>;
}

function Outro() {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: `radial-gradient(1100px 900px at 15% 20%, #2d5048 0%, ${GREEN} 65%)`, color: CREAM, fontFamily: SANS}}>
    <div style={{position: "absolute", left: 110, top: 96, fontFamily: SERIF, fontWeight: 600, fontSize: 48}}>Отголосок<span style={{color: "#e27a57"}}>.</span></div>
    <div style={{position: "absolute", left: 110, top: 290, width: 760}}>
      <Rise frame={frame} at={6}><h1 style={{fontFamily: SERIF, fontWeight: 600, fontSize: 118, lineHeight: 1, letterSpacing: -2, margin: "0 0 40px"}}>Теперь —<br />ваша прогулка.</h1></Rise>
      <Rise frame={frame} at={16}><p style={{fontSize: 34, lineHeight: 1.45, margin: 0, color: "#e4ebe1"}}>Откройте маршрут, включите историю и смотрите на город вокруг.</p></Rise>
    </div>
    <div style={{position: "absolute", left: 1000, top: 250, width: 800, display: "grid", gap: 14}}>
      {GUIDE_STEPS.map((step, i) => <Rise key={step.id} frame={frame} at={20 + i * 5}>
        <div style={{display: "flex", alignItems: "baseline", gap: 26, padding: "14px 26px", borderRadius: 16, background: "#ffffff0d", border: "1px solid #ffffff1f"}}>
          <span style={{fontFamily: SERIF, fontWeight: 600, fontSize: 40, color: "#e27a57", width: 48, fontVariantNumeric: "lining-nums"}}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{fontSize: 30, fontWeight: 600}}>{step.title}</span>
        </div>
      </Rise>)}
    </div>
    <div style={{position: "absolute", left: 110, bottom: 80, fontSize: 24, color: SOFT, opacity: progress(frame, 70, 90)}}>
      История → готовый маршрут → Начать прогулку
    </div>
    <Sequence from={BOOKEND_VOICE_FROM} name="Голос: финал"><Html5Audio src={staticFile("guide/voice/outro.mp3")} /></Sequence>
  </AbsoluteFill>;
}

const transition = (key: string) => <TransitionSeries.Transition key={key} presentation={fade()} timing={linearTiming({durationInFrames: GUIDE_TRANSITION_FRAMES})} />;

export function OtgolosokGuide() {
  const {durationInFrames} = useVideoConfig();
  return <AbsoluteFill style={{background: GREEN}}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Вступление" durationInFrames={GUIDE_INTRO_FRAMES}><Intro /></TransitionSeries.Sequence>
      {/* TransitionSeries принимает только плоский список: переход и сцена идут отдельными элементами. */}
      {GUIDE_STEPS.flatMap((step, index) => [
        transition(`to-${step.id}`),
        <TransitionSeries.Sequence key={step.id} name={step.title} durationInFrames={GUIDE_TIMINGS[index].duration}>
          <GuideStepScene step={step} index={index} timing={GUIDE_TIMINGS[index]} from={cameraFor(index === 0 ? undefined : GUIDE_STEPS[index - 1].resultFocus)} />
        </TransitionSeries.Sequence>,
      ])}
      {transition("to-outro")}
      <TransitionSeries.Sequence name="Финал" durationInFrames={GUIDE_OUTRO_FRAMES}><Outro /></TransitionSeries.Sequence>
    </TransitionSeries>
    {/* Фон тише голоса примерно на 20 дБ и плавно уходит в конце. */}
    <Html5Audio src={staticFile("guide/bed.wav")} volume={frame => 0.11 * interpolate(frame, [0, 20, durationInFrames - 75, durationInFrames - 1], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} />
  </AbsoluteFill>;
}

