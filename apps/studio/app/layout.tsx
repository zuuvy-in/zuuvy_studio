import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Zuuvy Studio", template: "%s · Zuuvy Studio" },
  description: "Build and run your website with AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
