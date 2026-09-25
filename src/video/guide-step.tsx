import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from "remotion";
import targets from "../../video/assets/guide/targets.json";
import {GUIDE_FPS, GUIDE_STEPS, guidePhase, type GuideStep} from "./guide-timeline";

const clamp = {extrapolateLeft: "clamp", extrapolateRight: "clamp"} as const;

export function GuideStepScene({step, index}: {step: GuideStep; index: number}) {
  const frame = useCurrentFrame();
  const {clicked, clickFrame} = guidePhase(frame, step.seconds * GUIDE_FPS);
  const target = targets[step.before];
  const pointerX = target.x + Math.min(target.width * 0.7, target.width - 15);
  const pointerY = target.y + target.height / 2;
  return <AbsoluteFill style={{background: "#f4f0e7", color: "#203e38", fontFamily: '"Segoe UI", Arial, sans-serif'}}>
    <div style={{position: "absolute", left: 72, top: 52, fontSize: 28, fontWeight: 700}}>отголосок <span style={{fontWeight: 400, color: "#778078"}}> / как пользоваться</span></div>
    <div style={{position: "absolute", right: 72, top: 56, fontSize: 23, color: "#68796d"}}>ГОТОВАЯ ПРОГУЛКА · {index + 1} / {GUIDE_STEPS.length}</div>
    <div style={{position: "absolute", left: 72, top: 200, width: 375, opacity: interpolate(frame, [0, 15], [0, 1], clamp), translate: `0 ${interpolate(frame, [0, 18], [14, 0], clamp)}px`}}>
      <div style={{color: "#b64b28", fontSize: 72, fontFamily: "Georgia, serif", marginBottom: 22}}>0{index + 1}</div>
      <h1 style={{fontSize: 51, lineHeight: 1.05, letterSpacing: -2, margin: "0 0 30px", fontWeight: 600}}>{step.title}</h1>
      <p style={{fontSize: 29, lineHeight: 1.45, margin: 0}}>{step.description}</p>
      <div style={{marginTop: 40, borderTop: "1px solid #cbd1c4", paddingTop: 24, fontSize: 25, lineHeight: 1.45, color: "#607166", opacity: interpolate(frame, [clickFrame + 10, clickFrame + 25], [0, 1], clamp)}}>{step.result}</div>
    </div>
    <div style={{position: "absolute", left: 510, top: 134, width: 1338, height: 836.25, borderRadius: 22, overflow: "hidden", border: "1px solid #d2d7ca", boxShadow: "0 22px 60px #193c3020", background: "#e8e8dc"}}>
      <div style={{width: 1280, height: 800, position: "absolute", transform: `scale(${1338 / 1280})`, transformOrigin: "0 0"}}>
        <div style={{position: "absolute", inset: 0, scale: step.zoom, transformOrigin: "640px 480px"}}>
          <Img src={staticFile(`guide/${clicked ? step.after : step.before}.png`)} style={{width: 1280, height: 800}} />
          {!clicked && <div style={{position: "absolute", left: target.x - 6, top: target.y - 6, width: target.width + 12, height: target.height + 12, border: "3px solid #b64b28", boxSizing: "border-box", borderRadius: 12, boxShadow: "0 0 0 5px #fff9", opacity: interpolate(frame, [20, 35], [0, 1], clamp)}} />}
          <svg width="38" height="48" viewBox="0 0 38 48" style={{position: "absolute", left: interpolate(frame, [28, 75], [pointerX + 90, pointerX], clamp), top: interpolate(frame, [28, 75], [pointerY + 75, pointerY], clamp), opacity: interpolate(frame, [20, 30, clickFrame + 8, clickFrame + 22], [0, 1, 1, 0], clamp), filter: "drop-shadow(0 2px 3px #0005)"}}><path d="M4 3 L4 35 L13 28 L21 43 L28 39 L20 25 L33 23 Z" fill="#fff" stroke="#203e38" strokeWidth="2.5" /></svg>
        </div>
      </div>
      {(clicked || step.before !== "catalog") && <div style={{position: "absolute", right: 10, top: 10, background: "#fffefaed", borderRadius: 5, padding: "4px 7px", fontSize: 14, color: "#203e38"}}>© OpenStreetMap</div>}
    </div>
    <div style={{position: "absolute", left: 510, top: 995, fontSize: 23, color: "#617366"}}>{clicked ? "Результат действия" : `Нажмите: ${step.action}`}</div>
    <div style={{position: "absolute", left: 72, bottom: 51, display: "flex", gap: 9}}>{GUIDE_STEPS.map((item, i) => <div key={item.id} style={{width: 42, height: 5, borderRadius: 3, background: i <= index ? "#b64b28" : "#d4d9cd"}} />)}</div>
  </AbsoluteFill>;
}
