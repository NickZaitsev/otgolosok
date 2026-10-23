import type { Metadata } from "next";
import { AppAuthStart } from "@/features/auth/app-auth-screen";

// Opened by the mobile app in a Custom Tab: no search indexing.
export const metadata: Metadata = { title: "Вход через Telegram — Отголосок", robots: { index: false, follow: false } };

export default function AppAuthTelegramPage() {
  return <AppAuthStart />;
}
