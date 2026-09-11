"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons-pro/core-bulk-rounded";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/command-palette";
import type { Dictionary } from "@/lib/dictionaries";
import type { Locale } from "@/lib/locale";
import { NAV_ITEMS } from "@/lib/nav";
import type { SearchItem } from "@/lib/search";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function SiteNav({
  locale,
  dict,
  searchItems,
}: {
  locale: Locale;
  dict: Dictionary;
  searchItems: SearchItem[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (key === "d") {
        event.preventDefault();
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        return;
      }

      const item = NAV_ITEMS.find((candidate) => candidate.key === key);
      if (!item) return;

      event.preventDefault();
      router.push(item.href(locale));
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [locale, router, resolvedTheme, setTheme]);

  return (
    <div className="sticky top-0 z-50 w-full bg-white px-6 pt-6 pb-4 shadow-sm dark:bg-zinc-950">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-152 items-center gap-4 text-sm"
      >
        {NAV_ITEMS.map((item) => {
          const href = item.href(locale);
          const active =
            href === `/${locale}`
              ? pathname === href
              : pathname.startsWith(href);

          return (
            <Link
              key={item.key}
              href={href}
              className={`flex items-center gap-1 transition-colors ${
                active
                  ? "text-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
              }`}
            >
              {item.label(dict)}
              <span className="text-xs text-zinc-400" aria-hidden>
                [{item.key}]
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ml-auto flex items-center gap-1.5 text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          <HugeiconsIcon icon={Search01Icon} size={14} />
          {dict.nav.search}
          <span className="text-xs text-zinc-400" aria-hidden>
            [⌘K]
          </span>
        </button>
      </nav>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        items={searchItems}
        dict={dict}
      />
    </div>
  );
}
