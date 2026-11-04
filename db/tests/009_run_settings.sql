-- pgTAP: what a spec keeps of a generation run. Needs all migrations and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Two people: H author, P player.
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
  ('00000000-0000-0000-0000-00000000e001', 'h@example.test'), ('00000000-0000-0000-0000-00000000e003', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000e001', 'H', true), ('00000000-0000-0000-0000-00000000e003', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000e003');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000e001'), ('P', '00000000-0000-0000-0000-00000000e003');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('run-world', 'Run');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');
insert into tx.ids select 'asset', assets.create_asset(tx.id('world'), null, 'sprite', 'hero');

-- 1. a spec keeps the exact run settings ------------------------------------------------------------------
insert into tx.ids select 'full', assets.add_spec(tx.id('asset'), 'a figure', '', 77, 25, 6.5, 'dpmpp_2m', 'karras', 512, 768, null,
  '{"checkpoint": "base.safetensors", "loras": [{"name": "a.safetensors", "strength": 0.8}], "references": [{"name": "naked", "sha256": "abc"}], "workflow": {"3": {"class_type": "KSampler"}}}');
insert into tx.out (line) select is((select run_settings #>> '{checkpoint}' from assets.asset_specs where id = tx.id('full')), 'base.safetensors',
  'the checkpoint is kept');
insert into tx.out (line) select is((select run_settings #>> '{references,0,name}' from assets.asset_specs where id = tx.id('full')), 'naked',
  'the references are kept');
insert into tx.out (line) select is((select run_settings #>> '{workflow,3,class_type}' from assets.asset_specs where id = tx.id('full')), 'KSampler',
  'the workflow that was sent is kept');

-- 2. unknown values stay unknown ---------------------------------------------------------------------------
insert into tx.ids select 'unknown', assets.add_spec(tx.id('asset'), 'a figure', '', null, null, null, null, null, 512, 768);
insert into tx.out (line) select is((select seed from assets.asset_specs where id = tx.id('unknown')), null::bigint, 'an unknown seed is null, not 0');
insert into tx.out (line) select is((select steps from assets.asset_specs where id = tx.id('unknown')), null::int, 'unknown steps are null, not 20');
insert into tx.out (line) select is((select sampler from assets.asset_specs where id = tx.id('unknown')), null::text, 'an unknown sampler is null');
insert into tx.out (line) select is((select run_settings from assets.asset_specs where id = tx.id('unknown')), '{}'::jsonb, 'run settings default to empty');
insert into tx.out (line) select throws_ok(format('select assets.add_spec(%L, %L, %L, 1, 0, 7, %L, %L, 512, 768)', tx.id('asset'), 'x', '', 'euler', 'normal'),
  '23514', null, 'a known value is still checked');
insert into tx.out (line) select throws_ok(format('select assets.add_spec(%L, %L, %L, 1, 20, 7, %L, %L, 512, 768, null, %L)', tx.id('asset'), 'x', '', 'euler', 'normal', '[1]'),
  '23514', null, 'run settings must be an object');

-- 3. the dataset view shows them ---------------------------------------------------------------------------
insert into tx.ids select 'render', assets.record_render(tx.id('asset'), tx.id('full'), tx.id('world')::text || '/hero/one.png');
select assets.archive_render(tx.id('render'));
insert into tx.out (line) select is((select run_settings #>> '{checkpoint}' from assets.v_dataset_runs where render_id = tx.id('render')), 'base.safetensors',
  'the dataset view carries the run settings');

-- 4. a spec cannot be edited afterwards ----------------------------------------------------------------------
reset role;
insert into tx.out (line) select throws_ok(format('update assets.asset_specs set run_settings = %L where id = %L', '{}', tx.id('full')), null, null,
  'a spec cannot be changed');

-- 5. who may see them -------------------------------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select is((select count(*) from assets.asset_specs where id = tx.id('full'))::int, 1, 'a member reads the settings');
insert into tx.out (line) select throws_ok(format('select assets.add_spec(%L, %L, %L, 1, 20, 7, %L, %L, 512, 768)', tx.id('asset'), 'x', '', 'euler', 'normal'),
  '42501', null, 'a player cannot add a spec');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
