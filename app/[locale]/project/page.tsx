import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectSection } from "@/components/project-section";
import { getDictionary } from "@/lib/dictionaries";
import { getPinnedRepos, type PinnedRepo } from "@/lib/github-service";
import { isLocale, LOCALES } from "@/lib/locale";
import { GITHUB_USERNAME, SITE_URL } from "@/lib/profile";

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
    title: dict.project.heading,
    description: dict.project.description,
    alternates: {
      canonical: `/${locale}/project`,
      languages: {
        pt: "/pt/project",
        en: "/en/project",
        "x-default": "/project",
      },
    },
    openGraph: {
      type: "website",
      title: dict.project.heading,
      description: dict.project.description,
      url: `/${locale}/project`,
    },
    twitter: {
      card: "summary_large_image",
      title: dict.project.heading,
      description: dict.project.description,
    },
  };
}

async function safeGetPinnedRepos(): Promise<PinnedRepo[]> {
  try {
    return await getPinnedRepos(GITHUB_USERNAME);
  } catch {
    return [];
  }
}

export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale = rawLocale;
  const dict = getDictionary(locale);
  const repos = await safeGetPinnedRepos();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: dict.project.heading,
    description: dict.project.description,
    url: `${SITE_URL}/${locale}/project`,
    itemListElement: repos.map((repo, index) => ({
      "@type": "SoftwareSourceCode",
      position: index + 1,
      name: repo.name,
      ...(repo.description ? { description: repo.description } : {}),
      url: repo.homepageUrl || repo.url,
      codeRepository: repo.url,
    })),
  };

  return (
    <div className="w-full min-h-screen bg-white text-zinc-950 py-12 px-6 font-sans dark:bg-zinc-950 dark:text-zinc-50">
      {repos.length > 0 && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires a raw <script> tag; content here is GitHub's own pinned-repo data, not user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div className="max-w-152 mx-auto flex flex-col gap-4">
        <h1 className="text-2xl font-normal">{dict.project.heading}</h1>

        <hr className="border-zinc-200 dark:border-zinc-800" />

        {repos.length > 0 ? (
          <ProjectSection repos={repos} dict={dict} />
        ) : (
          <p className="text-zinc-500">{dict.project.empty}</p>
        )}
      </div>
    </div>
  );
}
