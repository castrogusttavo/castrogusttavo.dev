export type SearchItem = {
  id: string;
  type: "post" | "project";
  title: string;
  description: string;
  href: string;
  /** Post-only: the frontmatter icon key (see writing-icons.ts). */
  iconKey?: string;
};

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A relevance score, not a boolean match — good enough for ~20 items that
 * a real fuzzy-search library would be overkill for. A title match always
 * outranks a description match, and matching at a word boundary ("cache" in
 * "read-through cache") outranks matching mid-word ("ache" in "cache").
 */
function scoreItem(item: SearchItem, query: string): number {
  const title = normalize(item.title);
  const description = normalize(item.description);
  const q = normalize(query).trim();
  if (!q) return 0;

  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(title)) return 60;
  if (title.includes(q)) return 40;
  if (description.includes(q)) return 20;
  return 0;
}

export function searchItems(items: SearchItem[], query: string): SearchItem[] {
  if (!query.trim()) return items;

  return items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
