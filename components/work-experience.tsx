"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Briefcase01Icon,
  Infinity01Icon,
} from "@hugeicons-pro/core-bulk-rounded";
import { differenceInMonths, parse } from "date-fns";
import { type ComponentProps, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { ChevronsUpDownIconHandle } from "@/components/chevrons-up-down-icon";
import { ChevronsUpDownIcon } from "@/components/chevrons-up-down-icon";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type ExperiencePositionItemType = {
  /** Unique identifier for the position */
  id: string;
  /** The job title or position name */
  title: string;
  /**
   * Employment period of the position, when the item has one (education and
   * project entries usually don't).
   * Use "MM.YYYY" or "YYYY" format. Omit `end` for current roles.
   */
  employmentPeriod?: {
    /** Start date (e.g., "10.2022" or "2020"). */
    start: string;
    /** End date; leave undefined for "Present". */
    end?: string;
  };
  /** The type of employment (e.g., "Full-time", "Part-time", "Contract") */
  employmentType?: string;
  /** A brief description of the position or responsibilities */
  description?: string;
  /** An icon representing the position */
  icon?: React.ReactElement;
  /** A list of skills associated with the position */
  skills?: string[];
  /** Indicates if the position details are expanded in the UI */
  isExpanded?: boolean;
};

export type CompanyLink = {
  href: string;
  icon: React.ReactElement;
  label: string;
};

export type ExperienceItemType = {
  /** Unique identifier for the experience item */
  id: string;
  /** Name of the company where the experience was gained */
  companyName: string;
  /** URL or path to the company's logo image */
  companyLogo?: string;
  /** URL to the company's website. Ignored when `companyLinks` is set. */
  companyWebsite?: string;
  /**
   * Icon-only links shown next to the name instead of making the name
   * itself a link — e.g. a repo's GitHub icon plus an external-link icon
   * for its homepage. Takes over from `companyWebsite` when present.
   */
  companyLinks?: CompanyLink[];
  /**
   * List of positions held at the company
   * @fumadocsHref #experiencepositionitemtype
   * */
  positions: ExperiencePositionItemType[];
};

export type WorkExperienceProps = {
  className?: string;
  /** @fumadocsHref #experienceitemtype */
  experiences: ExperienceItemType[];
};

export function WorkExperience({
  className,
  experiences,
}: WorkExperienceProps) {
  return (
    <div className={cn("text-zinc-950 dark:text-zinc-50", className)}>
      {experiences.map((experience) => (
        <ExperienceItem key={experience.id} experience={experience} />
      ))}
    </div>
  );
}

export type ExperienceItemProps = {
  experience: ExperienceItemType;
};

export function ExperienceItem({ experience }: ExperienceItemProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="not-prose flex items-center gap-3">
        <div className="flex size-6 shrink-0 items-center justify-center">
          {experience.companyLogo ? (
            // biome-ignore lint/performance/noImgElement: arbitrary external logo URLs, not in next.config's remotePatterns
            <img
              src={experience.companyLogo}
              alt={experience.companyName}
              className="size-6 rounded-full"
              aria-hidden="true"
            />
          ) : (
            <span className="flex size-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          )}
        </div>

        <h3 className="text-sm leading-snug font-normal text-zinc-700 dark:text-zinc-300">
          {experience.companyLinks?.length ? (
            experience.companyName
          ) : experience.companyWebsite ? (
            <a
              className="link"
              href={experience.companyWebsite}
              target="_blank"
              rel="noopener noreferrer"
            >
              {experience.companyName}
            </a>
          ) : (
            experience.companyName
          )}
        </h3>

        {experience.companyLinks?.map((companyLink) => (
          <a
            key={companyLink.href}
            href={companyLink.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={companyLink.label}
            className="flex size-5 items-center justify-center text-zinc-400 transition-colors hover:text-zinc-950 dark:hover:text-zinc-50 [&_svg]:size-4"
          >
            {companyLink.icon}
          </a>
        ))}
      </div>

      <div className="relative space-y-4 before:absolute before:left-3 before:h-full before:w-px before:bg-zinc-200 dark:before:bg-zinc-800">
        {experience.positions.map((position) => (
          <ExperiencePositionItem key={position.id} position={position} />
        ))}
      </div>
    </div>
  );
}

export type ExperiencePositionItemProps = {
  position: ExperiencePositionItemType;
};

export function ExperiencePositionItem({
  position,
}: ExperiencePositionItemProps) {
  const chevronsUpDownIconRef = useRef<ChevronsUpDownIconHandle>(null);

  const handleOpenChange = useCallback((open: boolean) => {
    const controls = chevronsUpDownIconRef.current;
    if (!controls) return;

    if (open) {
      controls.startAnimation();
    } else {
      controls.stopAnimation();
    }
  }, []);

  const { start, end } = position.employmentPeriod ?? {};
  const isOngoing = Boolean(start) && !end;
  const duration = start ? formatDuration(start, end) : "";
  const hasMeta = Boolean(position.employmentType || start);

  return (
    <Collapsible
      defaultOpen={position.isExpanded}
      onOpenChange={handleOpenChange}
      disabled={!position.description}
      render={
        <div className="relative last:before:absolute last:before:h-full last:before:w-4 last:before:bg-white dark:last:before:bg-zinc-950" />
      }
    >
      <CollapsibleTrigger
        className={cn(
          "group/experience-position not-prose block w-full text-left select-none",
          "relative before:absolute before:-top-1 before:-right-1 before:-bottom-1.5 before:left-7 before:rounded-lg hover:before:bg-zinc-100 dark:hover:before:bg-zinc-900",
          "data-disabled:before:content-none",
        )}
      >
        <div className="relative z-1 mb-1 flex items-start gap-3 text-base">
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-lg",
              "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
              "border border-zinc-200 dark:border-zinc-800",
              "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            )}
          >
            {position.icon ?? (
              <HugeiconsIcon icon={Briefcase01Icon} strokeWidth={2} />
            )}
          </div>

          <h4 className="flex-1 text-balance font-normal text-zinc-950 dark:text-zinc-50">
            {position.title}
          </h4>

          <div className="shrink-0 text-zinc-400 group-disabled/experience-position:hidden [&_svg]:h-lh [&_svg]:w-4">
            <ChevronsUpDownIcon ref={chevronsUpDownIconRef} duration={0.15} />
          </div>
        </div>

        {/* Separators are aria-hidden: a dl may only expose dt/dd groups, and these dividers are decorative. */}
        {hasMeta && (
          <dl className="relative z-1 flex items-center gap-2 pl-9 text-sm text-zinc-500 dark:text-zinc-400">
            {position.employmentType && (
              <>
                <div>
                  <dt className="sr-only">Employment Type</dt>
                  <dd>{position.employmentType}</dd>
                </div>

                {start && (
                  <Separator
                    className="data-vertical:h-4 data-vertical:self-center"
                    orientation="vertical"
                    aria-hidden
                  />
                )}
              </>
            )}

            {start && (
              <div>
                <dt className="sr-only">Employment Period</dt>
                <dd className="flex items-center gap-0.5 tabular-nums">
                  <span>{start}</span>
                  <span className="font-mono">—</span>
                  {isOngoing ? (
                    <HugeiconsIcon
                      icon={Infinity01Icon}
                      strokeWidth={2}
                      className="size-4.5 translate-y-[0.5px]"
                      aria-label="Present"
                    />
                  ) : (
                    <span>{end}</span>
                  )}
                </dd>
              </div>
            )}

            {duration && (
              <>
                <Separator
                  className="data-vertical:h-4 data-vertical:self-center"
                  orientation="vertical"
                  aria-hidden
                />
                <div>
                  <dt className="sr-only">Duration</dt>
                  <dd className="tabular-nums">{duration}</dd>
                </div>
              </>
            )}
          </dl>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        {position.description && (
          <Prose className="pt-2 pl-9">
            <ReactMarkdown>{position.description}</ReactMarkdown>
          </Prose>
        )}
      </CollapsibleContent>
      {Array.isArray(position.skills) && position.skills.length > 0 && (
        <ul className="not-prose flex flex-wrap gap-1.5 pt-3 pl-9">
          {position.skills.map((skill) => (
            <li key={skill} className="flex">
              <Skill>{skill}</Skill>
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}

function Prose({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none prose-ncdai prose-zinc dark:prose-invert",
        className,
      )}
      {...props}
    />
  );
}

function Skill({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-zinc-200 bg-zinc-100/50 px-1.5 py-0.5 font-mono text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400",
        className,
      )}
      {...props}
    />
  );
}

function formatDuration(start: string, end?: string): string {
  const startHasMonth = start.includes(".");
  const endHasMonth = end ? end.includes(".") : true;

  // Both year-only: granularity is years, no month arithmetic needed.
  if (!startHasMonth && end && !endHasMonth) {
    const years = parseInt(end, 10) - parseInt(start, 10);
    if (years <= 0) {
      return "";
    }
    return `${years}y`;
  }

  const startDate = parsePeriodDate(start, "first");
  const endDate = end ? parsePeriodDate(end, "last") : new Date();

  // +1 to count both the start and end months inclusively.
  const totalMonths = differenceInMonths(endDate, startDate) + 1;
  if (totalMonths <= 0) {
    return "";
  }

  if (totalMonths < 12) {
    return `${totalMonths}m`;
  }

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (months === 0) {
    return `${years}y`;
  }
  return `${years}y ${months}m`;
}

function parsePeriodDate(str: string, fallbackMonth: "first" | "last"): Date {
  if (str.includes(".")) {
    return parse(str, "MM.yyyy", new Date());
  }
  return parse(
    `${fallbackMonth === "last" ? "12" : "01"}.${str}`,
    "MM.yyyy",
    new Date(),
  );
}
