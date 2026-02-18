import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/providers";

export const metadata: Metadata = {
  title: {
    default: "P.W. Nigeria Ltd. - Plant Management System",
    template: "%s | P.W. Nigeria",
  },
  description: "Comprehensive plant and equipment management system for tracking heavy machinery across multiple sites.",
  keywords: ["plant management", "equipment tracking", "fleet management", "P.W. Nigeria"],
  authors: [{ name: "P.W. Nigeria Ltd." }],
  creator: "P.W. Nigeria Ltd.",
  icons: {
    icon: "/images/logo.png",
    apple: "/images/logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101415" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
