import type { Metadata } from "next";
import "./globals.css";
import DesktopSyncClient from "@/components/layout/DesktopSyncClient";

export const metadata: Metadata = {
  title: "Gulf Career Super Dashboard | A.R. Khan IT Solution",
  description: "Advanced Gulf Career Gateway management dashboard — Agency portal, candidate matching, document processing, and WhatsApp blast.",
  keywords: "Gulf Career, Manpower, Recruitment, Dashboard, UAE, Saudi, Qatar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-animated min-h-screen antialiased">
        <DesktopSyncClient />
        {children}
      </body>
    </html>
  );
}
