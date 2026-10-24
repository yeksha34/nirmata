---
name: record-decision
description: Write or supersede an architecture decision record (ADR) in docs/decisions/. Use when a technology, data format, API shape or process choice is made that someone could later question, when asked to "record this decision", "write an ADR", or when changing a previous decision.
---

# record-decision

1. Read `docs/decisions/README.md` for the index and the next number (4 digits, zero padded).
2. Copy the structure of an existing ADR (for example `0003-llm-provider-abstraction.md`): Status, Date, Related, **Context**, **Decision**, **Consequences** (use + and - bullets), **Alternatives considered**.
3. Name the file `NNNN-kebab-title.md`. Status starts as **Proposed**; the owner moves it to **Accepted**.
4. Add a row to the table in `docs/decisions/README.md`.
5. **Never rewrite an Accepted ADR.** To change course, write a new ADR, set the old one's status line to `Superseded by ADR-NNNN`, and link both ways.
6. Link the ADR from the feature record(s) it affects (`docs/features/`) and from `docs/tech-stack.md` when it changes the stack.

Keep it short (under a page). Record the *why* and the rejected options; the code already shows the *what*.
