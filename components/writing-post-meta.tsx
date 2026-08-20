"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function WritingPostMeta({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [showDescription, setShowDescription] = useState(false);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;

    const checkFit = () => {
      setShowDescription(el.scrollWidth <= el.clientWidth);
    };

    checkFit();

    const observer = new ResizeObserver(checkFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <h3
        ref={titleRef}
        className="max-w-full shrink-0 truncate text-base font-normal"
      >
        {title}
      </h3>
      {showDescription && (
        <p className="min-w-0 flex-1 truncate text-sm text-zinc-500">
          {description}
        </p>
      )}
    </>
  );
}
