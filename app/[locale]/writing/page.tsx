import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeaturedWriting } from "@/components/featured-writing";
import { Badge } from "@/components/ui/badge";
import { WritingList } from "@/components/writing-list";
import { getDictionary } from "@/lib/dictionaries";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import { GITHUB_USERNAME, SITE_URL } from "@/lib/profile";
import { getAllWritingPosts, getFeaturedWritingPosts } from "@/lib/writing";

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
    description: dict.writing.description,
    alternates: {
      canonical: `/${locale}/writing`,
      languages: {
        pt: "/pt/writing",
        en: "/en/writing",
        "x-default": "/writing",
      },
    },
    openGraph: {
      type: "website",
      title: dict.writing.heading,
      description: dict.writing.description,
      url: `/${locale}/writing`,
    },
    twitter: {
      card: "summary_large_image",
      title: dict.writing.heading,
      description: dict.writing.description,
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
  const featuredPosts = getFeaturedWritingPosts(locale);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: dict.writing.heading,
    description: dict.writing.description,
    url: `${SITE_URL}/${locale}/writing`,
    author: {
      "@type": "Person",
      name: GITHUB_USERNAME,
      url: `${SITE_URL}/${locale}`,
    },
    blogPost: posts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.frontmatter.title,
      description: post.frontmatter.description,
      url: `${SITE_URL}/${locale}/writing/${post.slug}`,
      ...(post.frontmatter.date
        ? { datePublished: post.frontmatter.date }
        : {}),
    })),
  };

  return (
    <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-serif dark:bg-zinc-950 dark:text-zinc-50">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires a raw <script> tag; content here is all internal post frontmatter, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-152 mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-normal">{dict.writing.heading}</h1>
          <Badge variant="outline">{posts.length}</Badge>
        </div>

        <hr className="border-zinc-200 dark:border-zinc-800" />

        {featuredPosts.length > 0 && (
          <FeaturedWriting posts={featuredPosts} locale={locale} />
        )}

        {posts.length > 0 ? (
          <WritingList posts={posts} locale={locale} />
        ) : (
          <p className="text-zinc-500">{dict.writing.empty}</p>
        )}
      </div>
    </div>
  );
}
