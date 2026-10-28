import { type CSSProperties, useEffect, useRef, useState } from "react";
import { isClipped, type Placement, place, type Said, said } from "./clip-tip";

/**
 * One tooltip for every piece of text the page cuts short with an ellipsis (a long world name, a
 * story's title, a nickname, a line of a preview). Point at it, or tab to it, and the whole text
 * appears; text that fits shows nothing. It listens at the top of the page, so a new ellipsis in
 * the style sheet is covered without anything being added to the screen that uses it.
 *
 * The tooltip is a popover, which is drawn above everything, dialogs and the reader included.
 */

const DELAY = 450;
/** How far down into an element to look for the text that is cut off inside it. */
const DEPTH = 24;

const cutOff = (el: Element): boolean => getComputedStyle(el).textOverflow === "ellipsis";

/** The element that shows its text with an ellipsis: this one, one around it, or one inside it. */
function ellipsised(from: Element | null): HTMLElement | undefined {
  let el = from;
  for (let up = 0; el && up < 4; up++, el = el.parentElement) {
    if (cutOff(el)) return el as HTMLElement;
  }
  if (!from) return undefined;
  for (const inner of [...from.querySelectorAll("*")].slice(0, DEPTH)) {
    if (cutOff(inner)) return inner as HTMLElement;
  }
  return undefined;
}

/**
 * What the element says. A label that has a Hindi and an English reading (`.tr`) is read once in
 * each, so the tooltip shows the Hindi and gives the English under it; what people wrote has one.
 */
function saying(el: HTMLElement): Said {
  const read = (language: "hi" | "en") => {
    const copy = el.cloneNode(true) as HTMLElement;
    for (const pair of copy.querySelectorAll(".tr")) {
      const part = pair.querySelector(`:scope > .${language}`);
      pair.replaceWith(part?.textContent ?? pair.textContent ?? "");
    }
    return copy.textContent ?? "";
  };
  return said(read("hi"), read("en"));
}

interface Showing extends Said {
  where: Placement;
}

export function ClippedTips() {
  const [showing, setShowing] = useState<Showing | null>(null);
  const tip = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let timer = 0;
    let over: HTMLElement | undefined;

    const hide = () => {
      window.clearTimeout(timer);
      over = undefined;
      setShowing(null);
    };
    const point = (target: EventTarget | null, wait: number) => {
      const found = target instanceof Element ? ellipsised(target) : undefined;
      if (found === over) return;
      hide();
      if (!found || !isClipped(found)) return;
      over = found;
      timer = window.setTimeout(() => {
        const box = found.getBoundingClientRect();
        setShowing({
          ...saying(found),
          where: place(box, { width: window.innerWidth, height: window.innerHeight }),
        });
      }, wait);
    };

    const onOver = (e: PointerEvent) => {
      // a finger has no hover: a tap is for the thing that was tapped
      if (e.pointerType !== "touch") point(e.target, DELAY);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget;
      if (over && !(to instanceof Node && over.contains(to))) hide();
    };
    const onFocus = (e: FocusEvent) => point(e.target, 150);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    // anything that moves the text from under the pointer takes the tooltip with it
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // a popover is drawn in the top layer, above any dialog that is open
  useEffect(() => {
    const el = tip.current;
    if (!el || typeof el.showPopover !== "function") return;
    if (showing && !el.matches(":popover-open")) el.showPopover();
    else if (!showing && el.matches(":popover-open")) el.hidePopover();
  }, [showing]);

  const style: CSSProperties | undefined = showing
    ? {
        left: showing.where.left,
        maxWidth: showing.where.maxWidth,
        ...(showing.where.top !== undefined ? { top: showing.where.top } : {}),
        ...(showing.where.bottom !== undefined ? { bottom: showing.where.bottom } : {}),
      }
    : undefined;

  return (
    <p
      ref={tip}
      className="clip-tip"
      role="tooltip"
      popover="manual"
      style={style}
      hidden={!showing}
    >
      {showing?.main}
      {showing?.english && <small>{showing.english}</small>}
    </p>
  );
}
