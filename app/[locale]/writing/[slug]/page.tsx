import { HugeiconsIcon } from "@hugeicons/react";
import ArrowLeft02Icon from "@hugeicons-pro/core-bulk-rounded/ArrowLeft02Icon";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOCMinimap } from "@/components/toc-minimap";
import { WritingProse } from "@/components/writing-prose";
import { getDictionary } from "@/lib/dictionaries";
import { formatPostDate } from "@/lib/format-date";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import { GITHUB_USERNAME } from "@/lib/profile";
import { estimateReadingMinutes } from "@/lib/reading-time";
import { extractHeadings } from "@/lib/toc";
import { getAllWritingPosts, getWritingPost } from "@/lib/writing";

export function generateStaticParams() {
  return LOCALES.flatMap((locale) =>
    getAllWritingPosts(locale).map((post) => ({ locale, slug: post.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const post = getWritingPost(locale, slug);
  if (!post) return {};

  return {
    title: post.frontmatter.title,
    description: post.frontmatter.description,
    openGraph: {
      type: "article",
      title: post.frontmatter.title,
      description: post.frontmatter.description,
    },
  };
}

export default async function WritingArticle({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const dict = getDictionary(locale);
  const post = getWritingPost(locale, slug);
  if (!post) notFound();

  const tocItems = extractHeadings(post.content);
  const readingMinutes = estimateReadingMinutes(post.content);

  return (
    <>
      <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-serif dark:bg-zinc-950 dark:text-zinc-50">
        <article className="max-w-152 mx-auto flex flex-col gap-4">
          <Link
            href={`/${locale}#escrita`}
            className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={2} />
          </Link>

          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-normal">{post.frontmatter.title}</h1>
            <p className="text-zinc-500">{post.frontmatter.description}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <Link
                href={`https://github.com/${GITHUB_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                {GITHUB_USERNAME}
              </Link>
              {post.frontmatter.date && (
                <>
                  <span aria-hidden>|</span>
                  <time dateTime={post.frontmatter.date}>
                    {formatPostDate(post.frontmatter.date, locale)}
                  </time>
                </>
              )}
              <span aria-hidden>|</span>
              <span>
                {dict.writing.readingTime.replace(
                  "{{minutes}}",
                  String(readingMinutes),
                )}
              </span>
            </div>
          </header>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          <WritingProse content={post.content} />
        </article>
      </div>

      {/* Floats outside the content column, docked to the viewport's own
          right edge rather than living inside the article's box. */}
      <TOCMinimap
        items={tocItems}
        className="fixed top-1/2 right-6 hidden w-auto -translate-y-1/2 xl:block"
      />
    </>
  );
}
