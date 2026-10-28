/** "5 min ago", "yesterday": how long ago a story was last played, in words. */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * How long ago, as a text with a `{n}` to fill (so the screen can show it in Hindi too), or a date
 * when it was a long time ago.
 */
export function agoParts(
  iso: string,
  now = Date.now(),
): { text: string; n: number } | { date: string } | undefined {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return undefined;
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return { text: "just now", n: 0 };
  if (minutes < 60) return { text: "{n} min ago", n: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: "{n} h ago", n: hours };
  const days = Math.round(hours / 24);
  if (days === 1) return { text: "yesterday", n: 1 };
  if (days < 14) return { text: "{n} days ago", n: days };
  return {
    date: new Date(then).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  };
}

/** A folder name for a world from its title: lowercase letters, digits and hyphens. */
export function worldName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : "my-world";
}

/** Reads "a, b and c". */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const MODE_LABEL = { do: "Do", say: "Say", story: "Story" } as const;

export const MODE_HINT = {
  do: "What your character does",
  say: "What your character says",
  story: "Steer the story directly",
} as const;

/** "fog, mist, haze" as ["fog", "mist", "haze"]: what the manager's comma-separated fields hold. */
export function words(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** "life-outside-the-story" as "Life outside the story", for a part no template names. */
export const humanize = (id: string) => {
  const text = id.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
