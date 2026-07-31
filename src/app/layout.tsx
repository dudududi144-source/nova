import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NOVA — Describe it. Build it.",
  description: "Type what you want to build. NOVA generates a working, single-file HTML app you can preview and download.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // v1 is dark-only. No theme toggle. Keeps things simple and honest.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
        <Toaster theme="dark" position="top-right" />
        <noscript>
          <div style={{ padding: '2rem', textAlign: 'center', color: '#e2e8f0', fontFamily: 'monospace' }}>
            <h1>NOVA requires JavaScript</h1>
            <p>NOVA is an AI app builder that needs JavaScript to run. Please enable JavaScript in your browser.</p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
