import type {CSSProperties, ReactNode} from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import {AD_SCENES, getAdSceneAt} from "./ad-timeline";
import {pointOnRoute, ROUTE_LENGTH, ROUTE_PATH} from "./route-geometry";

const green = "#203e38";
const night = "#101b18";
const cream = "#fffefa";
const paper = "#f5f1e8";
const rust = "#b64b28";
const peach = "#f5b296";
const sans = '"Manrope", "Segoe UI", Arial, sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';

const city = staticFile("video/moscow-evening.webp");
const facade = staticFile("video/brick-facade.webp");
const map = staticFile("data/maps/paveletskaya.svg");
const story = staticFile("audio/walk/kozhevniki-d2ccb2df8e45.mp3");

function motion(frame: number, from: number, to: number) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function Reveal({children, frame, at = 0, style}: {
  children: ReactNode;
  frame: number;
  at?: number;
  style?: CSSProperties;
}) {
  const progress = motion(frame, at, at + 17);
  return (
    <div style={{opacity: progress, transform: `translate3d(0, ${(1 - progress) * 54}px, 0)`, ...style}}>
      {children}
    </div>
  );
}

function Photo({src, frame, shade = 0.15}: {src: string; frame: number; shade?: number}) {
  const scale = interpolate(frame, [0, 180], [1.04, 1.16], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill>
      <Img src={src} style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, objectPosition: "center center"}} />
      <AbsoluteFill style={{background: `linear-gradient(90deg, rgba(10,23,20,${Math.min(0.96, 0.78 + shade)}) 0%, rgba(10,23,20,${0.4 + shade}) 55%, rgba(10,23,20,${shade}) 100%), linear-gradient(0deg, #0a1716bb 0%, transparent 50%)`}} />
    </AbsoluteFill>
  );
}

function FilmLabel({right}: {right: string}) {
  return (
    <div style={{display: "flex", justifyContent: "space-between", width: "100%", font: `700 24px ${sans}`, letterSpacing: 3.8, textTransform: "uppercase", color: "#ffffffdd"}}>
      <span>Отголосок · Москва</span>
      <span>{right}</span>
    </div>
  );
}

function City({frame}: {frame: number}) {
  return (
    <AbsoluteFill style={{background: night, color: cream, padding: "106px 82px 94px", fontFamily: sans}}>
      <Photo src={city} frame={frame} />
      <div style={{position: "relative"}}><FilmLabel right="01 / 05" /></div>
      <div style={{position: "relative", marginTop: 195}}>
        <Reveal frame={frame} at={5}>
          <div style={{color: peach, fontSize: 28, fontWeight: 800, letterSpacing: 5, textTransform: "uppercase", marginBottom: 38}}>Наденьте наушники</div>
        </Reveal>
        <Reveal frame={frame} at={15}>
          <div style={{fontFamily: serif, fontSize: 168, fontWeight: 600, lineHeight: 0.9, letterSpacing: -5, textShadow: "0 8px 40px #0008"}}>У города<br />есть голос.</div>
        </Reveal>
      </div>
      <div style={{position: "absolute", left: 82, bottom: 115, display: "flex", alignItems: "center", gap: 24, color: cream}}>
        <span style={{display: "inline-block", width: 76, height: 2, background: peach}} />
        <span style={{fontSize: 28, fontWeight: 700, letterSpacing: 1.4}}>Сделайте первый шаг</span>
      </div>
    </AbsoluteFill>
  );
}

function Facade({frame}: {frame: number}) {
  return (
    <AbsoluteFill style={{background: night, color: cream, padding: "106px 82px 94px", fontFamily: sans}}>
      <Photo src={facade} frame={frame} shade={0.06} />
      <div style={{position: "relative"}}><FilmLabel right="02 / 05" /></div>
      <div style={{position: "relative", marginTop: 305}}>
        <Reveal frame={frame} at={4}>
          <div style={{fontFamily: serif, fontSize: 141, fontWeight: 600, lineHeight: 0.96, letterSpacing: -3}}>У каждого<br />места —<br />история.</div>
        </Reveal>
        <Reveal frame={frame} at={32}>
          <div style={{fontSize: 38, lineHeight: 1.4, maxWidth: 780, marginTop: 72, color: "#f4efe6"}}>Откройте её там,<br />где она случилась.</div>
        </Reveal>
      </div>
      <div style={{position: "absolute", bottom: 110, left: 82, fontSize: 27, fontWeight: 800, letterSpacing: 3.6, textTransform: "uppercase", color: peach}}>01: слушайте место</div>
    </AbsoluteFill>
  );
}

