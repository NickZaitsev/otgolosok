import type { Metadata } from "next";
import { AppAuthComplete } from "@/features/auth/app-auth-screen";

// Telegram returns here; the page hands a single-use code back to the mobile app.
export const metadata: Metadata = { title: "Вход через Telegram — Отголосок", robots: { index: false, follow: false } };

export default function AppAuthTelegramCompletePage() {
  return <AppAuthComplete />;
}
