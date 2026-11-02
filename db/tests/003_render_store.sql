-- pgTAP: where a render's file lives (migration 018). Needs migrations 001-018 and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Three people: H host, P player, O outsider.
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
  ('00000000-0000-0000-0000-00000000f001', 'h@example.test'), ('00000000-0000-0000-0000-00000000f003', 'p@example.test'),
  ('00000000-0000-0000-0000-00000000f004', 'o@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f001', 'H', true), ('00000000-0000-0000-0000-00000000f003', 'P', false),
  ('00000000-0000-0000-0000-00000000f004', 'O', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f003',
                    '00000000-0000-0000-0000-00000000f004');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f001'), ('P', '00000000-0000-0000-0000-00000000f003'),
  ('O', '00000000-0000-0000-0000-00000000f004');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('store-world', 'Store');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');
insert into tx.ids select 'asset', assets.create_asset(tx.id('world'), null, 'sprite', 'hero');
insert into tx.ids select 'spec', assets.add_spec(tx.id('asset'), 'a figure', '', 1, 20, 7, 'euler', 'normal', 512, 768);

-- 1. recording a render with its store and file facts -------------------------------------------------
insert into tx.ids select 'r1', assets.record_render(tx.id('asset'), tx.id('spec'), tx.id('world')::text || '/hero/one.png', null,
  'local', 100, repeat('a', 64), 'image/png');
insert into tx.out (line) select is((select store from assets.renders where id = tx.id('r1')), 'local', 'a render can be recorded as local');
insert into tx.out (line) select is((select bytes from assets.renders where id = tx.id('r1')), 100::bigint, 'the size is recorded');
insert into tx.out (line) select throws_ok(format('select assets.record_render(%L, %L, %L, null, %L)', tx.id('asset'), tx.id('spec'),
  tx.id('world')::text || '/hero/bad.png', 'none'), '23514', null, 'a new render cannot start as none');
insert into tx.out (line) select throws_ok(format('select assets.record_render(%L, %L, %L, null, %L, null, %L)', tx.id('asset'), tx.id('spec'),
  tx.id('world')::text || '/hero/bad2.png', 'local', 'not-a-hash'), '23514', null, 'a bad hash is refused');
insert into tx.out (line) select is((select current_store from assets.v_asset_list where asset_id = tx.id('asset')), 'local', 'the list shows the current store');

-- 2. moving between stores ----------------------------------------------------------------------------
select assets.set_render_store(tx.id('r1'), 'supabase', 999, repeat('b', 64), 'image/jpeg');
insert into tx.out (line) select is((select store from assets.renders where id = tx.id('r1')), 'supabase', 'the render moved to supabase');
insert into tx.out (line) select is((select bytes from assets.renders where id = tx.id('r1')), 100::bigint, 'a recorded size is not overwritten');
insert into tx.out (line) select is((select sha256 from assets.renders where id = tx.id('r1')), repeat('a', 64), 'a recorded hash is not overwritten');
insert into tx.out (line) select throws_ok(format('select assets.set_render_store(%L, %L)', tx.id('r1'), 'cloud'), '23514', null, 'an unknown store is refused');
insert into tx.out (line) select throws_ok(format('select assets.set_render_store(%L, %L)', tx.id('r1'), 'none'), '23514', null,
  'the current render keeps its file');

reset role;
insert into tx.out (line) select is((select count(*) from platform.audit_log where action = 'render_store' and subject_id = tx.id('r1'))::int, 1,
  'the move is audited');
insert into tx.out (line) select throws_ok(format('update assets.renders set bytes = 5 where id = %L', tx.id('r1')), '42501', null,
  'a recorded size cannot be changed directly');
insert into tx.out (line) select throws_ok(format('update assets.renders set storage_path = %L where id = %L', tx.id('world')::text || '/x.png', tx.id('r1')),
  '42501', null, 'the path cannot be changed');

-- 3. a second render makes the first one deletable ----------------------------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'r2', assets.record_render(tx.id('asset'), tx.id('spec'), tx.id('world')::text || '/hero/two.png');
insert into tx.out (line) select is((select store from assets.renders where id = tx.id('r2')), 'supabase', 'the default store is supabase');
insert into tx.out (line) select is((select bytes from assets.renders where id = tx.id('r2')), null::bigint, 'an unknown size stays null');
select assets.set_render_store(tx.id('r1'), 'none');
insert into tx.out (line) select is((select store from assets.renders where id = tx.id('r1')), 'none', 'an old render can lose its file');
insert into tx.out (line) select is((select count(*) from assets.renders where id = tx.id('r1'))::int, 1, 'the row stays');

-- 4. usage view ----------------------------------------------------------------------------------------
insert into tx.out (line) select is((select files from assets.v_store_usage where world_id = tx.id('world') and store = 'supabase')::int, 1, 'one file in supabase');
insert into tx.out (line) select is((select unknown_size from assets.v_store_usage where world_id = tx.id('world') and store = 'supabase')::int, 1,
  'the unknown size is counted');
insert into tx.out (line) select is((select bytes from assets.v_store_usage where world_id = tx.id('world') and store = 'none')::int, 100, 'deleted files keep their recorded size');

-- 5. who may do it -------------------------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select throws_ok(format('select assets.set_render_store(%L, %L)', tx.id('r2'), 'local'), '42501', null, 'a player cannot move a file');
insert into tx.out (line) select is((select count(*) from assets.v_store_usage)::int, 2, 'a player reads the usage');
select tx.act(tx.id('O'));
insert into tx.out (line) select is((select count(*) from assets.v_store_usage)::int, 0, 'an outsider sees no usage');
insert into tx.out (line) select throws_ok(format('select assets.set_render_store(%L, %L)', tx.id('r2'), 'local'), '42501', null, 'an outsider cannot move a file');
select tx.act(null, 'service_role');
select assets.set_render_store(tx.id('r2'), 'local', 50, repeat('c', 64), 'image/png');
insert into tx.out (line) select is((select store from assets.renders where id = tx.id('r2')), 'local', 'the server can move a file');
insert into tx.out (line) select is((select bytes from assets.renders where id = tx.id('r2')), 50::bigint, 'the server fills in a missing size');
select tx.act(null, 'anon');
insert into tx.out (line) select throws_ok('select * from assets.v_store_usage', '42501', null, 'anon cannot read usage');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
