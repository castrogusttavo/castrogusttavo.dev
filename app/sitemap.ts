import type { MetadataRoute } from "next";
import { LOCALES, type Locale } from "@/lib/locale";
import { SITE_URL } from "@/lib/profile";
import { getAllWritingPosts, getWritingPost } from "@/lib/writing";

function languagesFor(pathByLocale: (locale: Locale) => string) {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, `${SITE_URL}${pathByLocale(locale)}`]),
  );
}

/**
 * Google's guidance for localized sitemaps: list every language variant as
 * its own `<url>` entry, and have each entry's `alternates.languages`
 * cross-reference the full set (including itself), not just the others.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const home: MetadataRoute.Sitemap = LOCALES.map(
    (locale): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}/${locale}`,
      changeFrequency: "monthly",
      priority: 1,
      alternates: { languages: languagesFor((l) => `/${l}`) },
    }),
  );

  const writingIndex: MetadataRoute.Sitemap = LOCALES.map(
    (locale): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}/${locale}/writing`,
      changeFrequency: "weekly",
      priority: 0.7,
      alternates: { languages: languagesFor((l) => `/${l}/writing`) },
    }),
  );

  const projectIndex: MetadataRoute.Sitemap = LOCALES.map(
    (locale): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}/${locale}/project`,
      changeFrequency: "weekly",
      priority: 0.6,
      alternates: { languages: languagesFor((l) => `/${l}/project`) },
    }),
  );

  const slugs = new Set(
    LOCALES.flatMap((locale) =>
      getAllWritingPosts(locale).map((post) => post.slug),
    ),
  );

  const articles: MetadataRoute.Sitemap = Array.from(slugs).flatMap((slug) => {
    const availableLocales = LOCALES.filter((locale) =>
      getWritingPost(locale, slug),
    );
    const languages = Object.fromEntries(
      availableLocales.map((locale) => [
        locale,
        `${SITE_URL}/${locale}/writing/${slug}`,
      ]),
    );

    return availableLocales.map((locale): MetadataRoute.Sitemap[number] => ({
      url: `${SITE_URL}/${locale}/writing/${slug}`,
      lastModified: getWritingPost(locale, slug)?.frontmatter.date,
      changeFrequency: "monthly",
      priority: 0.6,
      alternates: { languages },
    }));
  });

  return [...home, ...writingIndex, ...projectIndex, ...articles];
}
