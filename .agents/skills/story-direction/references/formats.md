# Recommended file layout

Use this when starting a project from scratch or when the user asks how to organize. If they already have a structure, keep theirs.

```
my-story/
├── lore/
│   ├── _changelog.md
│   ├── characters/maren-ashby.md
│   ├── places/saltreach.md
│   ├── factions/the-grey-order.md
│   ├── species/veyra.md
│   └── rules/iron-and-spirits.md
├── scenes/
│   └── scenes.md            # or one file per arc
├── drafts/
│   └── S014-maren-at-the-weir.md
└── chapters/
    └── 03-the-flooded-road.md
```

## Lore entry

```markdown
---
name: Veyra
type: species
aliases: [river-folk, the drowned kin]
---

## Facts
- Born in river shallows; gills close at adulthood
- Cannot speak a lie while standing in running water

## Known on page
- Ch.2: Maren notices the merchant avoids the fountain

## Hidden (author-only until reveal)
- [hidden] The Grey Order breeds Veyra informants — reveal planned Ch.9
```

`aliases` feed the impact scanner. "Known on page" tracks what the reader has already been shown, which tells drafting what is safe to lean on. `[hidden]` marks facts that must not surface before their planned reveal.

## Scene list

One scene per line, with a stable ID so drafts and chapters can reference it even if wording changes:

```markdown
- S013 | Saltreach docks | Maren bargains with a Veyra merchant who will not stand near the fountain.
- S014 | The weir | Maren finds the drowned courier and an Order seal in his fist.
```

## Draft

File named by scene ID. Prose only — any author notes go in an HTML comment at the top, never in the prose body:

```markdown
<!-- scene: S014 | pov: Maren | status: second pass -->

The water at the weir ran brown with the week's rain...
```

## Chapter

```markdown
---
title: The Flooded Road
pov: Maren
scenes: [S012, S013, S014]
reveals: [Courier is dead]
withhold: [Order's involvement — seal seen but not recognized]
---

## Direction
Slow, wet, claustrophobic. End on the seal without naming it.

## Text
(assembled prose of the scenes, with transitions)
```

## Changelog entry

```markdown
## 2026-10-18 — Veyra (species)
- Change: can lie in running water if they are bleeding → previously no exception
- Reason: author wants S031 betrayal to be possible
- Updated: scenes.md (S031), drafts/S031-*.md
- Flagged for author: chapters/07 — reveal order may need to move
```
