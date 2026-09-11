import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import type { Locale } from "@/lib/locale";
import type { WritingPost } from "@/lib/writing";
import { resolveWritingIcon } from "@/lib/writing-icons";

export function FeaturedWriting({
  posts,
  locale,
}: {
  posts: WritingPost[];
  locale: Locale;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {posts.map((post) => (
        <Link
          key={post.slug}
          href={`/${locale}/writing/${post.slug}`}
          className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <HugeiconsIcon
              icon={resolveWritingIcon(post.frontmatter.icon)}
              size={18}
              className="text-zinc-500"
            />
          </div>
          <h3 className="text-base font-normal">{post.frontmatter.title}</h3>
        </Link>
      ))}
    </div>
  );
}
