"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      {...props}
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

const SPRING_IN = { type: "spring" as const, duration: 0.45, bounce: 0.15 };

/**
 * A markdown image that opens into a full-size dialog on click, matching
 * the lightbox on the home page's photo deck (`components/photo-deck.tsx`).
 * Unlike the deck's cards, chart figures have no fixed aspect ratio, so the
 * enlarged image is bounded by viewport size and left to size itself.
 */
export function WritingImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();

  return (
    <figure className="my-2">
      <button
        type="button"
        aria-label={alt}
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in rounded-lg outline-offset-2 focus-visible:outline-2 focus-visible:outline-black/40 dark:focus-visible:outline-white/40"
      >
        {/* biome-ignore lint/performance/noImgElement: markdown content, no known dimensions for next/image */}
        <img
          src={src}
          alt={alt}
          className="w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
        />
      </button>
      {alt ? (
        <figcaption className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {alt}
        </figcaption>
      ) : null}

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open && (
            <Dialog.Portal keepMounted>
              <Dialog.Backdrop
                render={
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="fixed inset-0 z-50 bg-white/90 backdrop-blur-[3px] dark:bg-zinc-950/90"
                  />
                }
              />
              <Dialog.Popup
                render={
                  <motion.div className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center p-6" />
                }
                onClick={(event) => {
                  if (event.target === event.currentTarget) setOpen(false);
                }}
              >
                <Dialog.Title className="sr-only">{alt}</Dialog.Title>

                <Dialog.Close
                  render={
                    <motion.button
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.25, delay: 0.08 }}
                      aria-label="close"
                      className="fixed top-4 right-4 inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
                    />
                  }
                >
                  <CloseIcon className="size-5" />
                </Dialog.Close>

                <motion.figure
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }
                  }
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={SPRING_IN}
                  className="flex cursor-default flex-col items-center gap-3"
                >
                  {/* biome-ignore lint/performance/noImgElement: dialog preview, arbitrary aspect ratio, sized by viewport not layout */}
                  <img
                    src={src}
                    alt={alt}
                    className="max-h-[80vh] max-w-[90vw] rounded-xl bg-white object-contain shadow-md"
                  />
                  {alt ? (
                    <figcaption className="text-sm text-zinc-500">
                      {alt}
                    </figcaption>
                  ) : null}
                </motion.figure>
              </Dialog.Popup>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </figure>
  );
}
