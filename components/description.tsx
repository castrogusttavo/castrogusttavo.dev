import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Locale } from "@/lib/locale";
import type { DescriptionSegment } from "@/lib/profile";

export function Description({
  segments,
  locale,
}: {
  segments: DescriptionSegment[];
  locale: Locale;
}) {
  return (
    <p>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, hand-authored sequence of runs — position is the identity.
          <span key={index}>{segment.text[locale]}</span>
        ) : (
          <Tooltip key={segment.href}>
            <TooltipTrigger
              render={
                <Link
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted underline-offset-3 hover:decoration-solid"
                />
              }
            >
              {segment.label[locale]}
            </TooltipTrigger>
            <TooltipContent className="font-sans">
              {segment.tooltip[locale]}
            </TooltipContent>
          </Tooltip>
        ),
      )}
    </p>
  );
}