function Route({frame}: {frame: number}) {
  const progress = motion(frame, 36, 151);
  const point = pointOnRoute(progress);
  const cardY = interpolate(frame, [0, 24], [76, 0], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: green, color: cream, padding: "102px 82px 75px", fontFamily: sans}}>
      <FilmLabel right="03 / 05" />
      <Reveal frame={frame} at={5} style={{marginTop: 90}}>
        <div style={{fontFamily: serif, fontSize: 102, fontWeight: 600, lineHeight: 0.96}}>Маршрут ведёт.<br />Город звучит.</div>
      </Reveal>
      <div style={{position: "absolute", top: 550, left: 82, right: 82, height: 1040, background: paper, borderRadius: 46, padding: 28, transform: `translateY(${cardY}px)`, boxShadow: "0 40px 110px #0b1b1766"}}>
        <div style={{position: "relative", width: "100%", height: 860, borderRadius: 29, overflow: "hidden"}}>
          <Img src={map} style={{width: "100%", height: "100%", objectFit: "cover"}} />
          <svg viewBox="0 0 400 400" style={{position: "absolute", inset: 0, width: "100%", height: "100%"}} aria-hidden="true">
            <path d={ROUTE_PATH} fill="none" stroke="#ffd4a8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${ROUTE_LENGTH} ${ROUTE_LENGTH}`} strokeDashoffset={ROUTE_LENGTH * (1 - progress)} />
            <circle cx={point.x} cy={point.y} r="12" fill={rust} stroke={cream} strokeWidth="5" />
          </svg>
          <div style={{position: "absolute", left: 22, top: 23, background: cream, color: green, borderRadius: 100, padding: "16px 22px", font: `800 23px ${sans}`, boxShadow: "0 6px 22px #203e382a"}}>Павелецкая · прогулка</div>
          <div style={{position: "absolute", left: 16, bottom: 12, background: "#f5f1e8e8", color: "#57504a", font: `600 18px ${sans}`, padding: "3px 6px"}}>© OpenStreetMap contributors</div>
        </div>
        <div style={{color: green, font: `700 27px ${sans}`, padding: "42px 10px 0"}}>От Кожевников к Цинделю <span style={{color: rust}}>↗</span></div>
      </div>
      <div style={{position: "absolute", bottom: 88, left: 82, right: 82, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
        <div><span style={{font: `700 66px ${serif}`}}>04</span><span style={{fontSize: 29, marginLeft: 15}}>остановки</span></div>
        <div style={{fontSize: 29}}>15 минут пешком <span style={{color: peach}}>↗</span></div>
      </div>
    </AbsoluteFill>
  );
}

function Bars({frame}: {frame: number}) {
  return (
    <div style={{display: "flex", gap: 9, alignItems: "center", height: 134}}>
      {Array.from({length: 32}, (_, index) => {
        const height = 19 + Math.abs(Math.sin(index * 1.07 + frame * 0.11)) * (index % 4 === 0 ? 104 : 69);
        return <div key={index} style={{width: 10, height, borderRadius: 9, background: index < frame / 5.7 ? peach : "#85a99a"}} />;
      })}
    </div>
  );
}

function Listen({frame}: {frame: number}) {
  const halo = interpolate(frame, [0, 195], [0.89, 1.17], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: night, color: cream, padding: "102px 82px 85px", fontFamily: sans}}>
      <Photo src={facade} frame={frame} shade={0.25} />
      <div style={{position: "relative"}}><FilmLabel right="04 / 05" /></div>
      <div style={{position: "relative", marginTop: 170}}>
        <Reveal frame={frame} at={4}><div style={{font: `800 27px ${sans}`, letterSpacing: 4, color: peach}}>ВЫ У МЕСТА</div></Reveal>
        <Reveal frame={frame} at={14}><div style={{fontFamily: serif, fontSize: 133, fontWeight: 600, lineHeight: 0.95, marginTop: 36}}>Теперь<br />послушайте.</div></Reveal>
      </div>
      <div style={{position: "absolute", top: 715, left: 185, width: 710, height: 710, borderRadius: "50%", border: "2px solid #f5b29675", transform: `scale(${halo})`}} />
      <div style={{position: "absolute", top: 833, left: 305, width: 470, height: 470, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #4e705e, #203e38 65%, #142925)", boxShadow: "0 30px 120px #000a", display: "grid", placeItems: "center", font: `600 160px ${serif}`}}>01</div>
      <div style={{position: "absolute", left: 82, right: 82, bottom: 112, borderRadius: 41, padding: "38px 42px 34px", background: "#203e38eb", boxShadow: "0 28px 75px #0008"}}>
        <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 30, fontWeight: 700}}><span>Кожевники</span><span style={{color: peach, fontSize: 41}}>Ⅱ</span></div>
        <div style={{fontSize: 23, color: "#d6e5da", marginTop: 6}}>Фрагмент истории</div>
        <Bars frame={frame} />
        <div style={{height: 7, borderRadius: 8, background: "#83a99a", overflow: "hidden"}}><div style={{height: "100%", width: `${Math.min(100, frame / 195 * 100)}%`, background: peach}} /></div>
      </div>
    </AbsoluteFill>
  );
}

