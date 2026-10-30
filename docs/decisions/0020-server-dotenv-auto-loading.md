# ADR-0020: Server automatic environment file loading

- Status: Proposed
- Date: 2026-10-30
- Related: [ADR-0005](0005-scaffold-content-neutral.md), [ADR-0006](0006-stack-revision.md), [ADR-0011](0011-irc-style-joining.md)

## Context
When running `npm start` or `pnpm start` from the repository root, Node.js and package managers do not automatically load `.env` files into `process.env`. As a result:
1. `apps/server/src/config.ts` failed on boot with `"No model is set up"` unless users manually passed environment variables in their shell or command line.
2. In addition, when started without setting `NIRMATA_HOST_KEY`, the server defaulted to an ephemeral random key, causing attempts to join via a pre-configured link like `#host=admin` to fail with `"That host key is not right"`.

Relying on developers to manually type `$env:NIRMATA_PROVIDER="demo"` or install heavy external dependencies like `dotenv` in runtime production was undesirable.

## Decision
1. **Built-in `process.loadEnvFile`:** Use Node.js built-in `process.loadEnvFile()` in `apps/server/src/main.ts` on startup (Node v20.12+).
2. **Candidate Search Paths:** Attempt to load `.env` across expected root locations:
   - `process.env.INIT_CWD` (the directory where pnpm was started)
   - `process.cwd()`
   - Parent repository directory relative to `main.ts`
3. **Graceful Fallback:** If no `.env` file exists, fail silently and proceed to standard environment checking.
4. **Content Neutrality & Security:** Ensure `.env` remains strictly ignored in `.gitignore` as required by [ADR-0005](0005-scaffold-content-neutral.md).

## Consequences
+ Running `npm start` loads `.env` automatically without extra shell syntax or dependencies.
+ Predictable host keys (such as `NIRMATA_HOST_KEY=admin`) can be stored in local `.env` files for consistent authentication.
+ Zero additional runtime npm dependencies.
- Developers running custom environments must remember that local `.env` values will take precedence unless overridden in the outer process.

## Alternatives considered
- **Adding `dotenv` dependency:** Unnecessary since Node.js >=20 includes native `process.loadEnvFile()`.
- **Requiring CLI flags (`--env-file=.env`):** Fragile across package managers and varying npm/pnpm wrapper commands.
