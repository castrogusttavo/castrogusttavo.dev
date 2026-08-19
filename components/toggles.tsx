"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import * as React from "react";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/locale";
import { switchLocale } from "@/lib/switch-locale";

function MonitorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function MoonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      {...props}
    >
      <path
        d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const THEMES = [
  { value: "system", Icon: MonitorIcon },
  { value: "light", Icon: SunIcon },
  { value: "dark", Icon: MoonIcon },
] as const;

type ThemeValue = (typeof THEMES)[number]["value"];

const toggleClass =
  "relative flex h-[28px] cursor-pointer items-center rounded-xl px-2 py-1.5 text-xs font-medium select-none transition-colors duration-150 hover:bg-zinc-100 active:scale-[0.97] motion-reduce:active:scale-100 dark:hover:bg-zinc-800";

export function ToggleSeparator() {
  return (
    <div aria-hidden className="mx-1 h-4 w-px bg-zinc-200 dark:bg-white/10" />
  );
}

export function LanguageToggle({
  locale,
  dict,
}: {
  locale: Locale;
  dict: Dictionary;
}) {
  const next: Locale = locale === "pt" ? "en" : "pt";

  return (
    <button
      type="button"
      onClick={() => switchLocale(next)}
      className={toggleClass}
      aria-label={dict.toggles.language}
    >
      {locale.toUpperCase()}
    </button>
  );
}

/**
 * A tray of three rather than one button that cycles.
 *
 * Cycling hid two things: which theme was set, and how many presses it would
 * take to reach the one you wanted. Three targets say both at a glance.
 */
export function ThemeToggle({ dict }: { dict: Dictionary }) {
  const { theme, setTheme } = useTheme();
  const shouldReduceMotion = useReducedMotion();

  // `theme` is only known on the client, so the highlight is not drawn until
  // mount. That keeps the first client render identical to the server's.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const current: ThemeValue =
    theme === "dark" ? "dark" : theme === "light" ? "light" : "system";

  const transition = shouldReduceMotion
    ? { duration: 0.12 }
    : { type: "spring" as const, duration: 0.35, bounce: 0.15 };

  return (
    <div
      role="radiogroup"
      aria-label={dict.toggles.theme}
      className="flex items-center gap-0.5 rounded-full border border-zinc-200 p-0.5 dark:border-white/10"
    >
      {THEMES.map(({ value, Icon }) => {
        const active = mounted && current === value;

        return (
          // biome-ignore lint/a11y/useSemanticElements: a native radio input can't host an icon child the way this tray's pill highlight needs to.
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={dict.toggles.themeNames[value]}
            title={dict.toggles.themeNames[value]}
            onClick={() => setTheme(value)}
            className="relative grid size-6 cursor-pointer place-items-center rounded-full transition-transform duration-150 active:scale-[0.92] motion-reduce:active:scale-100"
          >
            {active && (
              <motion.span
                layoutId="theme-tray-active"
                transition={transition}
                className="absolute inset-0 rounded-full bg-zinc-100 dark:bg-zinc-800"
              />
            )}
            <Icon
              className={`relative size-3.5 ${
                active ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-500"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
