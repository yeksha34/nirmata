import {
  type Actor,
  type Card,
  CardFrontmatter,
  checkCards,
  formatIssues,
  parseCard,
  type WorldManifest,
} from "@nirmata/core";
import { requireCan } from "./access";
import { HostError } from "./types";

/** Wherever the world's cards actually live (files on disk, a database, memory in tests). */
export interface SourceBackend {
  world(): Promise<WorldManifest>;
  cards(): Promise<Card[]>;
  save(card: Card): Promise<void>;
  remove(cardId: string): Promise<void>;
}

/**
 * The only door to a world's source cards (ADR-0009). Anyone may read them through here, but
 * every write first checks the role: hosts may edit, players may not. A refused write changes
 * nothing, and an invalid card is refused for everyone with the problems listed.
 */
export class SourceCards {
  constructor(private readonly backend: SourceBackend) {}

  world(): Promise<WorldManifest> {
    return this.backend.world();
  }

  list(): Promise<Card[]> {
    return this.backend.cards();
  }

  /** What a new adventure copies: the world manifest and every card. Host only. */
  async snapshot(actor: Actor): Promise<{ world: WorldManifest; cards: Card[] }> {
    requireCan(actor, "adventure.start");
    const [world, cards] = await Promise.all([this.backend.world(), this.backend.cards()]);
    return { world, cards };
  }

  /** Add or replace a card (matched by its path). */
  async update(actor: Actor, card: Card): Promise<void> {
    requireCan(actor, "source.edit");
    const parsed = CardFrontmatter.safeParse(card.fm);
    if (!parsed.success) {
      throw new HostError(
        "invalid_card",
        `That card is not valid: ${formatIssues(parsed.error).join("; ")}`,
      );
    }
    const others = (await this.backend.cards()).filter((c) => c.path !== card.path);
    const clash = checkCards([...others, card]);
    if (clash.length)
      throw new HostError("invalid_card", `That card is not valid: ${clash.join("; ")}`);
    await this.backend.save({ ...card, fm: parsed.data });
  }

  /** Edit a card from its markdown text, as the editor does. */
  async editFromText(actor: Actor, path: string, text: string): Promise<Card> {
    requireCan(actor, "source.edit");
    const parsed = parseCard(path, text);
    if (!parsed.ok) {
      throw new HostError("invalid_card", `That card is not valid: ${parsed.errors.join("; ")}`);
    }
    await this.update(actor, parsed.card);
    return parsed.card;
  }

  async remove(actor: Actor, cardId: string): Promise<void> {
    requireCan(actor, "source.edit");
    const exists = (await this.backend.cards()).some((c) => c.fm.id === cardId);
    if (!exists) throw new HostError("nothing_to_do", `There is no card "${cardId}" to remove.`);
    await this.backend.remove(cardId);
  }
}
