import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { WritingImage } from "@/components/writing-image";
import { slugifyHeading } from "@/lib/toc";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (
    node &&
    typeof node === "object" &&
    "props" in node &&
    node.props &&
    typeof node.props === "object" &&
    "children" in node.props
  ) {
    return textOf(node.props.children as ReactNode);
  }
  return "";
}

/**
 * `id`s are assigned here rather than left to the browser's default anchor
 * behaviour, and deduped the same way `lib/toc.ts` dedupes its own list —
 * built once per render, so two headings with the same text still get
 * distinct anchors and the minimap's `#anchor` links land on the right one.
 */
function useHeadingIds() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count > 0 ? `${base}-${count}` : base;
  };
}

export function WritingProse({ content }: { content: string }) {
  const idFor = useHeadingIds();

  const components: Components = {
    h2: ({ children }) => (
      <h2
        id={idFor(textOf(children))}
        className="mt-8 mb-2 scroll-mt-24 text-xl font-semibold text-zinc-950 dark:text-zinc-50"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={idFor(textOf(children))}
        className="mt-6 mb-2 scroll-mt-24 text-lg font-normal text-zinc-950 dark:text-zinc-50"
      >
        {children}
      </h3>
    ),
    p: ({ children, node }) => {
      // A markdown paragraph that's only an image (`![]()` on its own line)
      // would otherwise wrap WritingImage's <figure>/<button>/<figcaption>
      // in a <p>, which is invalid HTML and breaks hydration.
      const isSoleImage =
        node?.children.length === 1 &&
        node.children[0].type === "element" &&
        node.children[0].tagName === "img";
      if (isSoleImage) return <>{children}</>;
      return (
        <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
          {children}
        </p>
      );
    },
    a: ({ href, children }) => (
      <Link
        href={href ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted underline-offset-3 hover:decoration-solid"
      >
        {children}
      </Link>
    ),
    ul: ({ children }) => (
      <ul className="list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal space-y-1 pl-5 text-zinc-700 dark:text-zinc-300">
        {children}
      </ol>
    ),
    code: ({ children, className }) =>
      className ? (
        <code className={className}>{children}</code>
      ) : (
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.85em] dark:bg-zinc-800">
          {children}
        </code>
      ),
    pre: ({ children }) => (
      <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-zinc-300 pl-4 text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400">
        {children}
      </blockquote>
    ),
    img: ({ src, alt }) =>
      typeof src === "string" ? (
        <WritingImage src={src} alt={alt ?? ""} />
      ) : null,
  };

  return (
    <div className="flex flex-col gap-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
