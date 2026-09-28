import {TransitionSeries, linearTiming} from "@remotion/transitions";
import {fade} from "@remotion/transitions/fade";
import {AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {cameraFor, mixCamera, type Rect} from "./guide-camera";
import {Attribution, BrowserWindow, Screen} from "./guide-browser";
import {SANS, SERIF} from "./guide-fonts";
import {GREEN, GuideStepScene, Rise, progress} from "./guide-step";
import {BOOKEND_VOICE_FROM, GUIDE, GUIDE_INTRO_FRAMES, GUIDE_OUTRO_FRAMES, GUIDE_TIMINGS, GUIDE_TRANSITION_FRAMES, type GuideSpec, type stepTiming} from "./guide-timeline";

const CREAM = "#fffefa";
const SOFT = "#c9d5c6";

/** Тексты и кадры вступления и финала, которые отличают одну инструкцию от другой. */
export type GuideVideoProps = {
  guide: GuideSpec; timings: ReturnType<typeof stepTiming>[]; introFrames: number; outroFrames: number;
  intro: {eyebrow: string; title: [string, string]; lead: string; screen: string; focus: Rect; page: string};
  outro: {title: [string, string]; lead: string; footer: string};
};

function Intro({guide, intro, introFrames}: GuideVideoProps) {
  const frame = useCurrentFrame();
  const shown = progress(frame, 6, 40);
  const camera = mixCamera(cameraFor(), cameraFor(intro.focus), progress(frame, 10, introFrames));
  return <AbsoluteFill style={{background: `radial-gradient(1100px 900px at 85% 30%, #2d5048 0%, ${GREEN} 65%)`, color: CREAM, fontFamily: SANS}}>
    <BrowserWindow page={intro.page} style={{left: 840, top: 200, opacity: shown, scale: "0.8", transformOrigin: "0 0",
      transform: `perspective(2400px) rotateY(${16 - shown * 6}deg) translateY(${(1 - shown) * 40}px)`, boxShadow: "0 40px 120px #0008"}}>
      <Screen name={intro.screen} camera={camera} />
      <Attribution screens={[intro.screen]} />
    </BrowserWindow>
    <div style={{position: "absolute", left: 110, top: 96, fontFamily: SERIF, fontWeight: 600, fontSize: 48}}>Отголосок<span style={{color: "#e27a57"}}>.</span></div>
    <div style={{position: "absolute", left: 110, top: 300, width: 780}}>
      <Rise frame={frame} at={8}><div style={{fontSize: 22, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: SOFT}}>{intro.eyebrow}</div></Rise>
      <Rise frame={frame} at={14}><h1 style={{fontFamily: SERIF, fontWeight: 600, fontSize: 128, lineHeight: 0.98, letterSpacing: -2, margin: "28px 0 40px"}}>{intro.title[0]}<br />{intro.title[1]}</h1></Rise>
      <Rise frame={frame} at={24}><p style={{fontSize: 34, lineHeight: 1.45, margin: 0, color: "#e4ebe1", maxWidth: 680}}>{intro.lead}</p></Rise>
    </div>
    <Sequence from={BOOKEND_VOICE_FROM} name="Голос: вступление"><Html5Audio src={staticFile(`${guide.voiceDir}/intro.mp3`)} /></Sequence>
  </AbsoluteFill>;
}

function Outro({guide, outro}: GuideVideoProps) {
  const frame = useCurrentFrame();
  const compact = guide.steps.length > 8;
  return <AbsoluteFill style={{background: `radial-gradient(1100px 900px at 15% 20%, #2d5048 0%, ${GREEN} 65%)`, color: CREAM, fontFamily: SANS}}>
    <div style={{position: "absolute", left: 110, top: 96, fontFamily: SERIF, fontWeight: 600, fontSize: 48}}>Отголосок<span style={{color: "#e27a57"}}>.</span></div>
    <div style={{position: "absolute", left: 110, top: 290, width: 760}}>
      <Rise frame={frame} at={6}><h1 style={{fontFamily: SERIF, fontWeight: 600, fontSize: 118, lineHeight: 1, letterSpacing: -2, margin: "0 0 40px"}}>{outro.title[0]}<br />{outro.title[1]}</h1></Rise>
      <Rise frame={frame} at={16}><p style={{fontSize: 34, lineHeight: 1.45, margin: 0, color: "#e4ebe1"}}>{outro.lead}</p></Rise>
    </div>
    {/* До восьми шагов — одна колонка, больше — две, чтобы список поместился в кадр. */}
    <div style={{position: "absolute", left: compact ? 930 : 1000, top: compact ? 200 : 250, width: compact ? 900 : 800, display: "grid", gap: compact ? 12 : 14,
      ...(compact ? {gridTemplateColumns: "1fr 1fr", gridAutoFlow: "column", gridTemplateRows: `repeat(${Math.ceil(guide.steps.length / 2)}, auto)`} : {})}}>
      {guide.steps.map((step, i) => <Rise key={step.id} frame={frame} at={20 + i * (compact ? 3 : 5)}>
        <div style={{display: "flex", alignItems: "baseline", gap: compact ? 16 : 26, padding: compact ? "12px 18px" : "14px 26px", borderRadius: 16, background: "#ffffff0d", border: "1px solid #ffffff1f"}}>
          <span style={{fontFamily: SERIF, fontWeight: 600, fontSize: compact ? 32 : 40, color: "#e27a57", width: compact ? 38 : 48, fontVariantNumeric: "lining-nums"}}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{fontSize: compact ? 23 : 30, fontWeight: 600}}>{step.title}</span>
        </div>
      </Rise>)}
    </div>
    <div style={{position: "absolute", left: 110, bottom: 80, fontSize: 24, color: SOFT, opacity: progress(frame, 70, 90)}}>
      {outro.footer}
    </div>
    <Sequence from={BOOKEND_VOICE_FROM} name="Голос: финал"><Html5Audio src={staticFile(`${guide.voiceDir}/outro.mp3`)} /></Sequence>
  </AbsoluteFill>;
}

