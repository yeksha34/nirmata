-- pgTAP: a visual novel's working copy in the database (F-72). Needs all migrations and pgtap.
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
  ('00000000-0000-0000-0000-00000000f301', 'h@example.test'), ('00000000-0000-0000-0000-00000000f303', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f301', 'H', true), ('00000000-0000-0000-0000-00000000f303', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f301', '00000000-0000-0000-0000-00000000f303');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f301'), ('P', '00000000-0000-0000-0000-00000000f303');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('vn-world', 'VN');
insert into tx.ids select 'line', id from world_lore.world_lines where world_id = tx.id('world') and is_default;
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. an unpublished world cannot be adapted yet -----------------------------------------------------------------
insert into tx.out (line) select throws_ok(format('select vn_content.save_vn(%L, %L, %L)', tx.id('world'), 'chapter-1', 'Chapter 1'),
  '23514', null, 'a world with no published version cannot be adapted');

-- publish the world once
with c as (insert into world_lore.cards (world_id, kind, slug) values (tx.id('world'), 'place', 'harbor') returning id)
  insert into tx.ids select 'card', id from c;
insert into world_lore.card_drafts (line_id, card_id, world_id, title, body)
  values (tx.id('line'), tx.id('card'), tx.id('world'), 'Harbor', 'text');
select world_lore.set_line_ready(tx.id('line'), true);
insert into tx.ids select 'wv', world_lore.publish_world_line(tx.id('line'), 'first');

-- 2. saving makes the visual novel, pinned to the published version --------------------------------------------------
insert into tx.ids select 'vn', vn_content.save_vn(tx.id('world'), 'chapter-1', 'Chapter 1', 'short',
  '{"slug": "chapter-1", "title": "Chapter 1"}', '# the script', '{"slides": [{"id": "s1"}]}');
insert into tx.out (line) select is((select world_version_id from vn_content.vns where id = tx.id('vn')), tx.id('wv'),
  'it is pinned to the published world version');
insert into tx.out (line) select is((select adaptation_md from vn_content.vn_drafts where vn_id = tx.id('vn')), '# the script',
  'the script is kept');
insert into tx.out (line) select is((select jsonb_array_length(slides -> 'slides') from vn_content.vn_drafts where vn_id = tx.id('vn')), 1,
  'the slides are kept');
insert into tx.out (line) select is((select count(*) from platform.template_pins where scope_type = 'vn' and scope_id = tx.id('vn'))::int, 7,
  'the visual novel is pinned to a workflow of every kind (and the skeleton)');

-- 3. saving again keeps what is not sent, and does not make a second one ------------------------------------------
select vn_content.save_vn(tx.id('world'), 'chapter-1', null, null, null, '# the new script', null);
insert into tx.out (line) select is((select count(*) from vn_content.vns where world_id = tx.id('world'))::int, 1, 'saving again does not add a visual novel');
insert into tx.out (line) select is((select adaptation_md from vn_content.vn_drafts where vn_id = tx.id('vn')), '# the new script', 'the script changed');
insert into tx.out (line) select is((select jsonb_array_length(slides -> 'slides') from vn_content.vn_drafts where vn_id = tx.id('vn')), 1,
  'the slides stayed');
insert into tx.out (line) select is((select manifest ->> 'title' from vn_content.vn_drafts where vn_id = tx.id('vn')), 'Chapter 1', 'the manifest stayed');

-- 4. refusals --------------------------------------------------------------------------------------------------------
insert into tx.out (line) select throws_ok(format('select vn_content.save_vn(%L, %L, null, null, %L)', tx.id('world'), 'chapter-2', '[1]'),
  '22023', null, 'a manifest must be an object');
insert into tx.out (line) select throws_ok(format('select vn_content.save_vn(%L, %L)', tx.id('world'), 'Bad_Name'),
  '23514', null, 'a name the database cannot hold is refused');

-- 5. a player cannot save, and cannot read the working copy ---------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select throws_ok(format('select vn_content.save_vn(%L, %L, %L)', tx.id('world'), 'chapter-3', 'x'),
  '42501', null, 'a player cannot save a visual novel');
insert into tx.out (line) select is((select count(*) from vn_content.vn_drafts)::int, 0, 'a player sees no working copy');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
