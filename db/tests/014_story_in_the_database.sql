-- pgTAP: a world's chapters and drafts, and its manifest, in the database (F-73). Needs all migrations and pgtap.
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
  ('00000000-0000-0000-0000-00000000f401', 'h@example.test'), ('00000000-0000-0000-0000-00000000f403', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f401', 'H', true), ('00000000-0000-0000-0000-00000000f403', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f401', '00000000-0000-0000-0000-00000000f403');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f401'), ('P', '00000000-0000-0000-0000-00000000f403');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('story-world', 'Story');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. an author saves a writing; saving again replaces it and keeps the import stamp ---------------------------
select reader.save_writing(tx.id('world'), 'chapters/chapter_1.md', 'One', 'first text', 'stamp1');
insert into tx.out (line) select is((select dir from reader.writings where world_id = tx.id('world')), 'chapters', 'the folder is read from the path');
insert into tx.out (line) select is((select body_hash from reader.writings where world_id = tx.id('world')),
  encode(sha256(convert_to('first text', 'UTF8')), 'hex'), 'the hash is of the text');
select reader.save_writing(tx.id('world'), 'chapters/chapter_1.md', 'One', 'edited text');
insert into tx.out (line) select is((select count(*) from reader.writings where world_id = tx.id('world'))::int, 1, 'saving again does not add');
insert into tx.out (line) select is((select imported_hash from reader.writings where world_id = tx.id('world')), 'stamp1',
  'an edit keeps the import stamp, so it shows as different from it');
insert into tx.out (line) select isnt((select body_hash from reader.writings where world_id = tx.id('world')), 'stamp1', 'and the hash moved');
select reader.save_writing(tx.id('world'), 'chapters/chapter_1.md', 'One', 'file text again', 'stamp2');
insert into tx.out (line) select is((select imported_hash from reader.writings where world_id = tx.id('world')), 'stamp2', 'an import replaces the stamp');

-- 2. paths: only markdown under chapters/ or drafts/ ---------------------------------------------------------------
insert into tx.out (line) select throws_ok(format('select reader.save_writing(%L, %L, %L, %L)', tx.id('world'), 'lore/a.md', 'A', 'x'),
  '23514', null, 'a path outside chapters and drafts is refused');
insert into tx.out (line) select throws_ok(format('select reader.save_writing(%L, %L, %L, %L)', tx.id('world'), 'chapters/../lore/a.md', 'A', 'x'),
  '23514', null, 'a path with .. is refused');
insert into tx.out (line) select throws_ok(format('select reader.save_writing(%L, %L, %L, %L)', tx.id('world'), 'chapters/a.txt', 'A', 'x'),
  '23514', null, 'a path that is not markdown is refused');
select reader.save_writing(tx.id('world'), 'drafts/arc one/draft.md', 'Draft', 'words');
insert into tx.out (line) select is((select count(*) from reader.writings where world_id = tx.id('world') and dir = 'drafts')::int, 1, 'a nested draft path is kept');

-- 3. a player cannot read or write them ---------------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select is((select count(*) from reader.writings)::int, 0, 'a player sees no writings');
insert into tx.out (line) select throws_ok(format('select reader.save_writing(%L, %L, %L, %L)', tx.id('world'), 'chapters/x.md', 'X', 'x'),
  '42501', null, 'a player cannot save a writing');
insert into tx.out (line) select throws_ok(format('select reader.remove_writing(%L, %L)', tx.id('world'), 'chapters/chapter_1.md'),
  '42501', null, 'a player cannot remove one');

-- 4. removing -------------------------------------------------------------------------------------------------------
select tx.act(tx.id('H'));
select reader.remove_writing(tx.id('world'), 'drafts/arc one/draft.md');
insert into tx.out (line) select is((select count(*) from reader.writings where world_id = tx.id('world'))::int, 1, 'a removed writing is gone');

-- 5. the manifest ---------------------------------------------------------------------------------------------------
select world_lore.save_world_manifest(tx.id('world'), '{"name": "story-world", "title": "A New Title", "tagline": "t"}');
insert into tx.out (line) select is((select manifest ->> 'tagline' from world_lore.worlds where id = tx.id('world')), 't', 'the manifest is kept');
insert into tx.out (line) select is((select title from world_lore.worlds where id = tx.id('world')), 'A New Title', 'its title is the world title');
insert into tx.out (line) select throws_ok(format('select world_lore.save_world_manifest(%L, %L)', tx.id('world'), '[1]'),
  '22023', null, 'a manifest must be an object');
select tx.act(tx.id('P'));
insert into tx.out (line) select throws_ok(format('select world_lore.save_world_manifest(%L, %L)', tx.id('world'), '{"title": "Mine"}'),
  '42501', null, 'a player cannot change the manifest');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
