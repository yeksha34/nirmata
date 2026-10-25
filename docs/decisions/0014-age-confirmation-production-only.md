# ADR-0014: Age confirmation exists, and is asked only in production

- Status: Accepted 2026-10-25
- Related: [ADR-0010](0010-adults-only.md), [F-46](../features/F-46-shared-board-and-table-rules.md)

## Context
Nirmata is adults-only (ADR-0010). Should joining ask people to confirm they are adults? The owner: *keep the mechanism, gated with environment; works only in production.*

## Decision
1. The mechanism is built: when it is on, joining a table requires an explicit confirmation that the joiner is an adult, and refuses otherwise with "Please confirm that you are an adult to join this story." The time of the attestation is recorded with the participant.
2. It is **on only when `NODE_ENV` is `production`** (`isProduction()`). In development and tests it is never asked. A board can be told explicitly (`requireAdultConfirmation`) for tests and special setups.
3. It is a plain attestation: no documents, no checks. The host, who runs the server, is not asked.

## Consequences
+ Development and automated tests need no ceremony; production joiners see the check.
- An attestation proves nothing and can be clicked through. It states the rule; it does not enforce it.
- The wording and the click-through screen belong to the interface, which is not built.
- `NODE_ENV` must be set correctly when deploying, or the check silently does not run.

## Alternatives considered
- **Always on**: awkward in development and tests. **Never on**: rejected, the owner wants the mechanism kept.
