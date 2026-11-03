-- pgTAP: character prep and unplanning assets (ADR-0035). Needs all migrations and pgtap.
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
  ('00000000-0000-0000-0000-00000000f101', 'h@example.test'), ('00000000-0000-0000-0000-00000000f103', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f101', 'H', true), ('00000000-0000-0000-0000-00000000f103', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000f103');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f101'), ('P', '00000000-0000-0000-0000-00000000f103');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('prep-world', 'Prep');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. an author saves a prep with its expressions and outfits, in order ------------------------------------------
select assets.save_character_prep(tx.id('world'), 'Mara', 'tall', 'blurry', 'a note', 'abc123',
  '[{"expression": "calm", "tags": "soft"}, {"expression": "angry", "tags": "sharp"}]',
  '[{"kind": "clothes", "name": "robe", "tags": "grey"}, {"kind": "adornment", "name": "ring", "tags": "silver"}]');
insert into tx.out (line) select is((select base_positive from assets.character_prep where world_id = tx.id('world')), 'tall', 'the base look is kept');
insert into tx.out (line) select is((select string_agg(expression, ',' order by position) from assets.character_expressions where world_id = tx.id('world')),
  'calm,angry', 'expressions keep their order');
insert into tx.out (line) select is((select count(*) from assets.character_outfits where world_id = tx.id('world'))::int, 2, 'outfits are kept');

-- 2. saving again replaces, it does not add ---------------------------------------------------------------------------
select assets.save_character_prep(tx.id('world'), 'Mara', 'taller', '', '', 'def456', '[{"expression": "calm"}]', '[]');
insert into tx.out (line) select is((select count(*) from assets.character_expressions where world_id = tx.id('world'))::int, 1, 'expressions are replaced');
insert into tx.out (line) select is((select count(*) from assets.character_outfits where world_id = tx.id('world'))::int, 0, 'outfits are replaced');
insert into tx.out (line) select throws_ok(format('select assets.save_character_prep(%L, %L, %L, %L, %L, null, %L)', tx.id('world'), 'Mara', '', '', '', '[{"expression": "No Good"}]'),
  '23514', null, 'an expression name must be a safe asset name');

-- 3. a player cannot read or write a prep (it carries the card's Secrets) ----------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select is((select count(*) from assets.character_prep)::int, 0, 'a player sees no prep');
insert into tx.out (line) select throws_ok(format('select assets.save_character_prep(%L, %L, %L, %L, %L, null)', tx.id('world'), 'Mara', '', '', ''),
  '42501', null, 'a player cannot save a prep');

-- 4. unplanning: an ungenerated asset is deleted and its name is free again ------------------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'bg', assets.create_asset(tx.id('world'), null, 'bg', 'quay');
insert into tx.out (line) select is(assets.unplan_asset(tx.id('bg')), 'deleted', 'a planned asset with no history is deleted');
insert into tx.ids select 'bg2', assets.create_asset(tx.id('world'), null, 'bg', 'quay');
insert into tx.out (line) select ok(tx.id('bg2') is not null, 'its name can be planned again');

-- 5. a generated asset is retired, and its name is free again too ---------------------------------------------------
insert into tx.ids select 'spec', assets.add_spec(tx.id('bg2'), 'a quay', '', null, null, null, null, null, 512, 768);
insert into tx.out (line) select is(assets.unplan_asset(tx.id('bg2')), 'retired', 'an asset with a spec is retired, not deleted');
insert into tx.out (line) select is((select status_key from assets.assets where id = tx.id('bg2')), 'retired', 'it stays as a record');
insert into tx.ids select 'bg3', assets.create_asset(tx.id('world'), null, 'bg', 'quay');
insert into tx.out (line) select ok(tx.id('bg3') is not null, 'a retired name can be planned again');

select tx.act(tx.id('P'));
insert into tx.out (line) select throws_ok(format('select assets.unplan_asset(%L)', tx.id('bg3')), '42501', null, 'a player cannot unplan an asset');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
