// Rasterizes src/app/icon.svg into the PNG icons that installed apps need:
// iOS ignores SVG touch icons, and maskable icons must be full-bleed because
// the launcher applies its own mask. Also writes the Android app launcher icons
// and splash screens (mobile/android), the same set for the Flutter app (mobile-flutter/android),
// the walk-service notification icon and the basemap icons of the Flutter map
// (mobile-flutter/assets/map/icons, drawn from map-icons.ts exactly like the site draws them).
// Run after changing the logo or MAP_ICONS:
//   node scripts/build-app-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { MAP_ICONS } from "../src/features/explore/map-icons.ts";

const source = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const rounded = /\s*<rect width="512" height="512" rx="\d+" fill="([^"]+)"\/>/i;
const background = source.match(rounded);
if (!background) throw new Error("icon.svg: the 512×512 background <rect rx> is missing; update the icon variants");
const fullBleed = source.replace(/\srx="\d+"/, "");
// The glyph alone, on a 108dp adaptive-icon canvas whose visible 72dp middle maps to the 512 box.
const adaptiveForeground = source.replace(rounded, "").replace(/viewBox="[^"]*"/, 'viewBox="-128 -128 768 768"');
const roundIcon = source.replace(rounded, `<circle cx="256" cy="256" r="256" fill="${background[1]}"/>`);

// Status-bar icons are white silhouettes: the rings and the dot without the background.
const notificationIcon = source.replace(rounded, "")
  .replace(/stroke="#[0-9a-f]{6}"/gi, 'stroke="#ffffff"').replace(/fill="#b84b2c"/gi, 'fill="#ffffff"');

const splashBackground = "#eee9df";
const androidRes = "../mobile/android/app/src/main/res/";
const flutterRes = "../mobile-flutter/android/app/src/main/res/";
const walkServiceRes = "../mobile-flutter/packages/walk_service/android/src/main/res/";
const flutterMapIcons = "../mobile-flutter/assets/map/icons/";
const densities = [
  { name: "mdpi", scale: 1 },
  { name: "hdpi", scale: 1.5 },
  { name: "xhdpi", scale: 2 },
  { name: "xxhdpi", scale: 3 },
  { name: "xxxhdpi", scale: 4 },
];

const icons = [
  { file: "../public/icons/icon-192.png", size: 192, svg: source },
  { file: "../public/icons/icon-512.png", size: 512, svg: source },
  { file: "../public/icons/maskable-512.png", size: 512, svg: fullBleed },
  // iOS rounds the corners itself and fills transparency with black.
  { file: "../public/icons/apple-touch-icon.png", size: 180, svg: fullBleed },
  ...densities.flatMap(({ name, scale }) => [
    // Pre-Android 8 launchers use these; newer ones build the icon from mipmap-anydpi-v26.
    { file: `${androidRes}mipmap-${name}/ic_launcher.png`, size: 48 * scale, svg: source },
    { file: `${androidRes}mipmap-${name}/ic_launcher_round.png`, size: 48 * scale, svg: roundIcon },
    { file: `${androidRes}mipmap-${name}/ic_launcher_foreground.png`, size: 108 * scale, svg: adaptiveForeground },
    // Splash for Android < 12 (the SplashScreen plugin shows @drawable/splash); the app is portrait-only.
    { file: `${androidRes}drawable-port-${name}/splash.png`, width: 320 * scale, height: 480 * scale, splash: true },
  ]),
  { file: `${androidRes}drawable/splash.png`, width: 320, height: 480, splash: true },
  // Flutter app: launcher icons only; Android 12+ draws its own splash from the launch theme.
  ...densities.flatMap(({ name, scale }) => [
    { file: `${flutterRes}mipmap-${name}/ic_launcher.png`, size: 48 * scale, svg: source },
    { file: `${flutterRes}mipmap-${name}/ic_launcher_round.png`, size: 48 * scale, svg: roundIcon },
    { file: `${flutterRes}mipmap-${name}/ic_launcher_foreground.png`, size: 108 * scale, svg: adaptiveForeground },
    { file: `${flutterRes}drawable-${name}/splash_logo.png`, size: 96 * scale, svg: source },
    { file: `${walkServiceRes}drawable-${name}/ic_stat_otgolosok.png`, size: 24 * scale, svg: notificationIcon },
  ]),
];

// Flutter resolution-aware assets: 1x in the folder itself, 2x and 3x in "2.0x" and "3.0x".
const mapIconScales = [{ dir: "", scale: 1 }, { dir: "2.0x/", scale: 2 }, { dir: "3.0x/", scale: 3 }];
const mapIcons = Object.entries(MAP_ICONS).flatMap(([name, icon]) => mapIconScales.map(({ dir, scale }) => ({
  file: `${flutterMapIcons}${dir}poi-${name}.png`, size: 24 * scale, svg: mapIconSvg(icon) })));
icons.push(...mapIcons);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of icons) {
    const width = icon.width ?? icon.size;
    const height = icon.height ?? icon.size;
    const target = new URL(icon.file, import.meta.url);
    await page.setViewportSize({ width, height });
    await page.setContent(icon.splash ? splashHtml(width, height) : iconHtml(icon.svg, icon.size));
    const png = await page.screenshot({ omitBackground: !icon.splash, clip: { x: 0, y: 0, width, height } });
    await mkdir(new URL(".", target), { recursive: true });
    await writeFile(target, png);
    console.log(`${icon.file.replace(/^\.\.\//, "")}: ${width}×${height}`);
  }
} finally {
  await browser.close();
}

function iconHtml(svg, size) {
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  return `<style>*{margin:0}svg{display:block}</style>${sized}`;
}

/** The same picture drawMapIcon paints on a canvas: a white glyph on a coloured disc with a white border. */
function mapIconSvg({ color, glyph }) {
  const border = 1.5;
  const offset = (24 - 13) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="${12 - border}" fill="${color}" stroke="#ffffff" stroke-width="${border}"/>`
    + `<path transform="translate(${offset} ${offset}) scale(${13 / 15})" fill="#ffffff" d="${glyph}"/></svg>`;
}

function splashHtml(width, height) {
  const logo = Math.round(Math.min(width, height) * 0.3);
  const sized = source.replace("<svg ", `<svg width="${logo}" height="${logo}" `);
  return `<style>*{margin:0}body{width:${width}px;height:${height}px;display:grid;place-items:center;background:${splashBackground}}svg{display:block}</style>${sized}`;
}
