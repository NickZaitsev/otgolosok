import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["cyrillic", "latin"],
  weight: ["500", "600", "700"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
  title: "Отголосок — город говорит рядом",
  description:
    "Аудиопрогулки по Москве, которые начинаются там, где случилась история.",
  applicationName: "Отголосок",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Отголосок",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
