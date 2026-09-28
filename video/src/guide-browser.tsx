import type {CSSProperties, ReactNode} from "react";
import {Img, staticFile} from "remotion";
import {PAGE_HEIGHT, PAGE_WIDTH, screenScale, type Camera, type Viewport} from "./guide-camera";
import {SANS} from "./guide-fonts";

export const CHROME_HEIGHT = 44;
export const VIEWPORT: Viewport = {width: 1248, height: 780};
export const WINDOW_LEFT = 600;
export const WINDOW_TOP = 132;

// Экраны без карты OpenStreetMap: для них подпись об авторстве не нужна.
const NON_MAP_SCREENS = new Set(["history", "catalog"]);

export function Screen({name, camera, opacity = 1}: {name: string; camera: Camera; opacity?: number}) {
  const scale = screenScale(camera, VIEWPORT);
  return <div style={{position: "absolute", left: 0, top: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, opacity, transformOrigin: "0 0",
    transform: `translate(${VIEWPORT.width / 2 - camera.cx * scale}px, ${VIEWPORT.height / 2 - camera.cy * scale}px) scale(${scale})`}}>
    <Img src={staticFile(`guide/${name}.png`)} style={{width: PAGE_WIDTH, height: PAGE_HEIGHT, display: "block"}} />
  </div>;
}

export function Attribution({screens}: {screens: string[]}) {
  if (screens.every(name => NON_MAP_SCREENS.has(name))) return null;
  return <div style={{position: "absolute", right: 12, bottom: 12, padding: "5px 10px", borderRadius: 8, background: "#fffefae6", color: "#203e38", fontFamily: SANS, fontSize: 15}}>
    © участники OpenStreetMap
  </div>;
}

export function BrowserWindow({page, children, style}: {page: string; children: ReactNode; style?: CSSProperties}) {
  return <div style={{position: "absolute", left: WINDOW_LEFT, top: WINDOW_TOP, width: VIEWPORT.width, borderRadius: 18, overflow: "hidden", background: "#fffefa",
    boxShadow: "0 2px 0 #ffffff inset, 0 30px 80px #1a2f2833, 0 8px 22px #1a2f281f", border: "1px solid #d9ddd2", ...style}}>
    <div style={{height: CHROME_HEIGHT, background: "#ece7dd", display: "flex", alignItems: "center", padding: "0 18px", borderBottom: "1px solid #dcd6ca"}}>
      <div style={{display: "flex", gap: 8}}>{["#e0826f", "#e5c07b", "#8fbf8a"].map(color => <div key={color} style={{width: 13, height: 13, borderRadius: 7, background: color}} />)}</div>
      <div style={{margin: "0 auto", transform: "translateX(-26px)", width: 480, height: 28, borderRadius: 14, background: "#fffefa", border: "1px solid #dcd6ca",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#627169", fontFamily: SANS, fontSize: 16}}>
        Отголосок — {page}
      </div>
    </div>
    <div style={{position: "relative", width: VIEWPORT.width, height: VIEWPORT.height, overflow: "hidden", background: "#e8e6dc"}}>{children}</div>
  </div>;
}

export function Cursor({x, y, scale, opacity}: {x: number; y: number; scale: number; opacity: number}) {
  // Кончик стрелки находится в точке (4, 3) рисунка.
  return <svg width="34" height="44" viewBox="0 0 38 48" style={{position: "absolute", left: x - 4, top: y - 3, opacity, scale: String(scale), transformOrigin: "4px 3px",
    filter: "drop-shadow(0 3px 4px #0006)"}}>
    <path d="M4 3 L4 35 L13 28 L21 43 L28 39 L20 25 L33 23 Z" fill="#fff" stroke="#1d2b27" strokeWidth="2.5" strokeLinejoin="round" />
  </svg>;
}