function Brand({frame}: {frame: number}) {
  const circle = interpolate(frame, [0, 135], [0.66, 1.2], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{background: green, color: cream, padding: "105px 82px", fontFamily: sans}}>
      <Photo src={city} frame={frame} shade={0.3} />
      <div style={{position: "absolute", width: 1030, height: 1030, left: 25, top: 440, border: "2px solid #f5b29680", borderRadius: "50%", transform: `scale(${circle})`}} />
      <div style={{position: "relative"}}><FilmLabel right="05 / 05" /></div>
      <div style={{position: "relative", marginTop: 570, textAlign: "center"}}>
        <Reveal frame={frame} at={6}>
          <div style={{fontFamily: serif, fontSize: 141, fontWeight: 700, letterSpacing: -5, whiteSpace: "nowrap", textShadow: "0 12px 50px #000b"}}>Отголосок<span style={{color: peach}}>.</span></div>
        </Reveal>
        <Reveal frame={frame} at={27}>
          <div style={{fontSize: 39, lineHeight: 1.44, marginTop: 48}}>Город говорит там,<br />где случилась история.</div>
        </Reveal>
        <Reveal frame={frame} at={51}>
          <div style={{display: "inline-block", marginTop: 98, padding: "29px 53px", borderRadius: 100, background: cream, color: green, fontSize: 30, fontWeight: 800, boxShadow: "0 16px 50px #0006"}}>Открыть аудиопрогулку ↗</div>
        </Reveal>
      </div>
      <div style={{position: "absolute", bottom: 95, left: 82, right: 82, textAlign: "center", fontSize: 23, fontWeight: 700, letterSpacing: 3.5, textTransform: "uppercase"}}>Москва · истории рядом с вами</div>
    </AbsoluteFill>
  );
}

function CutAccent({frame}: {frame: number}) {
  const starts = AD_SCENES.slice(1).map(({start}) => start);
  const cut = starts.find((start) => frame >= start && frame < start + 11);
  if (cut === undefined) return null;
  const progress = motion(frame - cut, 0, 11);
  return (
    <div style={{position: "absolute", top: 0, bottom: 0, left: `${progress * 110 - 12}%`, width: 14, transform: "skewX(-14deg)", background: peach, opacity: 0.65, boxShadow: "0 0 38px #f5b2968c"}} />
  );
}

export function OtgolosokAd() {
  const frame = useCurrentFrame();
  const {id, localFrame} = getAdSceneAt(frame);
  const listenStart = AD_SCENES[3].start;
  const listenDuration = AD_SCENES[3].end - listenStart;

  return (
    <AbsoluteFill style={{background: night}}>
      {id === "city" && <City frame={localFrame} />}
      {id === "facade" && <Facade frame={localFrame} />}
      {id === "route" && <Route frame={localFrame} />}
      {id === "listen" && <Listen frame={localFrame} />}
      {id === "brand" && <Brand frame={localFrame} />}
      <CutAccent frame={frame} />
      <Html5Audio src={staticFile("video/ad-bed.wav")} volume={0.48} />
      <Sequence from={listenStart} durationInFrames={listenDuration} name="Фрагмент истории">
        <Html5Audio src={story} volume={(audioFrame) => Math.min(1, audioFrame / 10, (listenDuration - audioFrame) / 18)} />
      </Sequence>
    </AbsoluteFill>
  );
}
