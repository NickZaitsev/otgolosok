import {AbsoluteFill, Img, Series, interpolate, staticFile, useCurrentFrame} from "remotion";
import {GuideStepScene} from "./guide-step";
import {GUIDE_FPS, GUIDE_INTRO_FRAMES, GUIDE_OUTRO_FRAMES, GUIDE_STEPS} from "./guide-timeline";

function GuideBookend({outro = false}: {outro?: boolean}) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: "#203e38", color: "#fff9eb", fontFamily: '"Segoe UI", Arial, sans-serif', padding: 100}}>
    <Img src={staticFile("guide/route.png")} style={{position: "absolute", left: 970, top: 0, width: 1728, height: 1080, opacity: 0.3}} />
    <AbsoluteFill style={{background: "linear-gradient(90deg, #203e38 42%, transparent 100%)"}} />
    <div style={{position: "relative", opacity: interpolate(frame, [0, 18], [0, 1], {extrapolateRight: "clamp"})}}>
      <div style={{fontSize: 38, marginBottom: 120}}>отголосок</div>
      <h1 style={{fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 100, lineHeight: 1.08, maxWidth: 1050, margin: "0 0 48px"}}>{outro ? <>Теперь —<br />ваша прогулка.</> : <>Как гулять<br />с Отголоском</>}</h1>
      <p style={{fontSize: 36, lineHeight: 1.5, maxWidth: 820}}>{outro ? "Откройте маршрут. Включите историю. Смотрите на город вокруг." : "От выбора маршрута до следующей истории: семь простых действий на сайте."}</p>
      <div style={{fontSize: 24, color: "#c4d0b9", marginTop: 70}}>{outro ? "История → готовый маршрут → Начать прогулку" : "Демонстрация: «От Кожевников к Цинделю»"}</div>
    </div>
    <div style={{position: "absolute", bottom: 35, right: 50, fontSize: 16, color: "#d4ddcf"}}>Карта: © OpenStreetMap</div>
  </AbsoluteFill>;
}

export function OtgolosokGuide() {
  return <Series>
    <Series.Sequence durationInFrames={GUIDE_INTRO_FRAMES}><GuideBookend /></Series.Sequence>
    {GUIDE_STEPS.map((step, index) => <Series.Sequence key={step.id} durationInFrames={step.seconds * GUIDE_FPS} name={step.title}>
      <GuideStepScene step={step} index={index} />
    </Series.Sequence>)}
    <Series.Sequence durationInFrames={GUIDE_OUTRO_FRAMES}><GuideBookend outro /></Series.Sequence>
  </Series>;
}
