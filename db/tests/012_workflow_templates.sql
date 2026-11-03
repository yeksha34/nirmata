-- pgTAP: the bundled workflows as platform defaults, a world's own copy, and a visual novel's pin (F-71).
-- Needs all migrations and pgtap. Run in the SQL editor as postgres (it rolls back and leaves nothing behind),
-- or: supabase test db
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
  ('00000000-0000-0000-0000-00000000f201', 'h@example.test'), ('00000000-0000-0000-0000-00000000f203', 'p@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f201', 'H', true), ('00000000-0000-0000-0000-00000000f203', 'P', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f201', '00000000-0000-0000-0000-00000000f203');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f201'), ('P', '00000000-0000-0000-0000-00000000f203');

select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('tpl-world', 'Templates');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');

-- 1. every kind of asset has a platform default, and the bundled graphs are valid --------------------------------
insert into tx.out (line) select is((select count(*) from platform.template_kinds where key like 'workflow\_%')::int, 6,
  'a workflow kind for each of the six assets');
insert into tx.out (line) select is((select count(*) from platform.template_pins where scope_type = 'platform' and kind_key like 'workflow\_%')::int, 6,
  'each has a platform default');
insert into tx.out (line) select is((select count(*) from platform.effective_template(tx.id('world'), null, 'workflow_clothes'))::int, 1,
  'the author resolves the default for a new kind');
insert into tx.out (line) select ok((select bool_and(n.value ->> 'class_type' is not null)
    from platform.effective_template(tx.id('world'), null, 'workflow_object') e, jsonb_each(e.body) n),
  'the default is a graph of nodes');
insert into tx.out (line) select is((select resolved_scope from platform.effective_template(tx.id('world'), null, 'workflow_sprite')),
  'platform', 'a world with no copy resolves the platform default');

-- 2. a player resolves nothing and cannot copy -----------------------------------------------------------------------
select tx.act(tx.id('P'));
insert into tx.out (line) select is((select count(*) from platform.effective_template(tx.id('world'), null, 'workflow_sprite'))::int, 0,
  'a player resolves nothing');
insert into tx.out (line) select throws_ok(format('select platform.upgrade_world_template(%L, %L)', tx.id('world'), 'workflow_sprite'),
  '42501', null, 'a player cannot adopt a default');

-- 3. the author's own copy: draft, ready, publish, and the next edit adds a version ------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'tpl', platform.create_template_override('workflow_sprite', tx.id('world'));
update platform.template_drafts
   set body = jsonb_set(body, '{6,inputs,steps}', '33')
 where template_id = tx.id('tpl');
select platform.set_template_ready(tx.id('tpl'), true);
select platform.publish_template(tx.id('tpl'), 'more steps');
insert into tx.out (line) select is((select resolved_scope from platform.effective_template(tx.id('world'), null, 'workflow_sprite')),
  'world', 'the world now resolves its own copy');
insert into tx.out (line) select is((select (body -> '6' -> 'inputs' ->> 'steps') from platform.effective_template(tx.id('world'), null, 'workflow_sprite')),
  '33', 'with the change in it');

update platform.template_drafts set body = jsonb_set(body, '{6,inputs,steps}', '44') where template_id = tx.id('tpl');
select platform.set_template_ready(tx.id('tpl'), true);
select platform.publish_template(tx.id('tpl'), 'even more');
insert into tx.out (line) select is((select count(*) from platform.template_versions where template_id = tx.id('tpl'))::int, 2,
  'editing the same template again adds a version');
insert into tx.out (line) select is((select (body -> '6' -> 'inputs' ->> 'steps') from platform.effective_template(tx.id('world'), null, 'workflow_sprite')),
  '44', 'and the world resolves the latest');

-- 4. the database refuses a node outside the allow-list and a file path -------------------------------------------
insert into tx.ids select 'tpl2', platform.create_template_override('workflow_cg', tx.id('world'));
update platform.template_drafts set body = body || '{"99": {"class_type": "Evil", "inputs": {}}}'::jsonb where template_id = tx.id('tpl2');
select platform.set_template_ready(tx.id('tpl2'), true);
insert into tx.out (line) select throws_ok(format('select platform.publish_template(%L)', tx.id('tpl2')), '22023', null,
  'a node outside the allow-list cannot be published');

-- 5. going back to the platform default; the copy stays as history ----------------------------------------------
select platform.reset_world_template(tx.id('world'), 'workflow_sprite');
insert into tx.out (line) select is((select resolved_scope from platform.effective_template(tx.id('world'), null, 'workflow_sprite')),
  'platform', 'a reset world resolves the platform default again');
insert into tx.out (line) select is((select count(*) from platform.template_versions where template_id = tx.id('tpl'))::int, 2,
  'its versions stay as history');

-- 6. adopting the platform default pins it for the world -------------------------------------------------------------
select platform.upgrade_world_template(tx.id('world'), 'workflow_bg');
insert into tx.out (line) select is((select resolved_scope from platform.effective_template(tx.id('world'), null, 'workflow_bg')),
  'world', 'an adopted default is the world''s own pin');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
