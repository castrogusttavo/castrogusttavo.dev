import { HugeiconsIcon } from "@hugeicons/react";
import {
  ExternalLinkIcon,
  GithubIcon,
  SourceCodeIcon,
} from "@hugeicons-pro/core-bulk-rounded";
import type {
  CompanyLink,
  ExperienceItemType,
} from "@/components/work-experience";
import { WorkExperience } from "@/components/work-experience";
import type { Dictionary } from "@/lib/dictionaries";
import type { PinnedRepo } from "@/lib/github-service";

export function ProjectSection({
  repos,
  dict,
}: {
  repos: PinnedRepo[];
  dict: Dictionary;
}) {
  const experiences: ExperienceItemType[] = repos.map((repo) => {
    const details = [
      repo.commitCount != null
        ? `- **${dict.project.commits}:** ${repo.commitCount}`
        : null,
      repo.contributorCount != null
        ? `- **${dict.project.contributors}:** ${repo.contributorCount}`
        : null,
      repo.license ? `- **${dict.project.license}:** ${repo.license}` : null,
      `- **${dict.project.openIssues}:** ${repo.openIssueCount}`,
    ].filter((line): line is string => line !== null);

    const companyLinks: CompanyLink[] = [
      {
        href: repo.url,
        icon: <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />,
        label: dict.repoLinks.source,
      },
      ...(repo.homepageUrl
        ? [
            {
              href: repo.homepageUrl,
              icon: <HugeiconsIcon icon={ExternalLinkIcon} strokeWidth={2} />,
              label: dict.repoLinks.site,
            },
          ]
        : []),
    ];

    return {
      id: repo.name,
      companyName: repo.name,
      companyLinks,
      positions: [
        {
          id: `${repo.name}-position`,
          title: repo.description || repo.name,
          icon: <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} />,
          // Projects don't wrap up — every one of these is still ongoing, so
          // there's a start (first commit) but never an end.
          ...(repo.firstCommitDate
            ? {
                employmentPeriod: {
                  start: String(new Date(repo.firstCommitDate).getFullYear()),
                },
              }
            : {}),
          description: details.length > 0 ? details.join("\n") : undefined,
          skills: [
            ...repo.languages.map((language) => language.name),
            `${repo.stargazerCount} ${dict.project.stars}`,
          ],
        },
      ],
    };
  });

  return <WorkExperience className="px-0" experiences={experiences} />;
}
