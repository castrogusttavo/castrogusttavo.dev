import { HugeiconsIcon } from "@hugeicons/react";
import { GraduationCapIcon } from "@hugeicons-pro/core-bulk-rounded";
import type { ExperienceItemType } from "@/components/work-experience";
import { WorkExperience } from "@/components/work-experience";
import { parsePeriodRange } from "@/lib/format-date";
import type { Locale } from "@/lib/locale";
import { education } from "@/lib/profile";

export function EducationSection({ locale }: { locale: Locale }) {
  const experiences: ExperienceItemType[] = education.map((entry) => ({
    id: `${entry.institution}-${entry.period}`,
    companyName: entry.institution,
    positions: [
      {
        id: `${entry.institution}-position`,
        title: entry.degree[locale],
        employmentPeriod: parsePeriodRange(entry.period),
        icon: <HugeiconsIcon icon={GraduationCapIcon} strokeWidth={2} />,
        skills: entry.topics,
      },
    ],
  }));

  return <WorkExperience className="px-0" experiences={experiences} />;
}
