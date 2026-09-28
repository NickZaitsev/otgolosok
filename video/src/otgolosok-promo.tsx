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
import {getSceneAt, SCENES} from "./timeline";

const paper = "#f5f1e8";
const cream = "#fffefa";
const green = "#203e38";
const terracotta = "#b64b28";
const muted = "#627169";
const sans = '"Manrope", "Segoe UI", Arial, sans-serif';
const serif = '"Cormorant Garamond", Georgia, serif';
const mapUrl = staticFile("data/maps/paveletskaya.svg");
const voiceUrl = staticFile("audio/walk/kozhevniki-d2ccb2df8e45.mp3");

const fill: CSSProperties = {width: "100%", height: "100%"};

function fade(frame: number, from: number, to: number) {
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function Rise({children, frame, delay = 0, style}: {
  children: ReactNode;
  frame: number;
  delay?: number;
  style?: CSSProperties;
}) {
  const progress = fade(frame, delay, delay + 18);
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 36}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Wordmark({light = false}: {light?: boolean}) {
  return (
    <div style={{fontFamily: serif, fontSize: 69, fontWeight: 700, letterSpacing: -3, color: light ? paper : green}}>
      Отголосок<span style={{color: terracotta}}>.</span>
    </div>
  );
}

function Topline({light = false, chapter}: {light?: boolean; chapter: string}) {
  return (
    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", color: light ? "#d9e4dc" : muted, font: `700 23px ${sans}`, letterSpacing: 3.2, textTransform: "uppercase"}}>
      <span>Москва · аудиопрогулка</span>
      <span>{chapter}</span>
    </div>
  );
}

function Intro({frame}: {frame: number}) {
  const ring = interpolate(frame, [0, 104], [0.84, 1.08], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{backgroundColor: green, color: paper, padding: "104px 84px 94px", fontFamily: sans}}>
      <Topline light chapter="01 / 04" />
      <div style={{position: "absolute", left: -230, top: 450, width: 1160, height: 1160, borderRadius: "50%", border: "2px solid #ffffff27", transform: `scale(${ring})`}} />
      <div style={{position: "absolute", left: 100, top: 780, width: 860, height: 860, borderRadius: "50%", border: "2px solid #ffffff30", transform: `scale(${ring})`}} />
      <div style={{position: "absolute", left: 505, top: 670, width: 22, height: 22, borderRadius: "50%", background: "#e69a75", boxShadow: "0 0 0 22px #b64b2840"}} />
      <div style={{position: "relative", marginTop: 430}}>
        <Rise frame={frame} delay={8}>
          <div style={{font: `600 28px ${sans}`, letterSpacing: 4, textTransform: "uppercase", color: "#e3aa8e", marginBottom: 42}}>Истории рядом</div>
        </Rise>
        <Rise frame={frame} delay={17}>
          <div style={{fontFamily: serif, fontSize: 170, fontWeight: 600, lineHeight: 0.91, letterSpacing: -6}}>Город<br />говорит.</div>
        </Rise>
        <Rise frame={frame} delay={38}>
          <div style={{fontSize: 39, lineHeight: 1.4, marginTop: 72, maxWidth: 780, color: "#d7e4db"}}>Там, где случилась история.</div>
        </Rise>
      </div>
      <div style={{position: "absolute", left: 84, bottom: 94, right: 84, display: "flex", alignItems: "end", justifyContent: "space-between"}}>
        <Wordmark light />
        <span style={{font: `600 26px ${sans}`, color: "#c3d6cb"}}>Листайте город →</span>
      </div>
    </AbsoluteFill>
  );
}

function MapScene({frame}: {frame: number}) {
  const mapScale = interpolate(frame, [0, 150], [1.15, 1.02], {extrapolateRight: "clamp"});
  const markerScale = interpolate(frame, [34, 49], [0.35, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{backgroundColor: paper, padding: "104px 84px 96px", fontFamily: sans, color: green}}>
      <Topline chapter="02 / 04" />
      <Rise frame={frame} delay={4} style={{marginTop: 118}}>
        <div style={{fontFamily: serif, fontSize: 132, fontWeight: 600, lineHeight: 0.93, letterSpacing: -5}}>Истории<br />рядом.</div>
      </Rise>
      <Rise frame={frame} delay={18}>
        <div style={{fontSize: 33, lineHeight: 1.38, color: muted, marginTop: 45}}>Короткая прогулка по Москве<br />от Кожевников к Цинделю.</div>
      </Rise>
      <div style={{position: "absolute", left: 84, right: 84, top: 655, height: 960, borderRadius: 48, overflow: "hidden", border: "2px solid #dce2da", background: cream, boxShadow: "0 34px 90px #203e3822"}}>
        <Img src={mapUrl} style={{width: "100%", height: "100%", objectFit: "cover", transform: `scale(${mapScale})`}} />
        <div style={{position: "absolute", left: 35, top: 34, background: cream, borderRadius: 999, padding: "20px 28px", font: `700 25px ${sans}`, boxShadow: "0 8px 26px #203e3822"}}>Павелецкая · 4 остановки</div>
        <div style={{position: "absolute", right: 40, bottom: 70, width: 110, height: 110, borderRadius: "50%", background: terracotta, color: cream, display: "grid", placeItems: "center", fontSize: 56, transform: `scale(${markerScale})`, boxShadow: "0 0 0 16px #b64b283b"}}>♫</div>
        <div style={{position: "absolute", left: 25, bottom: 15, font: `500 19px ${sans}`, color: "#57504a", background: "#f5f1e8e8", padding: "5px 9px"}}>© OpenStreetMap contributors</div>
      </div>
      <div style={{position: "absolute", left: 84, bottom: 105, font: `700 27px ${sans}`, letterSpacing: 2.5, textTransform: "uppercase", color: terracotta}}>Выберите маршрут · идите · слушайте</div>
    </AbsoluteFill>
  );
}

