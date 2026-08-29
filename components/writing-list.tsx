import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { WritingPostMeta } from "@/components/writing-post-meta";
import type { Locale } from "@/lib/locale";
import type { WritingPost } from "@/lib/writing";
import { resolveWritingIcon } from "@/lib/writing-icons";

export function WritingList({
  posts,
  locale,
}: {
  posts: WritingPost[];
  locale: Locale;
}) {
  return (
    <div className="flex flex-col gap-2 group">
      {posts.map((post) => (
        <Link
          key={post.slug}
          href={`/${locale}/writing/${post.slug}`}
          className="flex items-center gap-3 rounded-lg p-2 -mx-2 opacity-100 transition duration-200 hover:bg-zinc-50 group-has-[a:hover]:opacity-40 hover:opacity-100! dark:hover:bg-zinc-900"
        >
          <div className="bg-primary-foreground border border-border size-9 flex items-center justify-center rounded-lg group-hover:scale-[1.06]">
            <HugeiconsIcon
              icon={resolveWritingIcon(post.frontmatter.icon)}
              size={20}
              className="mt-1 shrink-0 text-zinc-500"
            />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <WritingPostMeta
              title={post.frontmatter.title}
              description={post.frontmatter.description}
            />
          </div>
        </Link>
      ))}
    </div>
  );
}
