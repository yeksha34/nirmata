/**
 * The tooltip for text that is cut short with an ellipsis: what counts as cut short, where the
 * tooltip goes, and what it says. The listening and the drawing are in clipped-tips.tsx; this part
 * takes plain numbers and text, so it can be tested without a screen.
 */

export interface Size {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/** True when the element holds more than it shows: a line that runs on, or lines clamped away. */
export function isClipped(el: Size): boolean {
  // a pixel of slack: widths are fractional and round differently from the scroll sizes
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  /** Distance from the top of the window, when the tooltip hangs below the text. */
  top?: number;
  /** Distance from the bottom of the window, when it stands above the text. */
  bottom?: number;
  maxWidth: number;
}

const GAP = 6;
const MARGIN = 8;
const ROOM_BELOW = 96;

/** Under the text, lined up with its left edge, kept inside the window; above it near the bottom. */
export function place(
  box: Box,
  viewport: { width: number; height: number },
  wanted = 480,
): Placement {
  const maxWidth = Math.max(120, Math.min(wanted, viewport.width - MARGIN * 2));
  const left = Math.min(Math.max(MARGIN, box.left), viewport.width - MARGIN - maxWidth);
  return viewport.height - box.bottom < ROOM_BELOW
    ? { left, bottom: viewport.height - box.top + GAP, maxWidth }
    : { left, top: box.bottom + GAP, maxWidth };
}

/** A label that is in two languages: its text in each, from the pieces of the Hindi/English pair. */
export interface Said {
  /** What shows: Hindi where the label has it. */
  main: string;
  /** The English, when the label had both and they differ. */
  english?: string;
}

/** Collapses the runs of white space that markup leaves between pieces of a label. */
export const tidy = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Puts the two readings of one label together: the English is left out when it adds nothing. */
export function said(hindi: string, english: string): Said {
  const main = tidy(hindi);
  const en = tidy(english);
  return en && en !== main ? { main, english: en } : { main };
}
