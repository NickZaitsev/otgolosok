// Rasterizes src/app/icon.svg into the PNG icons that installed apps need:
// iOS ignores SVG touch icons, and maskable icons must be full-bleed because
// the launcher applies its own mask. Also writes the Android app launcher icons
// and splash screens (mobile/android). Run after changing the logo:
//   node scripts/build-app-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const source = await readFile(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const rounded = /\s*<rect width="512" height="512" rx="\d+" fill="(#[0-9a-f]{6})"\/>/i;
const background = source.match(rounded);
if (!background) throw new Error("icon.svg: the 512×512 background <rect rx> is missing; update the icon variants");
const fullBleed = source.replace(/\srx="\d+"/, "");
// The glyph alone, on a 108dp adaptive-icon canvas whose visible 72dp middle maps to the 512 box.
const adaptiveForeground = source.replace(rounded, "").replace(/viewBox="[^"]*"/, 'viewBox="-128 -128 768 768"');
const roundIcon = source.replace(rounded, `<circle cx="256" cy="256" r="256" fill="${background[1]}"/>`);

const splashBackground = "#eee9df";
const androidRes = "../mobile/android/app/src/main/res/";
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
];

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

function splashHtml(width, height) {
  const logo = Math.round(Math.min(width, height) * 0.3);
  const sized = source.replace("<svg ", `<svg width="${logo}" height="${logo}" `);
  return `<style>*{margin:0}body{width:${width}px;height:${height}px;display:grid;place-items:center;background:${splashBackground}}svg{display:block}</style>${sized}`;
}
