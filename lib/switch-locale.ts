import { LOCALES, type Locale } from "./locale";

/** Matches a leading locale segment, and only a whole one — not `/english`. */
const LOCALE_PREFIX = new RegExp(`^/(?:${LOCALES.join("|")})(?=/|$)`);

/**
 * Changing language is a document-level change: `<html lang>`, the title and
 * the description are all different.
 *
 * It has to be a real navigation, not `router.push`. The root layout lives
 * under `app/[locale]`, so a soft navigation changes the value of that
 * dynamic segment — which remounts the root layout, html and body and the
 * theme provider with it, visible as the whole page flickering. A document
 * navigation instead lets the browser paint the next page only after
 * next-themes' blocking script has already set the class.
 */
export function switchLocale(next: Locale): void {
  const { pathname, search, hash } = window.location;
  const tail = pathname.replace(LOCALE_PREFIX, "");
  window.location.assign(`/${next}${tail}${search}${hash}`);
}
