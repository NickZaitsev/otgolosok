/**
 * Basemap icons: a white glyph on a category-coloured disc, drawn on demand when MapLibre asks for a missing image.
 * Glyphs are Pinhead map icons (CC0, https://github.com/waysidemapping/pinhead) on a 15×15 grid; being generated
 * in the browser, they need no sprite download and no extra CSP source.
 */
export const MAP_ICONS = {
  // Pinhead coffee_mug.svg; colour matches --muted in tokens.css.
  foodCoffee: { color: "#57504a", glyph: "M10.91 3L10.91 4.21L11.39 4.11C13.25 3.72 15 5.14 15 7.05L15 8.33C15 10.19 13.34 11.6 11.51 11.29L10.84 11.18C10.6 12.12 9.74 12.82 8.73 12.82L2.18 12.82C0.98 12.82 0 11.84 0 10.64L0 3L10.91 3ZM11.72 5.71L10.91 5.88L10.91 9.53L11.78 9.68C12.61 9.82 13.36 9.18 13.36 8.33L13.36 7.05C13.36 6.18 12.57 5.54 11.72 5.71Z" },
  // Pinhead fork_beside_table_knife.svg; colour matches --teal in tokens.css.
  foodMeal: { color: "#1f6f6b", glyph: "M3.5 0l-0.5 5.5c-0.15 0.81 1.78 1.18 1.75 2l-0.25 6.5c-0.04 1 1 1 1 1s1.04 0 1 -1l-0.25 -6.5c-0.03 -0.82 1.73 -1.18 1.75 -2l-0.5 -5.5h-0.5l-0.25 4l-0.75 0.5l-0.25 -4.5h-0.5l-0.25 4.5l-0.75 -0.5l-0.25 -4zm8.5 0c-0.74 0 -1.96 0.65 -2.46 1.64c-0.4 0.73 -0.54 2.38 -0.54 3.36v2.5c0 0.82 1.09 1 1.5 1l-0.5 5.5c-0.09 1 1 1 1 1s1 0 1 -1z" },
  // Pinhead burger.svg; colour matches --map-orange in tokens.css.
  foodSnack: { color: "#b64b28", glyph: "M14 8c0 0.55 -0.45 1 -1 1H2C1.45 9 1 8.55 1 8s0.45 -1 1 -1h11C13.55 7 14 7.45 14 8zM3.5 10H2c0 1.66 1.34 3 3 3h5c1.66 0 3 -1.34 3 -3H3.5zM3 6H2V4c0 -1.1 0.9 -2 2 -2h7c1.1 0 2 0.9 2 2v2H3zM11 4.5C11 4.78 11.22 5 11.5 5S12 4.78 12 4.5S11.78 4 11.5 4S11 4.22 11 4.5zM9 3.5C9 3.78 9.22 4 9.5 4S10 3.78 10 3.5S9.78 3 9.5 3S9 3.22 9 3.5zM7 4.5C7 4.78 7.22 5 7.5 5S8 4.78 8 4.5S7.78 4 7.5 4S7 4.22 7 4.5zM5 3.5C5 3.78 5.22 4 5.5 4S6 3.78 6 3.5S5.78 3 5.5 3S5 3.22 5 3.5zM3 4.5C3 4.78 3.22 5 3.5 5S4 4.78 4 4.5S3.78 4 3.5 4S3 4.22 3 4.5z" },
  // Pinhead wine_glass.svg; colour matches --map-green in tokens.css.
  foodBar: { color: "#203e38", glyph: "M8.18 12.95C8.18 11.59 8.18 10.23 8.18 8.86C11.82 7.95 12.27 5 9.54 0L5.45 0C2.73 5 3.18 7.95 6.82 8.86C6.82 10.23 6.82 11.59 6.82 12.95L4.03 14.63C3.93 14.69 3.9 14.81 3.96 14.9C3.99 14.96 4.06 15 4.13 15L10.87 15C10.98 15 11.07 14.91 11.07 14.8C11.07 14.73 11.03 14.66 10.97 14.63L8.18 12.95L8.18 12.95Z" },
  // A plain bold "М" like the Yandex metro sign; not the Moscow Metro logo, which is a trademark.
  station: { color: "#d8262c", glyph: "M1.5 13.5L1.5 1.5L4.5 1.5L7.5 8L10.5 1.5L13.5 1.5L13.5 13.5L11 13.5L11 6.2L8.6 11.5L6.4 11.5L4 6.2L4 13.5Z" },
  orthodox: { color: "#8c7358", glyph: "M8.5 0L8.5 2L10.5 2L10.5 3.5L8.5 3.5L8.5 5L12.5 5L12.5 7L8.5 7L8.5 10.54L11 11.5L10.5 13L8.5 12.23L8.5 15L6.5 15L6.5 11.46L4 10.5L4.5 9L6.5 9.77L6.5 7L2.5 7L2.5 5L6.5 5L6.5 3.5L4.5 3.5L4.5 2L6.5 2L6.5 0z" },
  church: { color: "#8c7358", glyph: "M6 0L6 4L2 4L2 7L6 7L6 15L9 15L9 7L13 7L13 4L9 4L9 0z" },
  synagogue: { color: "#8c7358", glyph: "M7.5 0.5L9.67 4L14 4L11.83 7.5L14 11L9.67 11L7.5 14.5L5.33 11L1 11L3.17 7.5L1 4L5.33 4L7.5 0.5ZM8.49 11L6.51 11L7.5 12.6L8.49 11ZM3.76 8.45L2.8 10L4.71 10L3.76 8.45ZM9.11 5L5.89 5L4.34 7.5L5.89 10L9.11 10L10.66 7.5L9.11 5ZM11.25 8.45L10.29 10L12.2 10L11.25 8.45ZM4.71 5L2.8 5L3.76 6.55L4.71 5ZM12.2 5L10.29 5L11.25 6.55L12.2 5ZM7.5 2.4L6.51 4L8.49 4L7.5 2.4Z" },
  mosque: { color: "#8c7358", glyph: "M12.1 12.1C9.56 14.63 5.44 14.63 2.9 12.1C0.37 9.56 0.37 5.44 2.9 2.9C5.44 0.37 9.56 0.37 12.1 2.9C12.27 3.08 12.43 3.25 12.58 3.44C10.56 1.86 7.63 2 5.78 3.86C3.77 5.87 3.77 9.13 5.78 11.14C7.63 13 10.56 13.14 12.58 11.56C12.43 11.75 12.27 11.92 12.1 12.1ZM10.1 6.5H8L9.7 8L9 10.5L11 9L13 10.5L12.3 8L14 6.5H11.9L11 4.5L10.1 6.5Z" },
  theatre: { color: "#b0527a", glyph: "M2 1c0 0 -1 0 -1 1v5.16C1 8.89 1.35 11 4.5 11H5V8L2.5 9c0 0 0 -2.5 2.5 -2.5V5c0 -0.71 0.09 -1.32 0.5 -1.78C5.88 2.81 6.5 1.97 8.16 2.75L9 3.3V2c0 0 0 -1 -1 -1C7.29 1 6.02 2 5 2S2.79 1 2 1zM3 3c0.55 0 1 0.45 1 1S3.55 5 3 5S2 4.55 2 4S2.45 3 3 3zM7 4c0 0 -1 0 -1 1v5c0 2 1 4 4 4s4 -2 4 -4V5c0 -1 -1 -1 -1 -1c-0.71 0 -1.98 1 -3 1S7.79 4 7 4zM8 6c0.55 0 1 0.45 1 1S8.55 8 8 8S7 7.55 7 7S7.45 6 8 6zM12 6c0.55 0 1 0.45 1 1s-0.45 1 -1 1s-1 -0.45 -1 -1S11.45 6 12 6zM7.5 10H10h2.5c0 0 0 2.5 -2.5 2.5S7.5 10 7.5 10z" },
  viewpoint: { color: "#3d9160", glyph: "M11 2.5C12 4 12 4 12.5 5.34C13 6.5 13 10.5 13 10.5C13 11 9 11 9 10.5C9 9.5 9 9.5 9 9.5C9 9 8.5 8.5 8.5 8L8.5 7.5L6.5 7.5L6.5 8C6.5 8.5 6 9 6 9.5L6 10.5C6 11 2 11 2 10.5C2 10.5 2 6.5 2.5 5.34C3 4 3 4 4 2.5C4 2 6 2 6 2.5L6 3.5L9 3.5C9 3.5 9 3 9 2.5C9 2 11 2 11 2.5zM2.5 11.5C1 11.5 1 14 2.5 14C2.5 14 5.5 14 5.5 14C7 14 7 11.5 5.5 11.5C5.5 11.5 2.5 11.5 2.5 11.5zM9.5 11.5C8 11.5 8 14 9.5 14C9.5 14 12.5 14 12.5 14C14 14 14 11.5 12.5 11.5C12.5 11.5 9.5 11.5 9.5 11.5zM4.5 1C3.75 1 3.75 2 4.5 2L5.5 2C6.25 2 6.25 1 5.5 1C5.5 1 4.5 1 4.5 1zM9.5 1C8.75 1 8.75 2 9.5 2C9.5 2 10.5 2 10.5 2C11.25 2 11.25 1 10.5 1C10.5 1 9.5 1 9.5 1z" },
  monument: { color: "#9a7a4c", glyph: "M9 9L9 11.5L6 11.5L6 9L4.73 9C4.45 9 4.23 8.78 4.23 8.5C4.23 8.44 4.24 8.38 4.26 8.32L5.86 5.03C5.95 4.86 6.12 4.75 6.31 4.75L8.69 4.75C8.88 4.75 9.05 4.86 9.14 5.03L10.74 8.32C10.84 8.58 10.71 8.87 10.45 8.97C10.4 8.99 10.34 9 10.27 9L9 9ZM11 12L11 13L12 13L12 14L3 14L3 13L4 13L4 12L11 12ZM7.5 1C8.33 1 9 1.67 9 2.5C9 3.33 8.33 4 7.5 4C6.67 4 6 3.33 6 2.5C6 1.67 6.67 1 7.5 1Z" },
  memorial: { color: "#9a7a4c", glyph: "M13.5 13L14 15L1 15L1.5 13L13.5 13ZM7.5 0C9.5 0 11 1 12 3L12 12.5L3 12.5L3 3C4 1 5.5 0 7.5 0ZM9.5 8L5.5 8L5.5 9L9.5 9L9.5 8ZM10.5 6L4.5 6L4.5 7L10.5 7L10.5 6ZM9 4L6 4L6 5L9 5L9 4Z" },
  toilets: { color: "#7a8591", glyph: "M5.67 3.46L3.33 3.46L1 11.54L3.33 11.54L3.33 15L5.67 15L5.67 11.54L8 11.54L5.67 3.46ZM4.73 2.31L4.27 2.31C3.68 2.31 3.33 1.96 3.33 1.38L3.33 0.92C3.33 0.35 3.68 0 4.27 0L4.85 0C5.32 0 5.67 0.35 5.67 0.92L5.67 1.5C5.67 1.96 5.32 2.31 4.73 2.31ZM12.83 3.53L8.21 3.53L8.21 9.3L9.36 9.3L9.36 15.07L11.67 15.07L11.67 9.3L12.83 9.3L12.83 3.53ZM10.73 2.31L10.27 2.31C9.68 2.31 9.33 1.96 9.33 1.38L9.33 0.92C9.33 0.35 9.68 0 10.27 0L10.85 0C11.32 0 11.67 0.35 11.67 0.92L11.67 1.5C11.67 1.96 11.32 2.31 10.73 2.31Z" },
  // A plain drop: the Pinhead tap-and-cup glyph sat off-centre and blurred into a smudge at map size.
  water: { color: "#3a9fcf", glyph: "M7.5 1C7.5 1 3 6.2 3 9.5A4.5 4.5 0 0 0 12 9.5C12 6.2 7.5 1 7.5 1Z" },
} as const satisfies Record<string, { color: string; glyph: string }>;

