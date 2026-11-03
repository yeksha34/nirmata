-- pgTAP: clothes, adornment and object links (asset_links migration). Needs all migrations and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f001', 'h@example.test'),
  ('00000000-0000-0000-0000-00000000f004', 'o@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f001', 'H', true), ('00000000-0000-0000-0000-00000000f004', 'O', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f004');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f001'), ('O', '00000000-0000-0000-0000-00000000f004');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('links-world', 'Links');
insert into tx.ids select 'cg', assets.create_asset(tx.id('world'), null, 'cg', 'scene_one');
insert into tx.ids select 'bg', assets.create_asset(tx.id('world'), null, 'bg', 'hall');
insert into tx.ids select 'clothes', assets.create_asset(tx.id('world'), null, 'clothes', 'uniform');
insert into tx.ids select 'base', assets.create_asset(tx.id('world'), null, 'clothes', 'ana_naked');
insert into tx.ids select 'adorn', assets.create_asset(tx.id('world'), null, 'adornment', 'ring');
insert into tx.ids select 'obj', assets.create_asset(tx.id('world'), null, 'object', 'cup');

insert into tx.out (line) select is((select count(*) from assets.v_asset_link_issues where world_id = tx.id('world')), 3::bigint, 'unlinked clothes, adornment and object are flagged; the unclad base is not');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{}'', ''{}'')', tx.id('clothes')), '23514', null, 'clothes need a character');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{Ana,Bo}'', ''{}'')', tx.id('clothes')), '23514', null, 'clothes take exactly one character');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{Ana}'', %L)', tx.id('adorn'), array[tx.id('cg')]), '23514', null, 'an adornment is not locked to a CG');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{}'', ''{}'')', tx.id('obj')), '23514', null, 'an object needs a link');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{}'', %L)', tx.id('obj'), array[tx.id('bg')]), '23514', null, 'a linked CG must be a cg asset');
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{Ana}'', ''{}'')', tx.id('cg')), '23514', null, 'a cg carries no links');

select assets.set_links(tx.id('clothes'), '{Ana}', '{}');
select assets.set_links(tx.id('adorn'), '{Ana}', '{}');
select assets.set_links(tx.id('base'), '{}', '{}');
select assets.set_links(tx.id('obj'), '{Ana}', array[tx.id('cg')]);
insert into tx.out (line) select is((select count(*) from assets.v_asset_link_issues where world_id = tx.id('world')), 0::bigint, 'linked assets are clean');
insert into tx.out (line) select is((select link_characters from assets.v_asset_list where asset_id = tx.id('obj')), array['Ana'], 'the list shows the character link');
insert into tx.out (line) select is((select link_cgs from assets.v_asset_list where asset_id = tx.id('obj')), array[tx.id('cg')], 'the list shows the CG link');

select tx.act(tx.id('O'));
insert into tx.out (line) select throws_ok(format('select assets.set_links(%L, ''{Bo}'', ''{}'')', tx.id('clothes')), '42501', null, 'only the host sets links');
insert into tx.out (line) select is((select count(*) from assets.asset_links), 0::bigint, 'an outsider reads no links');

select tx.act(tx.id('H'));
select assets.set_links(tx.id('clothes'), '{Bo}', '{}');
insert into tx.out (line) select is((select link_characters from assets.v_asset_list where asset_id = tx.id('clothes')), array['Bo'], 'setting links replaces the old ones');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
