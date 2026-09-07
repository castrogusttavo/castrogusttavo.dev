import { ImageResponse } from "next/og";
import { formatPostDate } from "@/lib/format-date";
import { isLocale, type Locale } from "@/lib/locale";
import { GITHUB_USERNAME } from "@/lib/profile";
import { estimateReadingMinutes } from "@/lib/reading-time";
import { getWritingPost } from "@/lib/writing";

export const alt = "Article preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale: rawLocale, slug } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "en";
  const post = getWritingPost(locale, slug);

  const title = truncate(post?.frontmatter.title ?? GITHUB_USERNAME, 90);
  const meta = [
    post?.frontmatter.date
      ? formatPostDate(post.frontmatter.date, locale)
      : null,
    post ? `${estimateReadingMinutes(post.content)} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#ffffff",
        padding: 80,
      }}
    >
      <div style={{ display: "flex", fontSize: 28, color: "#71717a" }}>
        {GITHUB_USERNAME}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 60,
          lineHeight: 1.2,
          color: "#09090b",
          marginTop: 32,
          maxWidth: 1000,
        }}
      >
        {title}
      </div>
      {meta ? (
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#a1a1aa",
            marginTop: "auto",
          }}
        >
          {meta}
        </div>
      ) : null}
    </div>,
    { ...size },
  );
}
