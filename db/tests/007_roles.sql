-- pgTAP: the four roles (migration 022). Needs migrations 001-022 and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
begin;
select * from no_plan();

create schema tx;
grant usage on schema tx to public;
create table tx.out (n int generated always as identity primary key, line text);
grant all on tx.out to public;
create table tx.ids (k text primary key, v uuid);
grant all on tx.ids to public;
create function tx.id(p_k text) returns uuid language sql stable as $$ select v from tx.ids where k = p_k $$;
grant execute on function tx.id(text) to public;
create function tx.act(p_user uuid default null, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end $$;
grant execute on function tx.act(uuid, text) to public;

-- fixtures: A may found worlds (author), M moderator, P player, X administrator, O outsider ---------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'a@example.test'), ('00000000-0000-0000-0000-00000000e002', 'm@example.test'),
  ('00000000-0000-0000-0000-00000000e003', 'p@example.test'), ('00000000-0000-0000-0000-00000000e004', 'x@example.test'),
  ('00000000-0000-0000-0000-00000000e005', 'o@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000e001', 'A', true), ('00000000-0000-0000-0000-00000000e002', 'M', false),
  ('00000000-0000-0000-0000-00000000e003', 'P', false), ('00000000-0000-0000-0000-00000000e004', 'X', false),
  ('00000000-0000-0000-0000-00000000e005', 'O', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id::text like '00000000-0000-0000-0000-00000000e00%';
insert into tx.ids values ('A', '00000000-0000-0000-0000-00000000e001'), ('M', '00000000-0000-0000-0000-00000000e002'),
  ('P', '00000000-0000-0000-0000-00000000e003'), ('X', '00000000-0000-0000-0000-00000000e004'),
  ('O', '00000000-0000-0000-0000-00000000e005');

-- the role vocabulary --------------------------------------------------------------------------------
insert into tx.out (line) select is((select array_agg(key order by sort_order) from membership.roles),
  array['author', 'moderator', 'player'], 'the world roles are author, moderator and player');

-- admin is service-only ---------------------------------------------------------------------------------
select tx.act(tx.id('A'));
insert into tx.out (line) select throws_ok(format('select identity.set_admin(%L, true)', tx.id('A')), '42501', null,
  'a person cannot make themselves an administrator');
select tx.act(null, 'service_role');
select identity.set_admin(tx.id('X'), true);
reset role;
insert into tx.out (line) select is((select is_admin from identity.profiles where user_id = tx.id('X')), true, 'the service role can make an administrator');

-- an author founds a world, grants roles ----------------------------------------------------------------
select tx.act(tx.id('A'));
insert into tx.ids select 'world', world_lore.create_world('roles-world', 'Roles');
insert into tx.out (line) select ok(membership.is_author(tx.id('world')), 'the founder is an author');
select membership.grant_role(tx.id('world'), tx.id('M'), 'moderator');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');
insert into tx.out (line) select throws_ok(format('select membership.revoke_role(%L, %L, %L)', tx.id('world'), tx.id('A'), 'author'), '23514', null,
  'a world needs at least one author');

-- who can do what in that world ---------------------------------------------------------------------------
select tx.act(tx.id('M'));
insert into tx.out (line) select ok(membership.is_staff(tx.id('world')) and not membership.is_author(tx.id('world')), 'a moderator is staff, not an author');
select tx.act(tx.id('P'));
insert into tx.out (line) select ok(membership.is_member(tx.id('world')) and not membership.is_staff(tx.id('world')), 'a player is a member, not staff');
select tx.act(tx.id('O'));
insert into tx.out (line) select ok(not membership.is_member(tx.id('world')), 'an outsider is not a member');
select tx.act(tx.id('X'));
insert into tx.out (line) select ok(membership.is_author(tx.id('world')) and membership.is_staff(tx.id('world')) and membership.is_member(tx.id('world')),
  'an administrator passes every check without being a member');
insert into tx.out (line) select ok(platform.is_any_author(), 'an administrator counts as an author everywhere');
select tx.act(tx.id('P'));
insert into tx.out (line) select ok(not platform.is_any_author(), 'a player is not an author anywhere');

-- the old names are gone ------------------------------------------------------------------------------
reset role;
insert into tx.out (line) select is((select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('platform', 'identity', 'membership', 'world_lore', 'story_run', 'reader', 'vn_content', 'assets', 'generation')
    and (p.proname in ('is_host', 'is_host_of', 'is_any_host', 'create_host_invitation')
         or p.prosrc like '%membership.is\_host(%'))::int, 0, 'no function still carries the host role name');

select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
