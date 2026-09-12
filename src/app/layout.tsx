import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")),
  title: "余白 — 広告ゲームを遊ばずに",
  description: "広告ゲームを遊ばずに過ごした時間を、静かに記録する時計。",
  applicationName: "余白",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    title: "余白 — 広告ゲームを遊ばずに",
    description: "広告ゲームを遊ばずに過ごした時間を、静かに記録する時計。",
    siteName: "余白",
  },
  twitter: {
    card: "summary_large_image",
    title: "余白 — 広告ゲームを遊ばずに",
    description: "広告ゲームを遊ばずに過ごした時間を、静かに記録する時計。",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "余白" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/favicon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f7f4",
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head><script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
