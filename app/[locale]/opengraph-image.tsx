import { ImageResponse } from "next/og";
import { isLocale, type Locale } from "@/lib/locale";
import { description, GITHUB_USERNAME } from "@/lib/profile";

export const alt = "Developer portfolio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

function plainDescription(locale: Locale): string {
  return description
    .map((segment) =>
      segment.type === "text" ? segment.text[locale] : segment.label[locale],
    )
    .join("");
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "en";

  const res = await fetch(`https://api.github.com/users/${GITHUB_USERNAME}`, {
    headers: { Accept: "application/vnd.github+json" },
    next: { revalidate: 3600 },
  });

  const user = res.ok ? await res.json() : null;
  const name = user?.name ?? GITHUB_USERNAME;
  const avatarUrl = user?.avatar_url as string | undefined;
  const bio = plainDescription(locale);

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
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        {avatarUrl ? (
          // biome-ignore lint/performance/noImgElement: Satori (next/og) renders this outside the DOM and doesn't support next/image
          <img
            src={avatarUrl}
            width={160}
            height={160}
            alt=""
            style={{ borderRadius: "50%", border: "3px solid #71717a" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              width: 160,
              height: 160,
              borderRadius: "50%",
              border: "3px solid #71717a",
              background: "#f4f4f5",
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 56, color: "#09090b" }}>
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#71717a" }}>
            @{GITHUB_USERNAME}
          </div>
        </div>
      </div>
      {bio ? (
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#3f3f46",
            marginTop: 48,
            maxWidth: 1000,
          }}
        >
          {bio}
        </div>
      ) : null}
    </div>,
    { ...size },
  );
}
