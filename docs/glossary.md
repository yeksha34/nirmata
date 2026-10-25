# Glossary

| Term | Meaning |
|---|---|
| **Story** | One run in a world, from its first scene on. Called an *adventure* until 2026-10-25; the code, folders and messages now all say story. (The old editor in `apps/studio` used "story" for what Nirmata calls a **world**; it is being retired.) |
| **World** | A reusable folder of source cards (`worlds/<name>/`). |
| **Source cards** | The world's own cards. Only a host edits them. A story takes a copy and never changes them. |
| **Copy** | The story's own copy of the world and its cards, saved in its first (`begin`) event. |
| **Host** | Whoever runs the story's server. In solo play, also the player. |
| **Player** | Anyone who has joined and opted to play. |
| **Spectator** | Someone who has joined but not opted to play; sees only the public story. |
| **Turn** | One player action or one host reply. |
| **Context window** | The recent turns that fit the prompt. Older turns have left it for good. |
| **Chapter** | The turns that have left the window, written out word for word. Breaks are manual for now. |
| **Plot point** | One past-tense sentence about something that happened, attached to a card and shown with it from then on. |
| **Current situation** | The always-on card showing where the story is right now. |
| **Event log** | `events.jsonl`: the one true record of a story. Everything else is rebuilt from it. |
| **Branch** | A different path from an earlier moment, made by undo, retry or editing. |
