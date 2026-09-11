import { HugeiconsIcon } from "@hugeicons/react";
import {
  BrowserIcon,
  BulbIcon,
  SourceCodeIcon,
} from "@hugeicons-pro/core-bulk-rounded";
import type { ExperienceItemType } from "@/components/work-experience";
import { WorkExperience } from "@/components/work-experience";
import { parsePeriodRange } from "@/lib/format-date";
import type { Locale } from "@/lib/locale";
import { workExperience } from "@/lib/profile";

/**
 * Picks an icon from the role title's own wording rather than a per-entry
 * field — "founder"/"fundador" wins over "backend"/"frontend" since a
 * founder title says more about the role than the stack does.
 */
function roleIcon(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("founder") || lower.includes("fundador")) {
    return <HugeiconsIcon icon={BulbIcon} strokeWidth={2} />;
  }
  if (lower.includes("frontend")) {
    return <HugeiconsIcon icon={BrowserIcon} strokeWidth={2} />;
  }
  if (lower.includes("backend")) {
    return <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} />;
  }
  return undefined;
}

export function WorkExperienceSection({ locale }: { locale: Locale }) {
  const experiences: ExperienceItemType[] = workExperience.map(
    (entry, index) => {
      const employmentPeriod = parsePeriodRange(entry.period);
      const title = entry.role[locale];

      return {
        id: `${entry.company}-${entry.period}`,
        companyName: entry.company,
        companyWebsite: entry.companyUrl,
        positions: [
          {
            id: `${entry.company}-position`,
            title,
            employmentPeriod,
            icon: roleIcon(title),
            description: entry.bullets
              .map((bullet) => `- ${bullet[locale]}`)
              .join("\n"),
            isExpanded: index === 0,
          },
        ],
      };
    },
  );

  return <WorkExperience className="px-0" experiences={experiences} />;
}
