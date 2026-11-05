import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import ServiceWorker from "./ServiceWorker";
import "./globals.css";

// The brand font (Tadasouk logo kit): Manrope for the whole app, back office and stores alike.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tadasouk.com"),
  title: "Tadasouk",
  description: "Film your products and talk. Your shop builds itself.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Tadasouk" },
  icons: { apple: "/brand/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
