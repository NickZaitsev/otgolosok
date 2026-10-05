import { hasNativePlugin } from "./platform";

/**
 * The app draws under the status and navigation bars, so their icons must contrast with the screen below:
 * dark icons for the light site (the default in mobile/capacitor-config.ts), light ones on a dark screen.
 * Does nothing on the web.
 */
export async function setDarkScreenSystemBars(dark: boolean): Promise<void> {
  if (!hasNativePlugin("SystemBars")) return;
  try {
    const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
    await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch (error) {
    // Cosmetic: the bars keep their previous colors, the page keeps working.
    console.warn("Не удалось сменить цвет системных панелей.", error);
  }
}
