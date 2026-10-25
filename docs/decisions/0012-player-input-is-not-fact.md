# ADR-0012: Player input is never fact; the rules checker only judges generated text

- Status: Accepted 2026-10-25
- Related: [F-45](../features/F-45-player-input-is-not-fact.md), [ADR-0010](0010-adults-only.md)

## Context
The rules checker (the "gatekeeper") exists to keep generated text within the world's rules. The owner clarified its place: it is **pipelined after the text is generated**; it **does not sanitise the player's input**; and **if the input is invalid, it should be treated as untruth when generating the continuation**. (The owner also noted that "story" is the apter word than "story".)

## Decision
1. **The judge sees only host-written text,** after it is generated. It never filters, rewrites or rejects what a player types.
2. **Input reaches the host unchanged.** Nothing decides in advance that it is "invalid".
3. **The host is told what to do with it:** player input is only what the character says or attempts. Where it contradicts the rules, cards or memory, that part is untrue in the story (the character is mistaken, lying or imagining, or the attempt simply fails) and the story carries on from what is true. It is never adopted as fact.
4. **Plot extraction ignores unconfirmed claims** by the player.
5. The player's words stay in the transcript and the chapter exactly as written, since they were said; they just do not become facts.

## Consequences
+ Players are never blocked or silently edited, and false claims cannot corrupt the world's cards or plot.
- It relies on the model following the instruction. This needs checking with a real model; it cannot be proven with the fake provider.
- A model may sometimes accept a confident lie. The judge checks the reply against the rules afterwards, which catches rule contradictions but not every lore contradiction.

## Alternatives considered
- **A gate that rejects invalid input.** Rejected by the owner: the checker does not touch input.
- **A second model call to classify input as valid or not.** More cost, and it would be the sanitising step the owner ruled out.

## Terminology
A run in a world is a **story**. User-facing text, code identifiers, folders and action names all say story (renamed from "adventure" on 2026-10-25); see the [glossary](../glossary.md).