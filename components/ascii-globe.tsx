"use client";

import { useReducedMotion } from "motion/react";
import * as React from "react";
import { GLOBE, type Scene } from "@/lib/ascii-scene";

const SCENE: Scene = GLOBE;

/** The character box, in pixels. Fixed so the grid arithmetic doesn't depend
    on how `line-height: 1` happens to resolve. */
const FONT_SIZE = 10;
const LINE_HEIGHT = 10;

/** Redraws a second. 24 reads as motion and leaves the frame budget alone. */
const FPS = 24;
const FRAME_MS = 1000 / FPS;

function measureCell(fontFamily: string): number {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return FONT_SIZE * 0.6;

  context.font = `${FONT_SIZE}px ${fontFamily}`;
  const sample = "0".repeat(32);
  const width = context.measureText(sample).width / sample.length;
  return width > 0 ? width : FONT_SIZE * 0.6;
}

export function AsciiGlobe({ label }: { label: string }) {
  const ref = React.useRef<HTMLPreElement>(null);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const pre = ref.current;
    if (!pre) return;

    let cells = new Uint8Array(0);
    let cols = 0;
    let rows = 0;
    let cellAspect = LINE_HEIGHT / (FONT_SIZE * 0.6);
    let clock = 0.6;
    let onScreen = true;
    let frame = 0;
    let live = true;

    const paint = () => {
      if (cols < 1) return;
      SCENE.draw(cells, cols, rows, cellAspect, clock);

      const ramp = SCENE.ramp;
      let out = "";
      for (let y = 0; y < rows; y += 1) {
        if (y > 0) out += "\n";
        const start = y * cols;
        for (let x = 0; x < cols; x += 1) out += ramp[cells[start + x]];
      }
      pre.textContent = out;
    };

    const measure = () => {
      const charWidth = measureCell(getComputedStyle(pre).fontFamily);
      const nextCols = Math.max(1, Math.floor(pre.clientWidth / charWidth));
      const nextRows = Math.max(1, Math.floor(pre.clientHeight / LINE_HEIGHT));
      if (nextCols === cols && nextRows === rows) return false;

      cols = nextCols;
      rows = nextRows;
      cellAspect = LINE_HEIGHT / charWidth;
      cells = new Uint8Array(cols * rows);
      return true;
    };

    measure();

    if (reduceMotion) {
      paint();
      return;
    }

    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!onScreen) return;
      if (now - last < FRAME_MS) return;
      last = now;
      clock += FRAME_MS / 1000;
      paint();
    };

    frame = requestAnimationFrame(tick);

    const seen = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    seen.observe(pre);

    const resized = new ResizeObserver(() => {
      if (measure()) paint();
    });
    resized.observe(pre);

    document.fonts?.ready.then(() => {
      if (!live) return;
      if (measure()) paint();
    });

    return () => {
      live = false;
      cancelAnimationFrame(frame);
      seen.disconnect();
      resized.disconnect();
    };
  }, [reduceMotion]);

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <pre
        ref={ref}
        aria-hidden="true"
        style={{
          fontSize: FONT_SIZE,
          lineHeight: `${LINE_HEIGHT}px`,
          aspectRatio: 1 / GLOBE.ratio,
          color: "var(--foreground)",
          maskImage:
            "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 14%, black 86%, transparent)",
        }}
        className="w-full overflow-hidden font-mono whitespace-pre select-none"
      />
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}
