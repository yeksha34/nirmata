# Agent API reference

[agent.openapi.json](agent.openapi.json) is the fixed reference for what an AI agent may call: OpenAPI 3.1, 36 operations under `/api/agent/…`, grouped as

- **Token**: who the token speaks for.
- **Import** (`import.read` / `import.write`): cards, the world's skills, the author's rules, publishing.
- **Story** (either family of scopes): the world's manifest and counts, chapters, scenes and drafts.
- **Adaptation** (`adaptation.read` / `adaptation.write`): character prep, the asset plan, workflows, visual novels.

Every operation lists the scopes that admit it under `x-scopes-any-of`. The agent sends `Authorization: Bearer nga_…`; the token is made in the World tab (Agent access).

## Viewing it
Open the file in any Swagger / OpenAPI viewer (for example paste it into the Swagger Editor, or load it in a local Swagger UI). It needs no server.

## Keeping it fixed
`apps/server/test/agent-openapi.test.ts` fails when a route under `/api/agent/` is added, removed or renamed without this file changing, and when an operation names a scope that does not exist. Edit the JSON by hand when the API changes; request and response shapes are not checked by the test, so review them in the same change.

Token management (`/api/worlds/{name}/agent-tokens`) belongs to the signed-in author and is not part of the agent's reference.
