import type { Card } from "./cards";
import { type StoryState, sourceOf } from "./events";
import { cardsWithPlot, type PlotOptions, plotPointsOf } from "./plot";
import { type ProjectedFile, projectStory } from "./projection";
import type { WorldManifest } from "./schema";
import { CURRENT_SITUATION_ID } from "./situation";

/** A world made from a story: everything needed to write it out as a world folder. */
export interface StoryWorld {
  manifest: WorldManifest;
  /** The story's own cards, each with the plot points that happened to it written into its body. */
  cards: Card[];
  /** The story's chapters, as world-relative files (`chapters/...`). */
  files: ProjectedFile[];
}

export class NoStoryCopyError extends Error {
  constructor() {
    super("This story has no copy of its cards to save a world from.");
    this.name = "NoStoryCopyError";
  }
}

/**
 * Save a story as a world of its own (as of node `at`, default the current head). The new world
 * is the story's copy of the cards as it stands, with every plot point that has happened written
 * into the card it happened to, plus the chapters written so far. Stories started in it begin
 * from there, so the saved story's events become that world's history.
 *
 * The built-in "current situation" card is left out: every story gets a fresh one, and its
 * contents are only where the story happened to be standing. Pure: the caller writes the files.
 */
export function worldFromStory(
  state: StoryState,
  options: {
    name: string;
    title: string;
    at?: string | null;
    plot?: PlotOptions;
  },
): StoryWorld {
  const at = options.at === undefined ? state.head : options.at;
  const source = sourceOf(state, at);
  if (!source) throw new NoStoryCopyError();

  const points = plotPointsOf(state, at, options.plot ?? {});
  const cards = cardsWithPlot(
    source.cards.filter((c) => c.fm.id !== CURRENT_SITUATION_ID),
    points,
    Number.MAX_SAFE_INTEGER,
  );

  const files = projectStory(state, { at, ...(options.plot ?? {}) }).filter((f) =>
    f.path.startsWith("chapters/"),
  );
  return { manifest: { ...source.world, name: options.name, title: options.title }, cards, files };
}
