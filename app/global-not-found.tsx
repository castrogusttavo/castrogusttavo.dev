import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "404",
  description: "This page does not exist.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`}>
      <body className="grid min-h-screen place-items-center bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="text-center">
          <h1 className="text-2xl font-normal">404</h1>
          <p className="mt-2 text-zinc-500">This page does not exist.</p>
          <a
            href="/"
            className="mt-4 inline-block underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            back home
          </a>
        </div>
      </body>
    </html>
  );
}
