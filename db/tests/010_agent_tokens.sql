-- pgTAP: agent tokens (ADR-0035). Needs all migrations and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Two people: H author of the world, P a player in it.
begin;
select * from no_plan();

create schema tx;
grant usage on schema tx to public;
create table tx.ids (k text primary key, v uuid not null);
grant all on tx.ids to public;
create table tx.txt (k text primary key, v text not null);
grant all on tx.txt to public;
create table tx.out (n int generated always as identity primary key, line text);
grant all on tx.out to public;
create function tx.id(p_k text) returns uuid language sql stable as $$ select v from tx.ids where k = p_k $$;
grant execute on function tx.id(text) to public;
create function tx.txt_of(p_k text) returns text language sql stable as $$ select v from tx.txt where k = p_k $$;
grant execute on function tx.txt_of(text) to public;
create function tx.act(p_user uuid default null, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end $$;
grant execute on function tx.act(uuid, text) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'h@example.test'), ('00000000-0000-0000-0000-00000000f003', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f001', 'H', true), ('00000000-0000-0000-0000-00000000f003', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f003');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f001'), ('P', '00000000-0000-0000-0000-00000000f003');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('token-world', 'Token');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. an author makes a token; only its hash is kept ----------------------------------------------------------------
insert into tx.txt select 'token', identity.create_agent_token(tx.id('world'), 'adaptation agent') ->> 'token';
insert into tx.ids select 'tid', (select id from identity.agent_tokens where world_id = tx.id('world'));
insert into tx.out (line) select ok(tx.txt_of('token') like 'nga_%', 'a token is marked as an agent token');
insert into tx.out (line) select is((select count(*) from identity.agent_tokens where world_id = tx.id('world'))::int, 1, 'the author sees the token row');
insert into tx.out (line) select throws_ok('select token_hash from identity.agent_tokens', '42501', null, 'the hash is never readable');
insert into tx.out (line) select throws_ok(format('select identity.create_agent_token(%L, %L, array[%L])', tx.id('world'), 'x', 'story.write'),
  '23514', null, 'only the two adaptation scopes exist');

-- 2. a player cannot make, see or revoke one --------------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select throws_ok(format('select identity.create_agent_token(%L, %L)', tx.id('world'), 'mine'), '42501', null,
  'a player cannot make a token');
insert into tx.out (line) select is((select count(*) from identity.agent_tokens)::int, 0, 'a player sees no tokens');
insert into tx.out (line) select throws_ok(format('select identity.revoke_agent_token(%L)', tx.id('tid')), '42501', null,
  'a player cannot revoke a token');

-- 3. only the server resolves a token ----------------------------------------------------------------------------------
insert into tx.out (line) select throws_ok(format('select * from identity.resolve_agent_token(%L)', tx.txt_of('token')), '42501', null,
  'a signed-in person cannot resolve a token');
reset role;
set local role service_role;
insert into tx.out (line) select is((select user_id from identity.resolve_agent_token(tx.txt_of('token'))), tx.id('H'),
  'the server learns whose token it is');
insert into tx.out (line) select is((select world_id from identity.resolve_agent_token(tx.txt_of('token'))), tx.id('world'),
  'and for which world');
insert into tx.out (line) select is((select count(*) from identity.resolve_agent_token('nga_unknown'))::int, 0, 'an unknown token resolves to nothing');

-- 4. revoking, expiry and a lapsed author end it --------------------------------------------------------------------
select tx.act(tx.id('H'));
select identity.revoke_agent_token(tx.id('tid'));
reset role;
set local role service_role;
insert into tx.out (line) select is((select count(*) from identity.resolve_agent_token(tx.txt_of('token')))::int, 0, 'a revoked token resolves to nothing');
select tx.act(tx.id('H'));
insert into tx.txt select 'second', identity.create_agent_token(tx.id('world'), 'second') ->> 'token';
reset role;
update membership.world_members set revoked_at = now() where world_id = tx.id('world') and user_id = tx.id('H');
set local role service_role;
insert into tx.out (line) select is((select count(*) from identity.resolve_agent_token(tx.txt_of('second')))::int, 0,
  'a token stops working when its author leaves the world');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
