/**
 * The reader's mouse cursor. At rest it is the tip of a quill, still, with its point exactly where
 * the pointer is. While the mouse moves, loose pages come off it and are blown back along the way
 * it came, fluttering as they go, the way a gust takes the leaves of a book. This file is the
 * movement and the drawing; the listening is in QuillCursor.tsx. The movement takes its
 * randomness as an argument, so a run can be repeated in a test.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Sheet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Radians a second. */
  spin: number;
  /** Where in its flutter it is: the sheet is seen edge-on when this is a quarter turn. */
  flap: number;
  flapRate: number;
  size: number;
  age: number;
  life: number;
  /** Makes each sheet's wobble its own. */
  seed: number;
}

type Random = () => number;

/** The most sheets in the air at once; a new one pushes the oldest out. */
export const MAX_SHEETS = 36;
/** A sheet comes off for each this many pixels the pointer travels. */
export const SPACING = 22;
/** A pointer slower than this, in pixels a second, is at rest. */
export const REST_SPEED = 45;

/**
 * Lets go of sheets along the line the pointer just travelled, one for each `SPACING` pixels, and
 * returns the distance carried over to the next move. The sheets leave opposite to the way the
 * pointer went, harder the faster it went, and a little to one side or the other.
 */
export function emitAlong(
  sheets: Sheet[],
  from: Point,
  to: Point,
  carry: number,
  speed: number,
  rand: Random = Math.random,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return carry;
  const ux = dx / distance;
  const uy = dy / distance;
  let owed = carry + distance;
  const push = Math.min(900, 120 + speed * 0.5);
  while (owed >= SPACING) {
    owed -= SPACING;
    const along = 1 - owed / distance;
    const side = (rand() - 0.5) * 2;
    sheets.push({
      x: from.x + dx * Math.min(1, Math.max(0, along)),
      y: from.y + dy * Math.min(1, Math.max(0, along)),
      vx: -ux * push * (0.5 + rand() * 0.6) - uy * side * 140,
      vy: -uy * push * (0.5 + rand() * 0.6) + ux * side * 140 - 40,
      angle: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 14,
      flap: rand() * Math.PI * 2,
      flapRate: 7 + rand() * 9,
      size: 13 + rand() * 11,
      age: 0,
      life: 0.7 + rand() * 0.7,
      seed: rand() * 100,
    });
    if (sheets.length > MAX_SHEETS) sheets.shift();
  }
  return owed;
}

/**
 * Moves every sheet on by `dt` seconds. The air drags on a sheet and the gust (the pointer's
 * velocity, turned round) pushes it back, with eddies that are different for each sheet and a
 * little lift. A sheet that has lived its life is dropped.
 */
export function step(
  sheets: Sheet[],
  dt: number,
  time: number,
  pointer: Point = { x: 0, y: 0 },
): void {
  const drag = Math.exp(-1.7 * dt);
  for (let i = sheets.length - 1; i >= 0; i--) {
    const s = sheets[i] as Sheet;
    s.age += dt;
    if (s.age >= s.life) {
      sheets.splice(i, 1);
      continue;
    }
    // eddies: a swirl that is slow for a big sheet and quick for a small one
    s.vx += (Math.sin(time * 6.1 + s.seed) * 260 + pointer.x * -0.6) * dt;
    s.vy += (Math.cos(time * 4.7 + s.seed * 1.7) * 200 - 70 + pointer.y * -0.6) * dt;
    s.vx *= drag;
    s.vy *= drag;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.spin * dt;
    s.flap += s.flapRate * dt;
  }
}

/** How visible a sheet is: whole at first, gone at the end of its life. */
export const fade = (s: Sheet): number => Math.max(0, 1 - s.age / s.life) ** 0.8;

// ---- drawing -----------------------------------------------------------------------------------

const INK = "#2a1d12";
const PAPER = "#f6ecd6";

/** One loose page: a sheet of paper with lines of writing, turning over as it flutters. */
export function drawSheet(
  ctx: CanvasRenderingContext2D,
  at: Point,
  angle: number,
  flap: number,
  size: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  // seen from the edge at a quarter turn, face-on at none
  ctx.scale(Math.max(0.12, Math.abs(Math.cos(flap))), 1);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  const w = size * 0.74;
  const h = size;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 1.5);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(42, 29, 18, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // lines of writing
  ctx.strokeStyle = "rgba(42, 29, 18, 0.45)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let y = -h / 2 + h * 0.22; y < h / 2 - h * 0.12; y += h * 0.16) {
    ctx.moveTo(-w / 2 + w * 0.16, y);
    ctx.lineTo(w / 2 - w * (0.16 + (Math.abs(y * 7) % 4) * 0.05), y);
  }
  ctx.stroke();
  ctx.restore();
}

/** The quill. Its point is at `at`, and the feather leans away up and to the right. */
export function drawQuill(ctx: CanvasRenderingContext2D, at: Point, alpha: number): void {
  const length = 74;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate((-62 * Math.PI) / 180);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;

  // the vane: a long leaf of feather, curving away from the shaft
  ctx.beginPath();
  ctx.moveTo(length * 0.2, 0);
  ctx.bezierCurveTo(length * 0.34, -14, length * 0.78, -19, length, -4);
  ctx.bezierCurveTo(length * 0.86, 9, length * 0.46, 11, length * 0.2, 0);
  const vane = ctx.createLinearGradient(0, -14, 0, 10);
  vane.addColorStop(0, "#fbf3df");
  vane.addColorStop(1, "#dfcfa8");
  ctx.fillStyle = vane;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.stroke();

  // barbs
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(42, 29, 18, 0.5)";
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const t = 0.3 + i * 0.075;
    const x = length * t;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + length * 0.07, -11 * (1 - Math.abs(t - 0.62) * 1.1));
    ctx.moveTo(x, 0);
    ctx.lineTo(x + length * 0.06, 8 * (1 - Math.abs(t - 0.6) * 1.1));
  }
  ctx.stroke();

  // the shaft, from the point to the tip of the feather
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length * 0.2, 0);
  ctx.lineTo(length, -2.4);
  ctx.stroke();

  // the nib: a cut point of dark horn, ending exactly where the pointer is
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(13, -2.6);
  ctx.lineTo(13, 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A pinprick of ink where the pointer really is, so a moving page never hides the target. */
export function drawPoint(ctx: CanvasRenderingContext2D, at: Point, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 248, 232, 0.95)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(at.x, at.y, 1.9, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
}
