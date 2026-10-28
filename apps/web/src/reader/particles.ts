import type { Mood } from "./book";

/**
 * The air behind the book: motes of dust, rising embers, fireflies, rain, stars. Drawn on one
 * canvas. `step` moves them and keeps them on the canvas, and takes its randomness as an argument,
 * so a run can be repeated in a test.
 */

export type Weather = "dust" | "embers" | "fireflies" | "rain" | "stars" | "none";

export const MOOD_WEATHER: Record<Mood, Weather> = {
  dusk: "dust",
  ember: "embers",
  forest: "fireflies",
  rain: "rain",
  moon: "stars",
  ink: "none",
};

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius, or the length of a streak. */
  r: number;
  /** Where in its flicker or sway it is. */
  phase: number;
}

type Random = () => number;

/** How many of each fit a canvas: more on a bigger one, never none and never a swarm. */
export function countFor(kind: Weather, w: number, h: number): number {
  const area = w * h;
  const per: Record<Weather, number> = {
    dust: 16000,
    embers: 26000,
    fireflies: 30000,
    rain: 5200,
    stars: 9000,
    none: Number.POSITIVE_INFINITY,
  };
  return kind === "none" ? 0 : Math.max(12, Math.min(220, Math.round(area / per[kind])));
}

function spawn(kind: Weather, w: number, h: number, rand: Random, anywhere: boolean): Particle {
  const x = rand() * w;
  const phase = rand() * Math.PI * 2;
  switch (kind) {
    case "embers":
      return {
        x,
        y: anywhere ? rand() * h : h + 10,
        vx: (rand() - 0.5) * 14,
        vy: -(22 + rand() * 44),
        r: 0.8 + rand() * 1.8,
        phase,
      };
    case "rain":
      return {
        x,
        y: anywhere ? rand() * h : -30,
        vx: -90,
        vy: 620 + rand() * 280,
        r: 12 + rand() * 18,
        phase,
      };
    case "fireflies":
      return {
        x,
        y: rand() * h,
        vx: (rand() - 0.5) * 24,
        vy: (rand() - 0.5) * 24,
        r: 1.4 + rand() * 1.6,
        phase,
      };
    case "stars":
      return { x, y: rand() * h, vx: 0, vy: 0, r: 0.4 + rand() * 1.3, phase };
    default:
      return {
        x,
        y: anywhere ? rand() * h : h + 6,
        vx: (rand() - 0.5) * 10,
        vy: -(4 + rand() * 12),
        r: 0.6 + rand() * 1.9,
        phase,
      };
  }
}

export function seed(kind: Weather, w: number, h: number, rand: Random = Math.random): Particle[] {
  return Array.from({ length: countFor(kind, w, h) }, () => spawn(kind, w, h, rand, true));
}

/** Moves every particle on by `dt` seconds; one that leaves comes back in at its far side. */
export function step(
  kind: Weather,
  ps: Particle[],
  w: number,
  h: number,
  dt: number,
  time: number,
  rand: Random = Math.random,
): void {
  for (const [i, p] of ps.entries()) {
    if (kind === "fireflies") {
      // wander: the heading drifts a little all the time
      p.vx += Math.cos(time * 0.7 + p.phase) * 18 * dt;
      p.vy += Math.sin(time * 0.9 + p.phase * 1.7) * 18 * dt;
      p.vx = Math.max(-26, Math.min(26, p.vx));
      p.vy = Math.max(-26, Math.min(26, p.vy));
    } else if (kind === "embers" || kind === "dust") {
      p.vx += Math.sin(time * 0.8 + p.phase) * 10 * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const gone = p.y < -20 || p.y > h + 40 || p.x < -20 || p.x > w + 20;
    if (!gone) continue;
    if (kind === "rain" || kind === "embers" || kind === "dust") {
      ps[i] = spawn(kind, w, h, rand, false);
      // rain slants, so it also comes in from the side it is blown from
      if (kind === "rain" && rand() < 0.3)
        ps[i] = { ...(ps[i] as Particle), x: w + 10, y: rand() * h };
    } else {
      p.x = (p.x + w + 20) % (w + 20);
      p.y = (p.y + h + 40) % (h + 40);
    }
  }
}

/** One frame. `time` is in seconds. */
export function draw(
  ctx: CanvasRenderingContext2D,
  kind: Weather,
  ps: readonly Particle[],
  time: number,
): void {
  switch (kind) {
    case "rain": {
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(190, 215, 240, 0.28)";
      ctx.beginPath();
      for (const p of ps) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (p.vx / p.vy) * p.r, p.y - p.r);
      }
      ctx.stroke();
      return;
    }
    case "stars":
      for (const p of ps) {
        const twinkle = 0.45 + 0.55 * Math.sin(time * (0.6 + p.r) + p.phase);
        ctx.fillStyle = `rgba(235, 238, 255, ${(0.2 + 0.6 * twinkle).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case "none":
      return;
    default:
      for (const p of ps) {
        const flicker = 0.5 + 0.5 * Math.sin(time * (kind === "dust" ? 0.8 : 3.2) + p.phase);
        const glow = kind === "fireflies" ? p.r * 7 : kind === "embers" ? p.r * 4 : p.r * 3;
        const tint =
          kind === "embers"
            ? "255, 150, 60"
            : kind === "fireflies"
              ? "220, 255, 140"
              : "255, 236, 200";
        const alpha = kind === "dust" ? 0.1 + 0.25 * flicker : 0.25 + 0.6 * flicker;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        g.addColorStop(0, `rgba(${tint}, ${alpha.toFixed(3)})`);
        g.addColorStop(1, `rgba(${tint}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        ctx.fill();
      }
  }
}
