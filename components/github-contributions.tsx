"use client";

import { format } from "date-fns";
import { use } from "react";
import type { Activity } from "@/components/contribution-graph";
import {
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  ContributionGraphTotalCount,
} from "@/components/contribution-graph";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function GitHubContributions({
  contributions,
  githubProfileUrl,
  locale,
  dict,
  className,
}: {
  contributions: Promise<Activity[]>;
  githubProfileUrl: string;
  locale: Locale;
  dict: Dictionary;
  className?: string;
}) {
  const data = use(contributions);

  return (
    <ContributionGraph
      className={cn("mx-auto py-2", className)}
      data={data}
      blockSize={11}
      blockMargin={3}
      blockRadius={2}
      labels={{
        months: dict.contributions.months,
        legend: dict.contributions.legend,
      }}
    >
      <ContributionGraphCalendar
        className="no-scrollbar px-2"
        title={dict.contributions.graphTitle}
      >
        {({ activity, dayIndex, weekIndex }) => (
          <Tooltip>
            <TooltipTrigger render={<g />}>
              <ContributionGraphBlock
                activity={activity}
                dayIndex={dayIndex}
                weekIndex={weekIndex}
              />
            </TooltipTrigger>
            <TooltipContent className="font-sans">
              <p>
                {(activity.count === 1
                  ? dict.contributions.tooltipOne
                  : dict.contributions.tooltipOther
                )
                  .replace("{{count}}", String(activity.count))
                  .replace(
                    "{{date}}",
                    format(new Date(activity.date), "dd.MM.yyyy"),
                  )}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </ContributionGraphCalendar>

      <ContributionGraphFooter className="px-2">
        <ContributionGraphTotalCount>
          {({ totalCount }) => (
            <div className="text-zinc-500">
              {dict.contributions.footerPrefix.replace(
                "{{count}}",
                totalCount.toLocaleString(locale === "pt" ? "pt-BR" : "en"),
              )}{" "}
              <a
                className="text-zinc-800 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-400 underline"
                href={githubProfileUrl}
                target="_blank"
                rel="noopener"
              >
                GitHub
              </a>
              .
            </div>
          )}
        </ContributionGraphTotalCount>

        <ContributionGraphLegend />
      </ContributionGraphFooter>
    </ContributionGraph>
  );
}

export function GitHubContributionsFallback() {
  return (
    <div className="flex h-40.5 w-full items-center justify-center">
      <Spinner className="text-zinc-400" />
    </div>
  );
}
