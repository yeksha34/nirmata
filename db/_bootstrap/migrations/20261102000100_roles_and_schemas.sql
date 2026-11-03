-- 001 roles and schemas. Content-neutral: no world or story wording anywhere in db/.
-- Run by a superuser or Supabase's postgres role. Every later migration runs as migration_owner.

-- Roles. Passwords are never set here: set them out of band (dashboard or secret store).
-- On Supabase, anon / authenticated / service_role / supabase_auth_admin already exist;
-- the guards let the same file build a plain Postgres for tests.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'migration_owner') then
    create role migration_owner nologin noinherit;   -- the CI login is made a member of it
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw login noinherit connection limit 40;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_ro') then
    create role app_ro login noinherit connection limit 15;
  end if;

  -- the login running this file must be able to SET ROLE migration_owner (schemas below are created
  -- for it); newer Postgres does not give the creator that by default
  begin
    execute format('grant migration_owner to %I with set true', current_user);
  exception when others then
    execute format('grant migration_owner to %I', current_user);
  end;
end $$;

-- the app roles may act as `authenticated` (set local role) so one set of policies serves
-- browsers and the server
grant authenticated to app_rw, app_ro;

alter role app_rw set statement_timeout = '15s';
alter role app_rw set lock_timeout = '3s';
alter role app_rw set idle_in_transaction_session_timeout = '15s';
alter role app_ro set statement_timeout = '5s';
alter role app_ro set idle_in_transaction_session_timeout = '15s';
alter role app_ro set default_transaction_read_only = on;
alter role authenticated set statement_timeout = '8s';

do $$
begin
  execute format('grant create on database %I to migration_owner', current_database());
end $$;

-- Nothing lives in public, and nobody can create there.
revoke all on schema public from public, anon, authenticated;

-- Nine schemas, one owner. Exposed to the API: every schema except platform (see db/README.md).
do $$
declare
  s text;
  owners text[] := array['migration_owner'];
  o text;
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    owners := array_append(owners, 'postgres');     -- in case a migration is ever run as postgres by mistake
  end if;

  foreach s in array array['identity', 'membership', 'world_lore', 'story_run', 'reader',
                           'vn_content', 'assets', 'generation', 'platform']
  loop
    execute format('create schema if not exists %I authorization migration_owner', s);
    execute format('revoke all on schema %I from public, anon', s);
    foreach o in array owners loop
      execute format('alter default privileges for role %I in schema %I revoke all on tables from public, anon, authenticated', o, s);
      execute format('alter default privileges for role %I in schema %I revoke all on sequences from public, anon, authenticated', o, s);
      execute format('alter default privileges for role %I in schema %I revoke execute on functions from public, anon', o, s);
    end loop;
  end loop;

  -- new functions in any schema are not executable by everyone unless granted
  foreach o in array owners loop
    execute format('alter default privileges for role %I revoke execute on functions from public', o);
  end loop;
end $$;

-- every schema is usable by the app roles; the API roles get usage only where they have objects
grant usage on schema identity, membership, world_lore, story_run, reader, vn_content, assets, generation
  to authenticated, app_rw, app_ro;
grant usage on schema platform to authenticated, app_rw, app_ro, service_role;   -- platform.uid() / jwt() are used by policies
grant usage on schema identity to supabase_auth_admin;
grant usage on schema identity, membership, world_lore, story_run, reader, vn_content, assets, generation, platform
  to service_role;

comment on schema identity   is 'People, age confirmation, invitations.';
comment on schema membership is 'Roles per world, story seats, moderation. Exports the policy helpers.';
comment on schema world_lore is 'Worlds, lines, cards, host-only secrets, versions.';
comment on schema story_run  is 'Stories, turns, events.';
comment on schema reader     is 'Published chapters and reading progress.';
comment on schema vn_content is 'Visual novel adaptations.';
comment on schema assets     is 'Asset records, prompt specs, renders, feedback dataset.';
comment on schema generation is 'Generation jobs and their status.';
comment on schema platform   is 'Shared status vocabulary, templates, audit, outbox. Not exposed to the API.';
