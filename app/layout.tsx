import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Sentry Sales Intelligence",
  description: "Prospect research and reviewed outreach assistant for Smart Sentry sales teams."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
