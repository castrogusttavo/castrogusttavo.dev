import { HugeiconsIcon } from "@hugeicons/react";
import { NewReleasesIcon, StarIcon } from "@hugeicons-pro/core-solid-rounded";
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
import { WorkExperienceEntry } from "@/components/work-experience";
import { WritingPostMeta } from "@/components/writing-post-meta";
import { getDictionary } from "@/lib/dictionaries";
import { getCachedContributions } from "@/lib/get-cached-contributions";
import { getPinnedRepos, getSocialAccounts } from "@/lib/github-service";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import {
  contactHref,
  description,
  education,
  GITHUB_USERNAME,
  photos,
  workExperience,
} from "@/lib/profile";
import { getAllWritingPosts } from "@/lib/writing";
import { resolveWritingIcon } from "@/lib/writing-icons";

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
    : `${name}'s developer portfolio.`;

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
  const featuredRepos = await getPinnedRepos(user.login);
  const writingPosts = getAllWritingPosts(locale);

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
    <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-serif dark:bg-zinc-950 dark:text-zinc-50">
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
            {/* biome-ignore lint/performance/noImgElement: fixed local asset, no next/image sizing needed */}
            <img
              src={"/img/me.png"}
              alt={user.login}
              className="h-27 w-27 shrink-0 rounded-full border-2 border-zinc-500 object-cover object-top grayscale"
            />
            <div className="space-y-2.5 w-full">
              <div className="w-full flex flex-col md:flex-row justify-between items-start md:items-center">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-2xl font-normal">
                    {user.name ?? user.login}
                  </h1>
                  <HugeiconsIcon
                    icon={NewReleasesIcon}
                    size={16}
                    className="text-blue-500"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <LanguageToggle locale={locale} dict={dict} />
                  <ToggleSeparator />
                  <ThemeToggle dict={dict} />
                </div>
              </div>
              <Description segments={description} locale={locale} />
              <div className="text-zinc-600 flex items-center gap-2 dark:text-zinc-400">
                {social.map((s: { provider: string; url: string }) => (
                  <Link
                    key={s.provider}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
                  >
                    {s.provider}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <Suspense fallback={<GitHubContributionsFallback />}>
            <GitHubContributions
              contributions={contributions}
              githubProfileUrl={`https://github.com/${user.login}`}
            />
          </Suspense>
        </header>

        <h2 className="text-zinc-500 text-base mt-4">{dict.proofOfWork}</h2>
        <hr className="border border-zinc-200 dark:border-zinc-800" />
        <div className="flex flex-col gap-4">
          {featuredRepos.map((repo) => (
            <div key={repo.url} className="flex items-start justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2.5">
                  <h3 className="text-xl font-normal capitalize">
                    {repo.name}
                  </h3>
                  <div className="hidden md:flex gap-1 items-center">
                    <HugeiconsIcon
                      icon={StarIcon}
                      strokeWidth={2}
                      size={13}
                      className="text-yellow-400"
                    />
                    <span className="text-sm">{repo.stargazerCount}</span>
                  </div>
                </div>
                <p className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {repo.description}
                </p>
              </div>
              <div className="text-zinc-600 flex items-center gap-2 dark:text-zinc-400">
                {repo.homepageUrl && (
                  <Link
                    href={repo.homepageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
                  >
                    {dict.repoLinks.site}
                  </Link>
                )}
                <Link
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-zinc-950 dark:hover:text-zinc-50"
                >
                  {dict.repoLinks.source}
                </Link>
              </div>
            </div>
          ))}
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
            <div className="flex flex-col gap-2 group">
              {writingPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/${locale}/writing/${post.slug}`}
                  className="flex items-center gap-3 rounded-lg p-2 -mx-2 opacity-100 transition duration-200 hover:bg-zinc-50 group-has-[a:hover]:opacity-40 hover:opacity-100! dark:hover:bg-zinc-900"
                >
                  <div className="bg-primary-foreground border border-border size-9 flex items-center justify-center rounded-lg group-hover:scale-[1.06]">
                    <HugeiconsIcon
                      icon={resolveWritingIcon(post.frontmatter.icon)}
                      size={20}
                      className="mt-1 shrink-0 text-zinc-500"
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <WritingPostMeta
                      title={post.frontmatter.title}
                      description={post.frontmatter.description}
                    />
                  </div>
                </Link>
              ))}
            </div>
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
