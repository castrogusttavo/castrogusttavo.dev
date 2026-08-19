import { type NextRequest, NextResponse } from "next/server";
import { LOCALES } from "@/lib/locale";

function detectLocale(request: NextRequest): string {
  const acceptLanguage =
    request.headers.get("accept-language")?.toLowerCase() ?? "";
  return acceptLanguage.includes("pt") ? "pt" : "en";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const locale = detectLocale(request);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;

  // 307, not 308: the target depends on the request, so it must never be
  // remembered by the browser. `Vary` says the same to shared caches — without
  // it one visitor's language decides the redirect for everyone behind that
  // CDN node.
  const response = NextResponse.redirect(url, 307);
  response.headers.set("vary", "accept-language");
  return response;
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
