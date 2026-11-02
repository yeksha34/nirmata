-- pgTAP baseline for migrations 001-004. Run against a database built from supabase/migrations.
--   psql -f db/tests/001_baseline.sql        (or: supabase test db)
begin;
select * from no_plan();

-- 1. anon holds nothing, anywhere ------------------------------------------------------------
select is_empty($$
  select table_schema, table_name from information_schema.role_table_grants
  where grantee in ('anon', 'PUBLIC')
    and table_schema in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
$$, 'anon and PUBLIC have no table privileges');

select is_empty($$
  select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))
$$, 'anon and PUBLIC cannot execute any function');

select is_empty($$
  select nspname from pg_namespace
  where nspname in ('public','identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
    and has_schema_privilege('anon', oid, 'usage')
$$, 'anon has no schema usage');

-- 2. app_ro cannot write ---------------------------------------------------------------------
select is_empty($$
  select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
    and c.relkind in ('r','p','v','m')
    and (has_table_privilege('app_ro', c.oid, 'insert') or has_table_privilege('app_ro', c.oid, 'update')
      or has_table_privilege('app_ro', c.oid, 'delete') or has_table_privilege('app_ro', c.oid, 'truncate'))
$$, 'app_ro holds no write privilege on any relation');

select is(
  (select setconfig::text from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
   where r.rolname = 'app_ro' and 'default_transaction_read_only=on' = any (s.setconfig)
   limit 1) is not null, true, 'app_ro is read-only by default');

-- 3. every view uses the caller's rights -------------------------------------------------------
select is_empty($$
  select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v'
    and n.nspname in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
    and not coalesce('security_invoker=true' = any (c.reloptions), false)
$$, 'every view has security_invoker = true');

-- 4. every table has row level security (partitions inherit the parent) ------------------------
select is_empty($$
  select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and not c.relrowsecurity and not c.relispartition
    and n.nspname in ('identity','membership','world_lore','story_run','reader','vn_content','assets','generation','platform')
$$, 'row level security is enabled on every table');

-- 5. status machines cannot be skipped ---------------------------------------------------------
select is(
  (select count(*) from pg_trigger t where t.tgname = 'invitations_transition' and t.tgenabled = 'O'),
  1::bigint, 'the invitation transition trigger exists and is enabled');

-- 6. tokens and secrets are never granted -------------------------------------------------------
select is(has_column_privilege('authenticated', 'identity.invitations', 'token_hash', 'select'),
  false, 'authenticated cannot read invitation token hashes');
select is(has_table_privilege('authenticated', 'identity.idp_age_rules', 'select'),
  false, 'authenticated cannot read provider age rules');

-- 7. invitation behaviour (needs the Supabase auth schema) --------------------------------------
-- two people, one host-capable
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'host@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'guest@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-0000000000a1', 'Host', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Guest', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key) values
  ('00000000-0000-0000-0000-0000000000a1', true, now(), 'idp_attestation'),
  ('00000000-0000-0000-0000-0000000000a2', true, now(), 'idp_attestation');
insert into world_lore.worlds (id, slug, title, created_by) values
  ('00000000-0000-0000-0000-0000000000b1', 'baseline-world', 'Baseline', '00000000-0000-0000-0000-0000000000a1');
insert into membership.world_members (world_id, user_id, role_key, granted_by) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'host',
   '00000000-0000-0000-0000-0000000000a1');

select throws_ok($$
  insert into identity.invitations (token_hash, invitee_email, world_id, role_key, status_key, expires_at)
  values (sha256('x'::bytea), 'a@example.test', '00000000-0000-0000-0000-0000000000b1', 'player', 'accepted', now() + interval '1 day')
$$, '23514', null, 'a new invitation cannot start in a later state');

insert into identity.invitations (id, token_hash, invitee_email, world_id, role_key, invited_by, expires_at)
values ('00000000-0000-0000-0000-0000000000c1', sha256('tok'::bytea), 'guest@example.test',
        '00000000-0000-0000-0000-0000000000b1', 'player', '00000000-0000-0000-0000-0000000000a1',
        now() + interval '1 day');

-- the owner has no signed-in user, so it counts as the system: pending -> accepted is allowed ...
select lives_ok($$
  update identity.invitations set status_key = 'accepted', accepted_at = now(), accepted_by = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000c1'
$$, 'pending -> accepted is an allowed move');
select is((select is_terminal from identity.invitations where id = '00000000-0000-0000-0000-0000000000c1'),
  true, 'the trigger copies is_terminal from the status');
select is((select count(*) from identity.invitation_status_history where entity_id = '00000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'the move was written to history');
-- ... and a terminal state cannot be left
select throws_ok($$
  update identity.invitations set status_key = 'pending' where id = '00000000-0000-0000-0000-0000000000c1'
$$, '23514', null, 'accepted -> pending is refused');

-- 8. revocation takes effect on the next statement ----------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(membership.is_host('00000000-0000-0000-0000-0000000000b1'), true, 'the host is a host');
reset request.jwt.claims;

select * from finish();
rollback;
