"use client";

import { Dialog } from "@base-ui/react/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, SourceCodeIcon } from "@hugeicons-pro/core-bulk-rounded";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dictionary } from "@/lib/dictionaries";
import { type SearchItem, searchItems } from "@/lib/search";
import { resolveWritingIcon } from "@/lib/writing-icons";

export function CommandPalette({
  open,
  onOpenChange,
  items,
  dict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SearchItem[];
  dict: Dictionary;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchItems(items, query).slice(0, 8),
    [items, query],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-running on query change to reset the selection, even though the body doesn't read query
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [open]);

  function go(item: SearchItem) {
    onOpenChange(false);
    router.push(item.href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) go(item);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 dark:bg-black/50" />
        <Dialog.Popup
          onKeyDown={handleKeyDown}
          className="fixed top-24 left-1/2 z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg outline-none dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="shrink-0 text-zinc-400"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dict.nav.searchPlaceholder}
              className="w-full bg-transparent py-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-50"
            />
          </div>

          <ul className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 ? (
              <li className="px-2 py-6 text-center text-sm text-zinc-400">
                {dict.nav.noResults}
              </li>
            ) : (
              results.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => go(item)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm ${
                      index === activeIndex
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : ""
                    }`}
                  >
                    <HugeiconsIcon
                      icon={
                        item.type === "project"
                          ? SourceCodeIcon
                          : resolveWritingIcon(item.iconKey)
                      }
                      size={16}
                      className="shrink-0 text-zinc-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-zinc-950 dark:text-zinc-50">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {item.type === "project"
                        ? dict.nav.resultProject
                        : dict.nav.resultPost}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
