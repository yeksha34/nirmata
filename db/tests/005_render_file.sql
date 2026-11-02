-- pgTAP: the file lookup the backend uses (migration 020). Needs migrations 001-020 and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Two people: H host, O outsider.
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
insert into tx.ids select 'world', world_lore.create_world('file-world', 'File');
insert into tx.ids select 'asset', assets.create_asset(tx.id('world'), null, 'sprite', 'hero');
insert into tx.ids select 'spec', assets.add_spec(tx.id('asset'), 'a figure', '', 1, 20, 7, 'euler', 'normal', 512, 768);
insert into tx.ids select 'r1', assets.record_render(tx.id('asset'), tx.id('spec'), tx.id('world')::text || '/hero/one.png', null,
  'local', 100, repeat('a', 64), 'image/png');

insert into tx.out (line) select is((select store from assets.render_file(tx.id('r1'))), 'local', 'a member of the world finds the file');
insert into tx.out (line) select is((select bytes from assets.render_file(tx.id('r1'))), 100::bigint, 'with its size');
insert into tx.out (line) select is((select count(*) from assets.render_file(gen_random_uuid()))::int, 0, 'an unknown id returns nothing');
select tx.act(tx.id('O'));
insert into tx.out (line) select is((select count(*) from assets.render_file(tx.id('r1')))::int, 0, 'an outsider learns nothing, not even that it exists');
select tx.act(null, 'service_role');
insert into tx.out (line) select is((select storage_path from assets.render_file(tx.id('r1'))), tx.id('world')::text || '/hero/one.png', 'the server finds any file');
select tx.act(null, 'anon');
insert into tx.out (line) select throws_ok('select * from assets.render_file(gen_random_uuid())', '42501', null, 'anon cannot call it');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