const transition = (key: string) => <TransitionSeries.Transition key={key} presentation={fade()} timing={linearTiming({durationInFrames: GUIDE_TRANSITION_FRAMES})} />;

export function GuideVideo(props: GuideVideoProps) {
  const {guide, timings, introFrames, outroFrames} = props;
  const {durationInFrames} = useVideoConfig();
  return <AbsoluteFill style={{background: GREEN}}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="Вступление" durationInFrames={introFrames}><Intro {...props} /></TransitionSeries.Sequence>
      {/* TransitionSeries принимает только плоский список: переход и сцена идут отдельными элементами. */}
      {guide.steps.flatMap((step, index) => [
        transition(`to-${step.id}`),
        <TransitionSeries.Sequence key={step.id} name={step.title} durationInFrames={timings[index].duration}>
          <GuideStepScene guide={guide} step={step} index={index} timing={timings[index]} from={cameraFor(index === 0 ? undefined : guide.steps[index - 1].resultFocus)} />
        </TransitionSeries.Sequence>,
      ])}
      {transition("to-outro")}
      <TransitionSeries.Sequence name="Финал" durationInFrames={outroFrames}><Outro {...props} /></TransitionSeries.Sequence>
    </TransitionSeries>
    {/* Фон тише голоса примерно на 20 дБ и плавно уходит в конце. */}
    <Html5Audio src={staticFile("guide/bed.wav")} volume={frame => 0.11 * interpolate(frame, [0, 20, durationInFrames - 75, durationInFrames - 1], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} />
  </AbsoluteFill>;
}

export function OtgolosokGuide() {
  return <GuideVideo guide={GUIDE} timings={GUIDE_TIMINGS} introFrames={GUIDE_INTRO_FRAMES} outroFrames={GUIDE_OUTRO_FRAMES}
    intro={{eyebrow: "Инструкция по сайту", title: ["Как гулять", "с Отголоском"], lead: "От выбора маршрута до следующей истории — восемь простых шагов.", screen: "route", focus: {x: 300, y: 30, width: 680, height: 760}, page: "Прогулка"}}
    outro={{title: ["Теперь —", "ваша прогулка."], lead: "Откройте маршрут, включите историю и смотрите на город вокруг.", footer: "История → готовый маршрут → Начать прогулку"}} />;
}
