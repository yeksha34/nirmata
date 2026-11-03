# ADR-0032: Sign-in through the server: email and password, invitation only

- Status: Accepted
- Date: 2026-11-03
- Related: [Supabase database plan](../supabase-database-plan.md), [ADR-0029](0029-roles-admin-author-moderator-player.md), [ADR-0010](0010-adults-only.md)

## Context
The database plan assumed single sign-on, with the identity provider confirming adulthood. No provider is set up, and the owner's Supabase project has no custom mail sender, so its confirmation and invitation emails cannot be changed or relied on. The owner also ruled that the browser must never talk to Supabase: web, server, Supabase.

## Decision
- **Through the server.** The browser calls only `/api/auth/*`. The server (`apps/auth`) talks to Supabase Auth, keeps each person's Supabase tokens in its own memory, and gives the browser an `httpOnly`, `SameSite=Lax` cookie (`nirmata_session`). Changes require the site's own origin.
- **Email and password now, single sign-on later.** Provider claims for age go in `identity.idp_age_rules` when SSO is added. Until then each person confirms they are an adult after signing in (`identity.attest_adult`).
- **Invitation only.** Public sign-up is off in the Supabase dashboard and the before-user-created hook refuses an address with no pending invitation. An invitation link carries a one-time token; the server looks up the address (`identity.invitation_email`, server only), creates the account itself with the service key and no email, then the person accepts the invitation as themselves.
- **Roles** follow [ADR-0029](0029-roles-admin-author-moderator-player.md); the first author is invited with `tools/invite-author.mjs`, an administrator is made with `tools/set-admin.mjs`.

## Consequences
+ No Supabase key or token reaches a browser; the service key lives only in the server's environment.
+ Works without a mail sender or an identity provider.
- Sessions are in memory: restarting the server signs everyone out.
- The service key can create accounts, so the server host must be trusted and kept private.
- Rate limits on password attempts are Supabase's own.

## Alternatives considered
Supabase's browser client (breaks the web, server, Supabase rule and exposes tokens to scripts); magic links or confirmation emails (need a mail sender the project does not have); open sign-up with later approval (the owner wants invitation only).