function Waveform({frame}: {frame: number}) {
  return (
    <div style={{height: 140, display: "flex", gap: 15, alignItems: "center"}}>
      {Array.from({length: 29}, (_, index) => {
        const height = 24 + Math.abs(Math.sin(index * 1.3 + frame * 0.1)) * (index % 3 === 0 ? 100 : 68);
        return <div key={index} style={{width: 15, height, borderRadius: 10, backgroundColor: index < Math.floor(frame / 6) ? "#e7ad8d" : "#778c7e"}} />;
      })}
    </div>
  );
}

function ListenScene({frame}: {frame: number}) {
  const halo = interpolate(frame, [0, 180], [0.88, 1.12], {extrapolateRight: "clamp"});
  return (
    <AbsoluteFill style={{backgroundColor: "#101c19", padding: "104px 84px 90px", color: paper, fontFamily: sans}}>
      <Topline light chapter="03 / 04" />
      <div style={{marginTop: 145, font: `700 29px ${sans}`, color: "#e7ad8d", letterSpacing: 3}}>ОСТАНОВКА 01 / 04</div>
      <Rise frame={frame} delay={5} style={{marginTop: 30}}>
        <div style={{fontFamily: serif, fontSize: 135, fontWeight: 600, lineHeight: 0.96}}>Кожевники.</div>
      </Rise>
      <Rise frame={frame} delay={18}>
        <div style={{fontSize: 38, lineHeight: 1.38, color: "#d2dfd5", marginTop: 55}}>История начинается<br />прямо здесь.</div>
      </Rise>
      <div style={{position: "absolute", left: 100, top: 760, width: 880, height: 880, borderRadius: "50%", border: "2px solid #b64b286b", transform: `scale(${halo})`}} />
      <div style={{position: "absolute", left: 200, top: 860, width: 680, height: 680, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #456356 0%, #203e38 60%, #152b25 100%)", display: "grid", placeItems: "center", boxShadow: "0 30px 110px #0008"}}>
        <span style={{font: `600 190px ${serif}`, color: "#f5f1e8"}}>01</span>
      </div>
      <div style={{position: "absolute", left: 84, right: 84, bottom: 100, background: "#263d34", borderRadius: 40, padding: "34px 42px 39px", boxShadow: "0 25px 65px #0005"}}>
        <div style={{display: "flex", justifyContent: "space-between", font: `700 25px ${sans}`, color: "#d6e0d7"}}><span>Сейчас звучит</span><span>▶</span></div>
        <Waveform frame={frame} />
        <div style={{height: 8, borderRadius: 8, background: "#789083", overflow: "hidden"}}><div style={{width: `${Math.min(100, frame / 180 * 100)}%`, height: "100%", background: "#e7ad8d"}} /></div>
      </div>
    </AbsoluteFill>
  );
}

function Outro({frame}: {frame: number}) {
  return (
    <AbsoluteFill style={{backgroundColor: paper, padding: "104px 84px 105px", color: green, fontFamily: sans}}>
      <Topline chapter="04 / 04" />
      <div style={{position: "absolute", left: 84, top: 410, right: 84}}>
        <Rise frame={frame} delay={5}>
          <div style={{fontFamily: serif, fontSize: 143, fontWeight: 600, lineHeight: 0.94, letterSpacing: -5}}>Слушайте<br />город.</div>
        </Rise>
        <Rise frame={frame} delay={22}>
          <div style={{height: 9, width: 180, borderRadius: 20, background: terracotta, marginTop: 75, marginBottom: 75}} />
        </Rise>
        <Rise frame={frame} delay={31}>
          <div style={{fontSize: 45, lineHeight: 1.35, maxWidth: 800}}>Проверенные истории<br />рядом с местом событий.</div>
        </Rise>
      </div>
      <div style={{position: "absolute", left: 84, bottom: 155}}>
        <Rise frame={frame} delay={45}>
          <Wordmark />
          <div style={{fontSize: 28, letterSpacing: 2.1, textTransform: "uppercase", color: terracotta, fontWeight: 700, marginTop: 16}}>Аудиогид по Москве</div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
}

export function OtgolosokPromo() {
  const frame = useCurrentFrame();
  const {id, localFrame} = getSceneAt(frame);
  const voiceStart = SCENES[1].start + 45;
  const voiceEnd = SCENES[3].start;

  return (
    <AbsoluteFill style={fill}>
      {id === "intro" && <Intro frame={localFrame} />}
      {id === "map" && <MapScene frame={localFrame} />}
      {id === "listen" && <ListenScene frame={localFrame} />}
      {id === "outro" && <Outro frame={localFrame} />}
      <Sequence from={voiceStart} durationInFrames={voiceEnd - voiceStart} name="Фрагмент истории">
        <Html5Audio
          src={voiceUrl}
          volume={(audioFrame) => Math.min(1, audioFrame / 12, (voiceEnd - voiceStart - audioFrame) / 21)}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
