import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Locale } from "./locale";

/**
 * Articles live as `.md` files under `content/writing/<locale>/<slug>.md`,
 * frontmatter first. The slug is the filename, not a frontmatter field: two
 * sources of truth for the same value is how they drift apart.
 */
const CONTENT_DIR = path.join(process.cwd(), "content", "writing");

export type WritingFrontmatter = {
  title: string;
  description: string;
  /** Short key into `WRITING_ICONS` — see `lib/writing-icons.ts`. */
  icon?: string;
  date?: string;
};

export type WritingPost = {
  slug: string;
  frontmatter: WritingFrontmatter;
  content: string;
};

function localeDir(locale: Locale): string {
  return path.join(CONTENT_DIR, locale);
}

/**
 * YAML has an implicit date type, so an unquoted `date: 2026-08-18` in
 * frontmatter arrives here as a real `Date`, not a string — `String()` on
 * that gives a full timestamp, not `yyyy-MM-dd`.
 */
function normalizeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

export function getWritingSlugs(locale: Locale): string[] {
  const dir = localeDir(locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.replace(/\.md$/, ""));
}

export function getWritingPost(
  locale: Locale,
  slug: string,
): WritingPost | null {
  const file = path.join(localeDir(locale), `${slug}.md`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);

  return {
    slug,
    frontmatter: {
      title: String(data.title ?? slug),
      description: String(data.description ?? ""),
      icon: data.icon ? String(data.icon) : undefined,
      date: data.date ? normalizeDate(data.date) : undefined,
    },
    content,
  };
}

export function getAllWritingPosts(locale: Locale): WritingPost[] {
  return getWritingSlugs(locale)
    .map((slug) => getWritingPost(locale, slug))
    .filter((post): post is WritingPost => post !== null)
    .sort((a, b) =>
      (b.frontmatter.date ?? "").localeCompare(a.frontmatter.date ?? ""),
    );
}

/**
 * Hand-picked, in display order — not "most recent," not "most read" (no
 * analytics pipeline for that yet). Edit this array to change what the home
 * page features; the full archive at `/writing` is unaffected.
 */
export const FEATURED_WRITING_SLUGS: string[] = [
  "background-jobs-with-bullmq",
  "errors-as-values",
  "read-through-cache-with-redis",
  "cost-of-founding-a-software-startup",
  "tiptap-to-platejs",
];

export function getFeaturedWritingPosts(locale: Locale): WritingPost[] {
  return FEATURED_WRITING_SLUGS.map((slug) =>
    getWritingPost(locale, slug),
  ).filter((post): post is WritingPost => post !== null);
}
