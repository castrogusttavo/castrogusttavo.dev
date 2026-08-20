"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import * as React from "react";
import type { Locale } from "@/lib/locale";
import type { Photo } from "@/lib/profile";

/**
 * The fanned pile of photographs — "por aí" / "elsewhere". Adapted from
 * https://github.com/matheuscarddoso/mcardoso's photo deck: every card is the
 * same size and cropped to a shared ratio, so the fan reads as a deck rather
 * than a stack of differently-shaped paper.
 */

/** Card proportion — portrait, close to a Polaroid. */
export const CARD_RATIO = 0.85;
/** Degrees between one card and the next, so the pile reads as a fan. */
const TILT = 5.5;
/** How far the outermost cards sag below the middle one, as % of height. */
const ARC = 7;

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

const LIFT = { type: "spring" as const, duration: 0.4, bounce: 0.3 };
const SPRING_IN = { type: "spring" as const, duration: 0.45, bounce: 0.15 };

export function PhotoDeck({
  photos,
  locale,
}: {
  photos: Photo[];
  locale: Locale;
}) {
  const [active, setActive] = React.useState<Photo | null>(null);
  const [lifted, setLifted] = React.useState<number | null>(null);
  const reduceMotion = useReducedMotion();

  if (photos.length === 0) return null;

  const cardWidth = `${200 / (photos.length + 1)}%`;
  const overlap = `-${100 / (photos.length + 1)}%`;

  return (
    <>
      <div className="flex w-full overflow-visible pt-6 pb-4">
        {photos.map((photo, index) => {
          const offset = index - (photos.length - 1) / 2;
          const tilt = offset * TILT;
          const arc = ARC * (offset / ((photos.length - 1) / 2 || 1)) ** 2;
          const isLifted = lifted === index;

          return (
            <motion.button
              key={`${photo.src}-${index}`}
              type="button"
              aria-label={photo.caption[locale]}
              onClick={() => setActive(photo)}
              onHoverStart={() => setLifted(index)}
              onHoverEnd={() =>
                setLifted((current) => (current === index ? null : current))
              }
              onFocus={() => setLifted(index)}
              onBlur={() =>
                setLifted((current) => (current === index ? null : current))
              }
              animate={{
                rotate: isLifted ? 0 : tilt,
                y: isLifted ? "-13%" : `${arc}%`,
                scale: isLifted ? 1.08 : 1,
              }}
              transition={reduceMotion ? { duration: 0.12 } : LIFT}
              style={{
                width: cardWidth,
                aspectRatio: CARD_RATIO,
                marginLeft: index === 0 ? 0 : overlap,
                zIndex: isLifted ? photos.length : index,
              }}
              className="relative shrink-0 cursor-zoom-in rounded-xl bg-white p-1 shadow-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-black/40 dark:bg-zinc-800 dark:focus-visible:outline-white/40"
            >
              <span className="block h-full w-full overflow-hidden rounded-lg">
                <Image
                  src={photo.src}
                  alt=""
                  width={304}
                  height={Math.round(304 / CARD_RATIO)}
                  className="h-full w-full object-cover grayscale"
                />
              </span>
            </motion.button>
          );
        })}
      </div>

      <Dialog.Root
        open={Boolean(active)}
        onOpenChange={(next) => !next && setActive(null)}
      >
        <AnimatePresence>
          {active && (
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
                  if (event.target === event.currentTarget) setActive(null);
                }}
              >
                <Dialog.Title className="sr-only">
                  {active.caption[locale]}
                </Dialog.Title>

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
                  <div
                    style={{
                      width: `min(86vw, calc(76vh * ${(active.width / active.height).toFixed(4)}))`,
                      aspectRatio: `${active.width} / ${active.height}`,
                    }}
                    className="relative overflow-hidden rounded-xl bg-zinc-200 shadow-md dark:bg-zinc-800"
                  >
                    <Image
                      src={active.src}
                      alt={active.caption[locale]}
                      width={active.width}
                      height={active.height}
                      unoptimized
                      priority
                      className="relative h-full w-full object-cover grayscale"
                    />
                  </div>
                  <figcaption className="text-sm text-zinc-500">
                    {active.caption[locale]}
                  </figcaption>
                </motion.figure>
              </Dialog.Popup>
            </Dialog.Portal>
          )}
        </AnimatePresence>
      </Dialog.Root>
    </>
  );
}
