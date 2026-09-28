import {loadFont} from "@remotion/fonts";
import {staticFile} from "remotion";

// Фирменные шрифты из DESIGN.md. Файлы @fontsource копируются в public
// при подготовке ресурсов, поэтому рендер не зависит от сети.
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

export const SANS = '"Manrope", "Segoe UI", Arial, sans-serif';
export const SERIF = '"Cormorant Garamond", Georgia, serif';

const faces = [
  ...["400", "600", "700"].map(weight => ({family: "Manrope", file: "manrope", weight, style: "normal"})),
  ...["500", "600"].map(weight => ({family: "Cormorant Garamond", file: "cormorant-garamond", weight, style: "normal"})),
  // Настоящий курсив для акцентных строк моушн-ролика вместо синтетического наклона.
  {family: "Cormorant Garamond", file: "cormorant-garamond", weight: "600", style: "italic"},
];

// loadFont сам задерживает рендер до загрузки и прерывает его при ошибке.
for (const {family, file, weight, style} of faces) {
  void loadFont({family, weight, style, url: staticFile(`fonts/${file}-cyrillic-${weight}-${style}.woff2`), unicodeRange: CYRILLIC});
  void loadFont({family, weight, style, url: staticFile(`fonts/${file}-latin-${weight}-${style}.woff2`), unicodeRange: LATIN});
}
