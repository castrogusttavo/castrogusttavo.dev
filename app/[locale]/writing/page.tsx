import { HugeiconsIcon } from "@hugeicons/react";
import ArrowLeft02Icon from "@hugeicons-pro/core-bulk-rounded/ArrowLeft02Icon";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { WritingList } from "@/components/writing-list";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import { getAllWritingPosts } from "@/lib/writing";

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

  return {
    title: dict.writing.heading,
    alternates: {
      canonical: `/${locale}/writing`,
      languages: { pt: "/pt/writing", en: "/en/writing" },
    },
  };
}

export default async function WritingIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const dict = getDictionary(locale);
  const posts = getAllWritingPosts(locale);

  return (
    <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-serif dark:bg-zinc-950 dark:text-zinc-50">
      <div className="max-w-152 mx-auto flex flex-col gap-4">
        <Link
          href={`/${locale}#escrita`}
          aria-label={dict.writing.back}
          className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={2} />
        </Link>

        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-normal">{dict.writing.heading}</h1>
          <Badge variant="outline">{posts.length}</Badge>
        </div>

        <hr className="border-zinc-200 dark:border-zinc-800" />

        {posts.length > 0 ? (
          <WritingList posts={posts} locale={locale} />
        ) : (
          <p className="text-zinc-500">{dict.writing.empty}</p>
        )}
      </div>
    </div>
  );
}
