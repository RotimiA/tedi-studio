import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TEDI Studio",
  description: "Content from the TEDI Studio Sanity project",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-6 px-6 pt-8">
          <Link href="/" className="font-semibold tracking-tight">
            TEDI Studio
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link className="underline" href="/projects">
              Projects
            </Link>
            <Link className="underline" href="/">
              Posts
            </Link>
          </nav>
        </header>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
