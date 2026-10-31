import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/ui/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PlotAtlas",
  description: "Browse plotted layouts and apartment societies, plot by plot and flat by flat.",
};

function NavSkeleton() {
  return (
    <header className="sticky top-0 z-[1000] border-b border-white/10 bg-[#030712]/70 backdrop-blur-xl shadow-2xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]">PlotAtlas</span>
        <div className="flex items-center gap-6">
          <div className="h-4 w-28 rounded-full bg-white/10 animate-pulse" />
          <div className="h-8 w-16 rounded-full bg-white/10 animate-pulse" />
        </div>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {/* Nav does auth + profile DB calls — Suspense lets the page
            content (including loading.tsx skeletons) stream immediately
            while Nav resolves, instead of blocking the whole layout. */}
        <Suspense fallback={<NavSkeleton />}>
          <Nav />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
