import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NOVA — The Prompt-to-Reality Engine",
  description: "Describe anything. Get everything. NOVA transforms a single sentence into a complete, production-grade web application — live, interactive, and fully functional.",
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
  // v10: Added ThemeProvider for dark/light mode toggle
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster position="top-right" />
        </ThemeProvider>
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
