import { HugeiconsIcon } from "@hugeicons/react";
import { Linkedin02Icon, StarIcon } from "@hugeicons-pro/core-solid-rounded";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Description } from "@/components/description";
import {
  GitHubContributions,
  GitHubContributionsFallback,
} from "@/components/github-contributions";
import { PhotoDeck } from "@/components/photo-deck";
import {
  LanguageToggle,
  ThemeToggle,
  ToggleSeparator,
} from "@/components/toggles";
import { Button } from "@/components/ui/button";
import { WorkExperienceEntry } from "@/components/work-experience";
import { WritingList } from "@/components/writing-list";
import { getDictionary } from "@/lib/dictionaries";
import { getCachedContributions } from "@/lib/get-cached-contributions";
import { getPinnedRepos, getSocialAccounts } from "@/lib/github-service";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import {
  contactHref,
  description,
  education,
  GITHUB_USERNAME,
  heroBio,
  heroHighlight,
  photos,
  workExperience,
} from "@/lib/profile";
import { getAllWritingPosts, getFeaturedWritingPosts } from "@/lib/writing";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const res = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}`, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    return { title: GITHUB_USERNAME };
  }

  const user = await res.json();
  const name = user.name ?? GITHUB_USERNAME;
  const desc = user.bio
    ? truncate(user.bio, 160)
    : dict.meta.fallbackDescription.replace("{{name}}", name);

  return {
    title: `${name} (@${GITHUB_USERNAME})`,
    description: desc,
    alternates: {
      canonical: `/${locale}`,
      languages: { pt: "/pt", en: "/en" },
    },
    openGraph: { type: "profile", title: name, description: desc },
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const dict = getDictionary(locale);

  const res = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}`, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: 3600 }, // cache 1h
  });

  if (!res.ok) {
    if (res.status === 404) notFound();
    throw new Error("Failed to fetch GitHub data");
  }

  const user = await res.json();

  const contributions = getCachedContributions(user.login);
  const social = await getSocialAccounts(user.login);
  // const featuredRepos = await getPinnedRepos(user.login);
  const writingPosts = getAllWritingPosts(locale);
  const featuredWritingPosts = getFeaturedWritingPosts(locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: user.name ?? user.login,
    alternateName: user.login,
    ...(user.bio ? { description: user.bio } : {}),
    image: user.avatar_url,
    sameAs: [
      `https://github.com/${user.login}`,
      ...social.map((s: { provider: string; url: string }) => s.url),
    ],
  };

  return (
    <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-sans text-base font-normal dark:bg-zinc-950 dark:text-zinc-50">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires a raw <script> tag; the `<` escape below is the mitigation since bio is user-authored.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="max-w-152 h-full mx-auto flex flex-col gap-4">
        <header className="flex flex-col gap-2.5">
          <div className="flex items-start gap-6 mb-2">
            <div className="w-full flex flex-col md:flex-row">
              <div className="w-full items-star space-y-1">
                <div className="flex items-center gap-1.5">
                  <h1 className="font-medium">{user.name ?? user.login}</h1>
                </div>
                <Description segments={description} locale={locale} />
              </div>
              <div className="flex items-center gap-1">
                <LanguageToggle locale={locale} dict={dict} />
                <ToggleSeparator />
                <ThemeToggle dict={dict} />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-zinc-600 dark:text-zinc-400">
              {heroBio[locale]}
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              {heroHighlight.prefix[locale]}{" "}
              <Link
                href="https://github.com/castrogusttavo/nexo"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                Nexo
              </Link>
              {heroHighlight.middle[locale]}{" "}
              <Link
                href="https://linkedin.com/in/castrogusttavo"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                linkedIn
              </Link>
              {heroHighlight.suffix[locale]}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="https://cal.com/castrogusttavo/15min">
              <Button>{dict.hero.bookCall}</Button>
            </Link>
            <Link href="https://x.com/gustta_dev">
              <Button variant="outline">{dict.hero.messageOnX}</Button>
            </Link>
          </div>
        </header>

        <h2 className="text-zinc-500 text-base mt-4">{dict.performance}</h2>
        <div>
          <Suspense fallback={<GitHubContributionsFallback />}>
            <GitHubContributions
              contributions={contributions}
              githubProfileUrl={`https://github.com/${user.login}`}
              locale={locale}
              dict={dict}
            />
          </Suspense>
        </div>

        {workExperience.length > 0 && (
          <>
            <h2 className="text-zinc-500 text-base mt-4">{dict.workedAt}</h2>
            <hr className="border border-zinc-200 dark:border-zinc-800" />
            <div className="flex flex-col gap-4">
              {workExperience.map((entry) => (
                <WorkExperienceEntry
                  key={`${entry.company}-${entry.period}`}
                  entry={entry}
                  locale={locale}
                  dict={dict}
                />
              ))}
            </div>
          </>
        )}

        {education.length > 0 && (
          <>
            <h2 className="text-zinc-500 text-base mt-4">{dict.education}</h2>
            <hr className="border border-zinc-200 dark:border-zinc-800" />
            <div className="flex flex-col gap-4">
              {education.map((entry) => (
                <div
                  key={`${entry.institution}-${entry.period}`}
                  className="flex flex-col gap-1.5"
                >
                  <h3>{entry.degree[locale]}</h3>
                  <p className="text-sm font-normal text-zinc-700 dark:text-zinc-300">
                    {entry.institution} · {entry.period}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {writingPosts.length > 0 && (
          <>
            <h2
              id="escrita"
              className="text-zinc-500 text-base mt-4 scroll-mt-8"
            >
              {dict.writing.heading}
            </h2>
            <hr className="border border-zinc-200 dark:border-zinc-800" />
            <WritingList posts={featuredWritingPosts} locale={locale} />
            {writingPosts.length > featuredWritingPosts.length && (
              <Link
                href={`/${locale}/writing`}
                className="self-start text-sm text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                {dict.writing.readMore}
              </Link>
            )}
          </>
        )}

        {photos.length > 0 && (
          <>
            <h2 className="text-zinc-500 text-base mt-4">{dict.elsewhere}</h2>
            <hr className="border border-zinc-200 dark:border-zinc-800" />
            <PhotoDeck photos={photos} locale={locale} />
          </>
        )}

        <span className="mt-12 text-zinc-600 dark:text-zinc-400">
          {dict.contact.lead}{" "}
          <Link
            href={contactHref}
            className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            {dict.contact.cta}
          </Link>
        </span>
      </div>
    </div>
  );
}
