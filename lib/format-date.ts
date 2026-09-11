import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Locale } from "./locale";

/** `date` is `yyyy-MM-dd`, parsed as local time so the day never shifts
    across a UTC boundary. */
export function formatPostDate(date: string, locale: Locale): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);

  return locale === "pt"
    ? format(parsed, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
    : format(parsed, "MMMM d, yyyy");
}

/**
 * `workExperience` and `education` entries (see profile.ts) both use a
 * single "YYYY — YYYY" / "YYYY — present" string, not localized — split it
 * into the `{start, end?}` shape `ExperienceItemType` wants, treating
 * "present" (case-insensitive) as ongoing.
 */
export function parsePeriodRange(period: string): {
  start: string;
  end?: string;
} {
  const [start, end] = period.split("—").map((part) => part.trim());
  if (!end || end.toLowerCase() === "present") return { start };
  return { start, end };
}
