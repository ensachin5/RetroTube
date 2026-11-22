import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import localFont from "next/font/local";
import { PwaManager } from "@/src/components/PwaManager";
import { RetroHeader } from "@/src/components/RetroHeader";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-manrope",
});

const satoshi = localFont({
  src: [
    {
      path: "../public/fonts/Satoshi-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/Satoshi-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: true,
  variable: "--font-satoshi",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f0e4",
};

export const metadata: Metadata = {
  title: {
    default: "RetroTube — YouTube Video & Audio Deck",
    template: "%s | RetroTube",
  },
  description:
    "Lightweight, personal-use YouTube video and audio downloader with full stream inspection, automatic ffmpeg merging, and audio transcoding.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "RetroTube",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${satoshi.variable} antialiased`}>
      <body className="retro-backdrop min-h-dvh flex flex-col">
        <RetroHeader />
        <PwaManager />
        <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-6 sm:py-8 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
          {children}
        </main>
        <footer className="border-t-2 border-[var(--border-ink)] bg-[var(--bg-surface)] py-4 px-4 text-center text-xs text-[var(--text-muted)] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p>
            RetroTube — Personal use only. Respect creators and applicable copyright laws.
          </p>
        </footer>
      </body>
    </html>
  );
}
