# ADR-0021: Workspace writings navigation and detail panel split

- Status: Proposed
- Date: 2026-10-30
- Related: [ADR-0018](0018-card-parts-and-templates.md), [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [F-58](../features/F-58-paged-reader.md), [F-59](../features/F-59-vn-adaptation-and-player.md)

## Context
In the Workspace screen (`Workspace.tsx`), Cards follow a three-pane model:
- Rail (left navigation between Cards, Chapters, Drafts, Stories, World)
- Navigation column (middle list of cards)
- Editor column (right-hand detail/editor pane)

However, when viewing Chapters or Drafts, the right editor column previously rendered only an empty placeholder (`.editor-empty` displaying "Cards - Choose a card to read or change it"). Meanwhile, the middle list crammed multiple action buttons (`Play VN`, `Read`, `Recompile VN`, `Adapt to VN`, and slide count badges) directly inside each list item.

This caused two problems:
1. CSS grid collision: All tooltip action buttons were pinned to `grid-column: 2; grid-row: 1 / span 2`, stacking on top of each other and burying the `Play VN` and `Read` buttons underneath `Recompile VN`.
2. Poor ergonomics: Clicking the card itself did nothing, and the right panel was completely unused.

## Decision
1. **Extend the three-pane pattern to Chapters and Drafts:**
   - **Middle Column (`ws-nav`):** Renders `WritingsList`. Each item is a clean, clickable card showing title, timestamp, size, and VN status badge. Clicking a card selects it and highlights it with an active indicator.
   - **Right Column (`ws-editor`):** Renders `WritingDetail`. When a chapter or draft is selected, it displays:
     - Header metadata (type eyebrow, title, path, size, date).
     - Prominent action toolbar (`Play VN`, `Read`, `Recompile VN` or `Adapt to VN`).
     - Visual novel status card (slide count, mode, protagonist, routes) when adapted.
     - Live scrollable markdown/text preview of the prose.
2. **Auto-select default:** When switching to the Chapters or Drafts tab, default to selecting the first available item so the right panel is populated immediately upon tab navigation.

## Consequences
+ Clean UI separation between selection (middle list) and action/inspection (right detail panel).
+ Resolves button stacking collisions and exposes `Play VN` as a clear primary call to action.
+ Provides immediate text previews of prose without requiring full-screen modal reader takeover.
+ Preserves zero-div/zero-span semantic DOM accessibility requirements.
- On narrow viewports where three columns collapse into a single stacked column, users must scroll down to view details.

## Alternatives considered
- **In-card expandable accordion:** Crowds the list and breaks the consistent three-pane layout of the Studio workspace.
- **Context menu / dropdown:** Hides primary actions (like `Play VN`) behind additional clicks.
