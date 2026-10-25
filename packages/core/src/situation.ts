import type { Card } from "./cards";
import { CardFrontmatter } from "./schema";

export const CURRENT_SITUATION_ID = "lore.current-situation";

/**
 * An always-on card that carries where the story is right now: where the player is, who is with
 * them and what they are trying to do. It starts empty (and so costs nothing in the prompt); the
 * plot extractor writes to it, and it shows only the newest point, as "Right now".
 * Every story gets one in its copy of the cards unless the world already defines its own.
 */
export function currentSituationCard(): Card {
  return {
    path: "(built in)",
    fm: CardFrontmatter.parse({
      id: CURRENT_SITUATION_ID,
      kind: "lore",
      name: "Current situation",
      always: true,
      plotMax: 1,
      plotHeading: "**Right now:**",
    }),
    body: "",
  };
}

export function withCurrentSituation(cards: readonly Card[]): Card[] {
  return cards.some((c) => c.fm.id === CURRENT_SITUATION_ID)
    ? [...cards]
    : [...cards, currentSituationCard()];
}
