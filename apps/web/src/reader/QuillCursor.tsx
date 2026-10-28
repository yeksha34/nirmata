import { useEffect, useRef } from "react";
import {
  drawPoint,
  drawQuill,
  drawSheet,
  emitAlong,
  fade,
  type Point,
  REST_SPEED,
  type Sheet,
  step,
} from "./cursor";

/**
 * The mouse cursor inside the reader, drawn over everything on a canvas. At rest it is the tip of
 * a quill, still, with its point on the pointer. While the mouse moves it is a page in the wind,
 * and loose pages come off it and trail back along the way it came. Over a button, a menu or the
 * slider the system's own cursor shows instead, as it must: nothing here hides what can be
 * clicked.
 *
 * It is for a mouse. A finger has no cursor, and under reduced motion the pages stay home and
 * only the still quill is drawn.
 */

const CONTROLS = "button, summary, input, select, textarea, label, a, [role=button]";
/** The pointer's speed, in pixels a second, above which it is moving and not resting. */
const MOVING = REST_SPEED * 1.6;

export function QuillCursor() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const dialog = canvas?.closest("dialog");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !dialog || !ctx) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sheets: Sheet[] = [];
    const velocity = { x: 0, y: 0 };
    let at: Point | undefined;
    let previous: Point | undefined;
    let over = false;
    let carry = 0;
    let speed = 0;
    let lastEvent = 0;
    // 0 at rest, 1 while the pointer is moving, eased so the quill and the page give way to each other
    let moving = 0;
    let frame = 0;
    let last = performance.now();
    let time = 0;
    let width = 0;
    let height = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const s of sheets) drawSheet(ctx, s, s.angle, s.flap, s.size, fade(s) * 0.92);
      if (!at || over) return;
      if (moving < 0.98) drawQuill(ctx, at, 1 - moving);
      if (moving > 0.02) {
        const heading = Math.atan2(velocity.y, velocity.x);
        // the lead page is blown about by the same wind: it flutters, nose to the way it is going
        drawSheet(ctx, at, heading + Math.sin(time * 17) * 0.45, time * 13, 25, moving);
        drawPoint(ctx, at, moving);
      }
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      // a mouse that has stopped sends nothing: its speed has to die away on its own
      if (now - lastEvent > 60) speed *= Math.exp(-8 * dt);
      velocity.x *= Math.exp(-5 * dt);
      velocity.y *= Math.exp(-5 * dt);
      const target = !still && speed > (moving > 0.5 ? REST_SPEED : MOVING) ? 1 : 0;
      moving += (target - moving) * Math.min(1, dt * (target ? 16 : 7));
      step(sheets, dt, time, {
        x: Math.max(-1500, Math.min(1500, velocity.x)),
        y: Math.max(-1500, Math.min(1500, velocity.y)),
      });
      draw();
      if (at || sheets.length > 0 || moving > 0.01) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    const onMove = (e: PointerEvent) => {
      // a finger or a pen has its own way; the quill is for the mouse
      if (e.pointerType !== "mouse") return;
      const to = { x: e.clientX, y: e.clientY };
      const dt = Math.max(1, e.timeStamp - lastEvent) / 1000;
      if (at && lastEvent) {
        const dx = to.x - at.x;
        const dy = to.y - at.y;
        speed = speed * 0.6 + (Math.hypot(dx, dy) / dt) * 0.4;
        velocity.x = velocity.x * 0.6 + (dx / dt) * 0.4;
        velocity.y = velocity.y * 0.6 + (dy / dt) * 0.4;
      }
      at = to;
      over = e.target instanceof Element && e.target.closest(CONTROLS) !== null;
      dialog.classList.add("has-quill");
      if (!still && !over && previous) carry = emitAlong(sheets, previous, to, carry, speed);
      previous = to;
      lastEvent = e.timeStamp;
      wake();
    };
    const onLeave = () => {
      at = undefined;
      previous = undefined;
      speed = 0;
      carry = 0;
    };

    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const watcher = new ResizeObserver(fit);
    watcher.observe(canvas);
    fit();

    dialog.addEventListener("pointermove", onMove);
    dialog.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      dialog.removeEventListener("pointermove", onMove);
      dialog.removeEventListener("pointerleave", onLeave);
      dialog.classList.remove("has-quill");
    };
  }, []);

  // paint only: it takes no focus and says nothing
  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas that is never focused
  return <canvas ref={ref} className="quill-cursor" aria-hidden="true" />;
}
