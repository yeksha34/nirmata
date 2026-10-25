# ADR-0010: Nirmata is for adults; there are no rating tiers

- Status: Accepted 2026-10-25
- Related: [F-39](../requirements.md), [ADR-0012](0012-player-input-is-not-fact.md)

## Context
The first design had three content ratings (everyone, teen, mature) on worlds and cards, a per-session ceiling, and a gate in the prompt builder. Asked who sets the ceiling and whether mature worlds are officially supported, the owner answered: **mature only**.

## Decision
1. Nirmata is for adult audiences. There is no `rating` on cards, no `contentRating` on worlds, no session ceiling and no rating gate. All of that was removed.
2. What bounds a story is the **world's own rule cards**, the **host's direction**, and **one fixed line in every prompt** that no world can remove: never write sexual content involving a minor.
3. The prompt says the story is for adult readers and to steer a scene rather than lecture the player.

## Consequences
+ Less machinery, and no tiers to get wrong.
+ The example world stays mild because it was written that way, not because of a rating.
- Nothing in the app yet confirms that the people joining a story are adults. Whether to ask for an age confirmation is a product and server question, left open ([open-questions](../open-questions.md)).
- The fixed line is a prompt instruction, so it depends on the model following it; the rules judge can be given a matching rule card for a second check.

## Alternatives considered
- **Keep the tiers.** Rejected by the owner.
- **Allow worlds to choose their own limits only.** The fixed line is the one thing deliberately not left to a world.
