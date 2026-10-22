import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans-next",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "FreedomCare", template: "%s | FreedomCare" },
  description:
    "Freedom Trust camp companion: check-in, desk and distribution of mobility aids. Delivering Freedom Through Care.",
  applicationName: "FreedomCare",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  appleWebApp: { capable: true, title: "FreedomCare", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the safe-area padding below clear notches and the home bar
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-ink">
        <PwaRegister />
        <ToastProvider>
          <Suspense fallback={null}>{children}</Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
