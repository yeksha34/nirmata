-- pgTAP: the kinds an agent token may write (F-74). Needs all migrations and pgtap.
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
  ('00000000-0000-0000-0000-00000000f601', 'h@example.test'), ('00000000-0000-0000-0000-00000000f603', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f601', 'H', true), ('00000000-0000-0000-0000-00000000f603', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-00000000f603');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f601'), ('P', '00000000-0000-0000-0000-00000000f603');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('story-world', 'Story');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

insert into tx.txt select 'any', identity.create_agent_token(tx.id('world'), 'everything', array['import.read', 'import.write']) ->> 'token';
insert into tx.txt select 'lane', identity.create_agent_token(tx.id('world'), 'accessories', array['import.read', 'import.write'],
  interval '7 days', array['clothes', 'adornment', 'object']) ->> 'token';

-- 1. a token without kinds may write any kind; a lane token carries its kinds ------------------------------
reset role;
set local role service_role;
insert into tx.out (line) select is((select kinds from identity.resolve_agent_token(tx.txt_of('any'))), null::text[], 'no kinds means any kind');
insert into tx.out (line) select is((select kinds from identity.resolve_agent_token(tx.txt_of('lane'))), array['clothes', 'adornment', 'object'], 'a lane token names its kinds');

-- 2. kinds are checked ---------------------------------------------------------------------------------------------
select tx.act(tx.id('H'));
insert into tx.out (line) select throws_ok(format('select identity.create_agent_token(%L, %L, array[%L], interval %L, array[%L])', tx.id('world'), 'bad', 'import.write', '7 days', 'Not A Kind'),
  '23514', null, 'a kind is lowercase letters and digits');
insert into tx.out (line) select throws_ok(format('select identity.create_agent_token(%L, %L, array[%L], interval %L, array[]::text[])', tx.id('world'), 'bad', 'import.write', '7 days'),
  '23514', null, 'an empty list of kinds is refused (leave it out for any kind)');

-- 3. the author sees the kinds of the tokens of the world ----------------------------------------------------------
insert into tx.out (line) select is((select kinds from identity.agent_tokens where label = 'accessories'), array['clothes', 'adornment', 'object'], 'the author sees a token''s kinds');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
