import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HREFLANG, isLocale, LOCALES } from "@/lib/locale";
import { GITHUB_USERNAME } from "@/lib/profile";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The locale segment is the root layout, so `<html lang>` can carry the
 * language the page is actually written in.
 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/** Anything outside the two known locales is a 404, not a rendered page. */
export const dynamicParams = false;

export const metadata: Metadata = {
  title: { default: GITHUB_USERNAME, template: `%s · ${GITHUB_USERNAME}` },
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html
      lang={HREFLANG[locale]}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
