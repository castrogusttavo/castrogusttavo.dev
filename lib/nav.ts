import type { Dictionary } from "./dictionaries";
import type { Locale } from "./locale";

/**
 * `key` is the single-character keyboard shortcut that jumps there from
 * anywhere on the site — kept as literal Latin letters regardless of locale,
 * since it's a shortcut, not page copy. The label itself is localized.
 */
export type NavItem = {
  key: string;
  label: (dict: Dictionary) => string;
  href: (locale: Locale) => string;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "h", label: (dict) => dict.nav.home, href: (locale) => `/${locale}` },
  {
    key: "b",
    label: (dict) => dict.nav.writing,
    href: (locale) => `/${locale}/writing`,
  },
  {
    key: "p",
    label: (dict) => dict.nav.project,
    href: (locale) => `/${locale}/project`,
  },
];
