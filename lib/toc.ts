import "server-only";
import type { TOCItemType } from "@/components/toc-minimap";

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Same slugging rule the prose renderer uses for heading `id`s, so the
    minimap's `#anchor` links always match a real element on the page. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pulls `##`/`###` headings straight out of the raw markdown, in document
    order, so the minimap can be built before anything is rendered. */
export function extractHeadings(markdown: string): TOCItemType[] {
  const items: TOCItemType[] = [];
  const seen = new Map<string, number>();
  let inCodeFence = false;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!match) continue;

    const depth = match[1].length;
    const title = match[2].trim();
    const base = slugifyHeading(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count > 0 ? `${base}-${count}` : base;

    items.push({ title, url: `#${id}`, depth });
  }

  return items;
}
