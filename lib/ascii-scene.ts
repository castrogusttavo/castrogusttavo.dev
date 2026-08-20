/**
 * Scenes for an ASCII-shaded illustration.
 *
 * A scene fills a grid with indices into its own character ramp, and knows
 * nothing about the DOM, the theme or the clock. That is the whole contract:
 * swapping the illustration is swapping one object.
 *
 * `GLOBE` renders the classic "spinning donut" surface — a torus, lit by a
 * directional light and rasterised straight into a character grid with a
 * per-cell depth buffer, no mesh or GPU involved. Only the top half of the
 * ring is kept, so it reads as a globe's curve rather than a full donut.
 */

export type Scene = {
  /**
   * Characters from dimmest to brightest. Index 0 has to be a space: it is
   * what every cell the scene does not reach stays as.
   */
  ramp: string;
  /** How tall the scene wants to be, as a share of its width. */
  ratio: number;
  /**
   * Fills `cells` with one ramp index per cell, row-major.
   *
   * `cellAspect` is the character box's height over its width, near 1.7 for a
   * monospace face at a line height of one — without it the shape comes out
   * stretched sideways, because a grid of characters is not a grid of
   * squares. `time` is in seconds.
   */
  draw(
    cells: Uint8Array,
    cols: number,
    rows: number,
    cellAspect: number,
    time: number,
  ): void;
};

type Ring = { cos: Float32Array; sin: Float32Array };

function ring(steps: number): Ring {
  const cos = new Float32Array(steps);
  const sin = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  return { cos, sin };
}

const rings = new Map<number, Ring>();

function ringOf(steps: number): Ring {
  const key = Math.min(4096, Math.max(64, Math.round(steps / 32) * 32));
  let cached = rings.get(key);
  if (!cached) {
    cached = ring(key);
    rings.set(key, cached);
  }
  return cached;
}

/** Tube radius and ring radius — the two circles a torus is built from. */
const TUBE_RADIUS = 1;
const RING_RADIUS = 2;

/** Face-on diameter as a share of the scene's width. */
const SPAN = 1.05;

/** How much of the ring is kept, measured down from its top edge — half, so
    the crop reads as a globe's curve rather than a full ring. */
const REVEAL = 0.5;

/** Samples per cell along each surface direction. */
const DENSITY = 1.8;

/** How far the ring leans away from the viewer, and how much that lean
    drifts — without a lean the ring reads as a flat band face-on. */
const LEAN = 0.42;
const LEAN_DRIFT = 0.13;
const LEAN_DRIFT_RATE = 0.21;

/**
 * The light circles the scene once every twenty-odd seconds.
 *
 * A torus turned about its own axis maps onto itself, so spinning the ring
 * itself would be invisible; moving the light instead is what actually
 * reads as motion.
 */
const LIGHT_RATE = 0.3;
const LIGHT_HEIGHT = 0.42;

/** Floor under the lighting, so a surface facing away still reads instead of
    dropping to nothing. */
const AMBIENT = 0.14;

function diameter(cols: number, cellAspect: number): number {
  return (SPAN * cols) / cellAspect;
}

let depth = new Float32Array(0);

export const GLOBE: Scene = {
  ramp: " .,-~:;=!*#$@",

  ratio: REVEAL * SPAN,

  draw(cells, cols, rows, cellAspect, time) {
    cells.fill(0);

    const count = cols * rows;
    if (depth.length < count) depth = new Float32Array(count);
    depth.fill(-Infinity, 0, count);

    const lean = LEAN + Math.sin(time * LEAN_DRIFT_RATE) * LEAN_DRIFT;
    const cosLean = Math.cos(lean);
    const sinLean = Math.sin(lean);

    /* The light orbits at a fixed height above the scene. */
    const angle = time * LIGHT_RATE;
    const flat = Math.sqrt(1 - LIGHT_HEIGHT * LIGHT_HEIGHT);
    const lightX = Math.cos(angle) * flat;
    const lightY = LIGHT_HEIGHT;
    const lightZ = Math.sin(angle) * flat;

    const span = diameter(cols, cellAspect);
    /* Orthographic on purpose — under perspective the far side of a leaned
       ring projects smaller than the near one, and the crop stops being
       symmetric about the middle. */
    const unit = span / (2 * (TUBE_RADIUS + RING_RADIUS));
    /* Height the surface reaches at this lean, so the top of the crop sits
       on row zero regardless of how far it currently leans. */
    const top = RING_RADIUS * cosLean + TUBE_RADIUS;

    const sweep = ringOf(Math.PI * SPAN * cols * DENSITY);
    const tube = ringOf(Math.PI * (span / 3) * cellAspect * DENSITY);
    const shades = this.ramp.length - 1;

    for (let i = 0; i < tube.cos.length; i += 1) {
      const cosTube = tube.cos[i];
      const sinTube = tube.sin[i];
      const radiusFromAxis = RING_RADIUS + TUBE_RADIUS * cosTube;
      const alongAxis = TUBE_RADIUS * sinTube;

      for (let j = 0; j < sweep.cos.length; j += 1) {
        const cosSweep = sweep.cos[j];
        const sinSweep = sweep.sin[j];

        /* Point and surface normal both lean back by the same rotation
           about the horizontal axis — the one rotation that leaves the
           ring's width, and so the crop's width, exactly where it was. */
        const flatY = radiusFromAxis * sinSweep;
        const y = flatY * cosLean - alongAxis * sinLean;
        const row = (unit * (top - y)) | 0;
        if (row < 0 || row >= rows) continue;

        const col =
          (cols / 2 + unit * radiusFromAxis * cosSweep * cellAspect) | 0;
        if (col < 0 || col >= cols) continue;

        const cell = row * cols + col;
        const z = flatY * sinLean + alongAxis * cosLean;
        /* Nearest wins, and it wins before it is lit. */
        if (z <= depth[cell]) continue;
        depth[cell] = z;

        const normalY = cosTube * sinSweep;
        const lum =
          cosTube * cosSweep * lightX +
          (normalY * cosLean - sinTube * sinLean) * lightY +
          (normalY * sinLean + sinTube * cosLean) * lightZ;

        const shade = lum > 0 ? AMBIENT + (1 - AMBIENT) * lum : AMBIENT;
        const step = 1 + ((shade * shades) | 0);
        cells[cell] = step > shades ? shades : step;
      }
    }
  },
};
