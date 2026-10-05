"use client";

import { useEffect } from "react";
import { hasNativePlugin, nativePlatform } from "@/lib/native/platform";
import { isWalkInProgress } from "../tour/walk-activity";
import { listenForAppLinks } from "./app-links";

const confirmLeave = () => !isWalkInProgress() || window.confirm("Прервать прогулку и открыть ссылку?");

/**
 * Glue between the site and the Android app (docs/agents/mobile-app.md): links that open the app, the hardware Back
 * button and the launch splash. Renders nothing and does nothing on the web.
 */
export function NativeShell() {
  useEffect(() => {
    if (!nativePlatform()) return;
    const stopLinks = listenForAppLinks({ confirmLeave });
    const stopBack = listenForBackButton();
    void hideSplash();
    return () => {
      stopLinks();
      stopBack();
    };
  }, []);
  return null;
}

/**
 * With the App plugin installed, Android stops handling Back by itself: walk back through the page history
 * (place cards, sheets) and leave the app at the first page. Minimizing, not finishing, keeps a playing story alive.
 */
function listenForBackButton(): () => void {
  if (!hasNativePlugin("App")) return () => {};
  let stopped = false;
  let remove: (() => Promise<void>) | null = null;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) history.back();
        else void App.minimizeApp();
      });
      if (stopped) await handle.remove();
      else remove = () => handle.remove();
    } catch (error) {
      console.warn("Не удалось подключить кнопку «Назад» приложения.", error);
    }
  })();
  return () => {
    stopped = true;
    void remove?.();
  };
}

async function hideSplash(): Promise<void> {
  if (!hasNativePlugin("SplashScreen")) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch (error) {
    // The splash hides itself after launchShowDuration (mobile/capacitor-config.ts).
    console.warn("Не удалось скрыть заставку приложения.", error);
  }
}
