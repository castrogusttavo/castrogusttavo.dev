import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { SiteNav } from "@/components/site-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getDictionary } from "@/lib/dictionaries";
import { getPinnedRepos } from "@/lib/github-service";
import { HREFLANG, isLocale, LOCALES } from "@/lib/locale";
import { GITHUB_USERNAME, SITE_URL } from "@/lib/profile";
import type { SearchItem } from "@/lib/search";
import { getAllWritingPosts } from "@/lib/writing";

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
  metadataBase: new URL(SITE_URL),
  title: { default: GITHUB_USERNAME, template: `%s · ${GITHUB_USERNAME}` },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  twitter: { card: "summary_large_image", creator: "@gustta_dev" },
};

async function getSearchItems(locale: (typeof LOCALES)[number]) {
  const posts = getAllWritingPosts(locale);
  const repos = await getPinnedRepos(GITHUB_USERNAME).catch(() => []);

  const postItems: SearchItem[] = posts.map((post) => ({
    id: `post-${post.slug}`,
    type: "post",
    title: post.frontmatter.title,
    description: post.frontmatter.description,
    href: `/${locale}/writing/${post.slug}`,
    iconKey: post.frontmatter.icon,
  }));

  const projectItems: SearchItem[] = repos.map((repo) => ({
    id: `project-${repo.name}`,
    type: "project",
    title: repo.name,
    description: repo.description ?? "",
    href: `/${locale}/project`,
  }));

  return [...postItems, ...projectItems];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);
  const searchItems = await getSearchItems(locale);

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
          <TooltipProvider>
            <SiteNav locale={locale} dict={dict} searchItems={searchItems} />
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
