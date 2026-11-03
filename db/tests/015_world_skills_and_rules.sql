-- pgTAP: a world's skills and author rules, and the import scopes of an agent token (F-74). Needs all migrations and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Two people: H author of the world, P a player in it.
begin;
select * from no_plan();

create schema tx;
grant usage on schema tx to public;
create table tx.ids (k text primary key, v uuid not null);
grant all on tx.ids to public;
create table tx.out (n int generated always as identity primary key, line text);
grant all on tx.out to public;
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f501', 'h@example.test'), ('00000000-0000-0000-0000-00000000f503', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f501', 'H', true), ('00000000-0000-0000-0000-00000000f503', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f501', '00000000-0000-0000-0000-00000000f503');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f501'), ('P', '00000000-0000-0000-0000-00000000f503');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('story-world', 'Story');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. an author saves a skill; saving again replaces it ----------------------------------------------------------
select world_lore.save_world_skill(tx.id('world'), 'dark-fantasy', 'Dark fantasy', 'how to write it', 'first');
select world_lore.save_world_skill(tx.id('world'), 'dark-fantasy', 'Dark fantasy', 'how to write it', 'second');
insert into tx.out (line) select is((select count(*) from world_lore.world_skills where world_id = tx.id('world'))::int, 1, 'saving a skill again does not add');
insert into tx.out (line) select is((select body from world_lore.world_skills where world_id = tx.id('world')), 'second', 'it holds the new text');
insert into tx.out (line) select throws_ok(format('select world_lore.save_world_skill(%L, %L, %L, %L, %L)', tx.id('world'), 'Bad Slug', 'T', '', 'x'),
  '23514', null, 'a skill name is lowercase letters, digits and hyphens');

-- 2. rules ---------------------------------------------------------------------------------------------------------
select world_lore.save_author_rule(tx.id('world'), 'world-02-culture', 'Culture', 'rule text');
select world_lore.save_author_rule(tx.id('world'), 'world-04-restraint', 'Restraint', 'other text');
select world_lore.save_author_rule(tx.id('world'), 'world-04-restraint', 'Restraint', 'newer text');
insert into tx.out (line) select is((select count(*) from world_lore.author_rules where world_id = tx.id('world'))::int, 2, 'two rules, the second saved twice');
insert into tx.out (line) select is((select body from world_lore.author_rules where slug = 'world-04-restraint'), 'newer text', 'a rule is replaced by name');

-- 3. a player sees and changes nothing -----------------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select is((select count(*) from world_lore.world_skills)::int, 0, 'a player sees no skills');
insert into tx.out (line) select is((select count(*) from world_lore.author_rules)::int, 0, 'a player sees no rules');
insert into tx.out (line) select throws_ok(format('select world_lore.save_world_skill(%L, %L, %L, %L, %L)', tx.id('world'), 'x', 'X', '', 'x'),
  '42501', null, 'a player cannot save a skill');
insert into tx.out (line) select throws_ok(format('select world_lore.save_author_rule(%L, %L, %L, %L)', tx.id('world'), 'x', 'X', 'x'),
  '42501', null, 'a player cannot save a rule');
insert into tx.out (line) select throws_ok(format('select world_lore.remove_author_rule(%L, %L)', tx.id('world'), 'world-02-culture'),
  '42501', null, 'a player cannot remove a rule');

-- 4. removing -------------------------------------------------------------------------------------------------------
select tx.act(tx.id('H'));
select world_lore.remove_author_rule(tx.id('world'), 'world-02-culture');
select world_lore.remove_world_skill(tx.id('world'), 'dark-fantasy');
insert into tx.out (line) select is((select count(*) from world_lore.author_rules where world_id = tx.id('world'))::int, 1, 'a removed rule is gone');
insert into tx.out (line) select is((select count(*) from world_lore.world_skills where world_id = tx.id('world'))::int, 0, 'a removed skill is gone');

-- 5. a token may carry the import scopes, and no others -----------------------------------------------------------
insert into tx.out (line) select lives_ok(format('select identity.create_agent_token(%L, %L, array[%L, %L, %L, %L])', tx.id('world'), 'importer',
  'adaptation.read', 'adaptation.write', 'import.read', 'import.write'), 'a token with the import scopes is made');
insert into tx.out (line) select throws_ok(format('select identity.create_agent_token(%L, %L, array[%L])', tx.id('world'), 'odd', 'import.delete'),
  '23514', null, 'an unknown scope is refused');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
