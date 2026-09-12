import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")),
  title: "QuietTime",
  description: "過ごした時間を記録する時計。",
  applicationName: "QuietTime",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    title: "QuietTime",
    description: "過ごした時間を記録する時計。",
    siteName: "QuietTime",
  },
  twitter: {
    card: "summary_large_image",
    title: "QuietTime",
    description: "過ごした時間を記録する時計。",
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "QuietTime" },
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
