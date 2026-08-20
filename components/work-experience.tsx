"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/locale";
import type { WorkExperience } from "@/lib/profile";

/** Height of the collapsed peek, in px — enough to hint there's a second
    bullet under the fade without showing it whole. */
const COLLAPSED_HEIGHT = 28;

export function WorkExperienceEntry({
  entry,
  locale,
  dict,
}: {
  entry: WorkExperience;
  locale: Locale;
  dict: Dictionary;
}) {
  const [expanded, setExpanded] = useState(false);
  const [first, ...rest] = entry.bullets;

  /**
   * `max-height` only transitions smoothly when the distance it travels
   * matches the real content — jumping to an arbitrary large value makes the
   * visible reveal happen in a fraction of the animation, then coast through
   * empty space. Measuring the list gives the transition its real endpoint.
   */
  const contentRef = useRef<HTMLUListElement>(null);
  const [fullHeight, setFullHeight] = useState(COLLAPSED_HEIGHT);

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const measure = () => setFullHeight(node.scrollHeight);
    measure();

    const resized = new ResizeObserver(measure);
    resized.observe(node);
    return () => resized.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <h3>{entry.role[locale]}</h3>
      <p className="text-sm font-normal text-zinc-700 dark:text-zinc-300">
        {entry.companyUrl ? (
          <Link
            href={entry.companyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {entry.company}
          </Link>
        ) : (
          entry.company
        )}{" "}
        · {entry.period}
      </p>

      {first && (
        <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>→ {first[locale]}</li>
        </ul>
      )}

      {rest.length > 0 && (
        <>
          <div
            style={{ maxHeight: expanded ? fullHeight : COLLAPSED_HEIGHT }}
            className="relative overflow-hidden transition-[max-height] duration-300 ease-in-out"
          >
            <ul
              ref={contentRef}
              className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400"
            >
              {rest.map((bullet) => (
                <li key={bullet[locale]}>→ {bullet[locale]}</li>
              ))}
            </ul>
            {/* The "shadow cutting the view" — fades out in step with the
                expand so the cut never visibly snaps away. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent transition-opacity duration-300 ease-in-out dark:from-zinc-950 ${
                expanded ? "opacity-0" : "opacity-100"
              }`}
            />
          </div>

          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="self-start text-xs text-zinc-500 underline decoration-dotted underline-offset-3 hover:text-zinc-950 hover:decoration-solid dark:hover:text-zinc-50"
          >
            {expanded ? dict.experience.showLess : dict.experience.showMore}
          </button>
        </>
      )}
    </div>
  );
}
