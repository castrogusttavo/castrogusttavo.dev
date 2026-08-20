/**
 * A rough words-per-minute estimate off the raw markdown — code fences,
 * inline code and link/image syntax are stripped first since they read much
 * faster (or aren't read at all) compared to prose.
 */
const WORDS_PER_MINUTE = 200;

export function estimateReadingMinutes(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~-]/g, " ");

  const words = plain.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