export type MapIcon = keyof typeof MAP_ICONS;

const PREFIX = "poi-";
/** The image id a style layer uses for an icon. */
export const mapIconId = (icon: MapIcon) => `${PREFIX}${icon}`;

/** Device pixels per CSS pixel the icons are drawn at; MapLibre scales them for other screens. */
export const MAP_ICON_PIXEL_RATIO = 2;
const SIZE = 24 * MAP_ICON_PIXEL_RATIO;
const GLYPH = 13 * MAP_ICON_PIXEL_RATIO;

/**
 * Draw the image MapLibre reported missing, or null if it is not one of ours (or the browser cannot draw),
 * so the basemap simply leaves that symbol without an icon.
 */
export function drawMapIcon(id: string): ImageData | null {
  if (!id.startsWith(PREFIX)) return null;
  const icon = MAP_ICONS[id.slice(PREFIX.length) as MapIcon] as (typeof MAP_ICONS)[MapIcon] | undefined;
  if (!icon) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const border = 1.5 * MAP_ICON_PIXEL_RATIO;
  context.beginPath();
  context.arc(SIZE / 2, SIZE / 2, SIZE / 2 - border, 0, 2 * Math.PI);
  context.fillStyle = icon.color;
  context.fill();
  context.lineWidth = border;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.translate((SIZE - GLYPH) / 2, (SIZE - GLYPH) / 2);
  context.scale(GLYPH / 15, GLYPH / 15);
  context.fillStyle = "#ffffff";
  context.fill(new Path2D(icon.glyph));
  return context.getImageData(0, 0, SIZE, SIZE);
}
