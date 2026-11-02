-- pgTAP: the main flows end to end, as the people and the server who use them. Needs migrations 001-014 and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
-- Four people: H host, M moderator, P player, O outsider.
begin;
select * from no_plan();

create schema tx;
grant usage on schema tx to public;
create table tx.ids (k text primary key, v uuid not null);
grant all on tx.ids to public;
create function tx.id(p_k text) returns uuid language sql stable as $$ select v from tx.ids where k = p_k $$;
grant execute on function tx.id(text) to public;
-- act as a person (or the server): reset, set the claims, switch role
create function tx.act(p_user uuid default null, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end $$;
grant execute on function tx.act(uuid, text) to public;

-- fixtures: four signed-up, age-confirmed people; only H may found worlds ---------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f001', 'h@example.test'), ('00000000-0000-0000-0000-00000000f002', 'm@example.test'),
  ('00000000-0000-0000-0000-00000000f003', 'p@example.test'), ('00000000-0000-0000-0000-00000000f004', 'o@example.test');
insert into identity.profiles (user_id, display_name, can_found_worlds) values
  ('00000000-0000-0000-0000-00000000f001', 'H', true), ('00000000-0000-0000-0000-00000000f002', 'M', false),
  ('00000000-0000-0000-0000-00000000f003', 'P', false), ('00000000-0000-0000-0000-00000000f004', 'O', false);
insert into identity.profile_age (user_id, age_confirmed, age_confirmed_at, source_key)
  select user_id, true, now(), 'idp_attestation' from identity.profiles
  where user_id in ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002',
                    '00000000-0000-0000-0000-00000000f003', '00000000-0000-0000-0000-00000000f004');
insert into tx.ids values ('H', '00000000-0000-0000-0000-00000000f001'), ('M', '00000000-0000-0000-0000-00000000f002'),
  ('P', '00000000-0000-0000-0000-00000000f003'), ('O', '00000000-0000-0000-0000-00000000f004');

-- 1. a world and its roles ------------------------------------------------------------------------
select tx.act(tx.id('P'));
select throws_ok($$select world_lore.create_world('nope-world', 'Nope')$$, '42501', null, 'a player cannot found a world');
select tx.act(tx.id('H'));
insert into tx.ids select 'world', world_lore.create_world('flow-world', 'Flow');
insert into tx.ids select 'line', id from world_lore.world_lines where world_id = tx.id('world') and is_default;
select ok(membership.is_host(tx.id('world')), 'the founder is the host');
select membership.grant_role(tx.id('world'), tx.id('M'), 'moderator');
select membership.grant_role(tx.id('world'), tx.id('P'), 'player');
select throws_ok(format('select membership.grant_role(%L, %L, %L)', tx.id('world'), tx.id('O'), 'host'), '42501', null,
  'a host cannot grant the host role');
select tx.act(tx.id('P'));
select ok(membership.is_member(tx.id('world')), 'the player is a member');
select throws_ok(format('select membership.grant_role(%L, %L, %L)', tx.id('world'), tx.id('P'), 'moderator'), '42501', null,
  'a player cannot promote themselves');
select tx.act(tx.id('O'));
select ok(not membership.is_member(tx.id('world')), 'the outsider is not a member');
select is((select count(*) from world_lore.worlds)::int, 0, 'the outsider sees no world');

-- 2. lore: publish, and host-only secrets stay host-only ---------------------------------------------
select tx.act(tx.id('H'));
with c as (insert into world_lore.cards (world_id, kind, slug) values (tx.id('world'), 'place', 'harbor') returning id)
  insert into tx.ids select 'card', id from c;
insert into world_lore.card_drafts (line_id, card_id, world_id, title, body)
  values (tx.id('line'), tx.id('card'), tx.id('world'), 'Harbor', 'public text');
insert into world_lore.card_draft_secrets (line_id, card_id, world_id, position, body)
  values (tx.id('line'), tx.id('card'), tx.id('world'), 0, 'HOST-ONLY-MARKER');
select world_lore.set_line_ready(tx.id('line'), true);
insert into tx.ids select 'wv', world_lore.publish_world_line(tx.id('line'), 'first');
select is((select count(*) from world_lore.card_revision_secrets)::int, 1, 'the host reads the secret');

select tx.act(tx.id('P'));
select is((select count(*) from world_lore.v_card_current where card_id = tx.id('card'))::int, 1, 'the player reads the published card');
select is((select count(*) from world_lore.card_revision_secrets)::int, 0, 'the player cannot read secrets');
select is((select count(*) from world_lore.card_draft_secrets)::int, 0, 'the player cannot read draft secrets');
select is((select count(*) from world_lore.card_drafts)::int, 0, 'the player cannot read drafts');
select throws_ok(format('insert into world_lore.cards (world_id, kind, slug) values (%L, %L, %L)', tx.id('world'), 'x', 'sneaky'),
  '42501', null, 'the player cannot write cards');
select tx.act(tx.id('M'));
select is((select count(*) from world_lore.card_revision_secrets)::int, 0, 'the moderator cannot read secrets');
select is((select count(*) from world_lore.v_card_current where card_id = tx.id('card'))::int, 1, 'the moderator reads the published card');

reset role;     -- as the owner: the freeze trigger, not a missing grant, must be what stops it
select throws_like(format('update world_lore.world_versions set note = %L where id = %L', 'edit', tx.id('wv')),
  '%immutable%', 'a published version cannot change');
select tx.act(tx.id('H'));

-- 3. a story, its turns, moderation --------------------------------------------------------------------
insert into tx.ids select 'story', story_run.create_story(tx.id('wv'), 'Flow story');
select membership.seat_player(tx.id('story'), tx.id('P'));
select throws_ok(format('select membership.seat_player(%L, %L)', tx.id('story'), tx.id('O')), '23514', null, 'only a player of the world is seated');
update story_run.stories set status_key = 'running' where id = tx.id('story');
select throws_ok(format('update story_run.stories set status_key = %L where id = %L', 'preparing', tx.id('story')),
  '23514', null, 'a story cannot go backwards');
select story_run.record_host_event(tx.id('story'), 'plan', '{"note": "host only"}');
select throws_ok(format('select story_run.record_event(%L, %L, %L::jsonb)', tx.id('story'), 'note', '{"secret": 1}'), '22023', null,
  'an event cannot name a secret');
select throws_ok(format('select story_run.record_event(%L, %L, jsonb_build_object(%L, %L))', tx.id('story'), 'note', 'ref',
  (select card_revision_id from world_lore.card_revision_secrets limit 1)), '22023', null, 'an event cannot reference a revision that has secrets');
select story_run.record_event(tx.id('story'), 'note', '{"text": "the story begins"}');

select tx.act(tx.id('P'));
insert into story_run.turns (story_id, author_id, kind_key, body) values (tx.id('story'), tx.id('P'), 'player', 'hello');
select is((select count(*) from story_run.v_turn_feed where story_id = tx.id('story'))::int, 1, 'the player sees their turn');
select is((select seq from story_run.turns where story_id = tx.id('story')), 1::bigint, 'turns are numbered from 1');
select throws_ok(format('insert into story_run.turns (story_id, author_id, kind_key, body) values (%L, %L, %L, %L)',
  tx.id('story'), tx.id('H'), 'player', 'forged'), '42501', null, 'a turn cannot be written as someone else');
select throws_ok(format('insert into story_run.turns (story_id, author_id, kind_key, body) values (%L, %L, %L, %L)',
  tx.id('story'), tx.id('P'), 'host', 'forged'), '42501', null, 'a player cannot write a host turn');
select is((select count(*) from story_run.host_events)::int, 0, 'the player cannot read host events');
select is((select count(*) from story_run.events)::int, 1, 'the player reads the player-visible log');

select tx.act(tx.id('O'));
select is((select count(*) from story_run.turns)::int, 0, 'the outsider reads no turns');
select throws_ok(format('insert into story_run.turns (story_id, author_id, kind_key, body) values (%L, %L, %L, %L)',
  tx.id('story'), tx.id('O'), 'player', 'let me in'), '42501', null, 'the outsider cannot post');

select tx.act(tx.id('H'));
select is((select count(*) from story_run.host_events)::int, 1, 'the host reads host events');

select tx.act(tx.id('M'));
insert into tx.ids select 'hush', membership.hush_user(tx.id('world'), tx.id('story'), tx.id('P'), 'cool down');
select tx.act(tx.id('P'));
select throws_ok(format('insert into story_run.turns (story_id, author_id, kind_key, body) values (%L, %L, %L, %L)',
  tx.id('story'), tx.id('P'), 'player', 'while hushed'), '42501', null, 'a hushed player cannot post');
select tx.act(tx.id('M'));
select membership.lift_hush(tx.id('hush'), 'done');
insert into tx.ids select 'turn', id from story_run.turns where story_id = tx.id('story') limit 1;
select story_run.remove_turn(tx.id('turn'), 'test removal');
select tx.act(tx.id('P'));
select is((select count(*) from story_run.v_turn_feed where story_id = tx.id('story'))::int, 0, 'a removed turn leaves the feed');
select ok((select count(*) from membership.moderation_actions where target_user_id = tx.id('P')) >= 2, 'the player can read what was done to them');

-- 4. a chapter -----------------------------------------------------------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'chapter', reader.create_chapter(tx.id('line'), 'chapter-one', 'One');
insert into tx.ids select 'chapter2', reader.create_chapter(tx.id('line'), 'chapter-two', 'Two');
update reader.chapter_drafts set body = 'chapter text' where chapter_id = tx.id('chapter');
select reader.set_chapter_ready(tx.id('chapter'), true);
select reader.publish_chapter(tx.id('chapter'));
select tx.act(tx.id('P'));
select is((select count(*) from reader.v_chapter_current)::int, 1, 'the player reads the published chapter');
select is((select count(*) from reader.chapters)::int, 1, 'an unpublished chapter is invisible to the player');
select reader.save_progress(tx.id('chapter'), 42);
select is((select char_offset from reader.v_my_progress), 42, 'reading progress is saved');
select tx.act(tx.id('O'));
select throws_ok(format('select reader.save_progress(%L, 1)', tx.id('chapter')), '42501', null, 'the outsider cannot save progress');

-- 5. a visual novel and its template pins -------------------------------------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'vn', vn_content.create_vn(tx.id('wv'), 'flow-vn', 'Flow VN');
select is((select count(*) from platform.template_pins where scope_type = 'vn' and scope_id = tx.id('vn'))::int, 4,
  'a new VN is pinned to every template kind');
insert into tx.ids select 'route', vn_content.create_route(tx.id('vn'), 'common', 'common');
insert into tx.ids select 'scene', vn_content.create_scene(tx.id('route'), 'intro', 'Intro');
update vn_content.scene_drafts set lines = '[{"say": "hi"}]'::jsonb where scene_id = tx.id('scene');
select vn_content.set_vn_ready(tx.id('vn'), true);
select vn_content.publish_vn(tx.id('vn'));
select tx.act(tx.id('P'));
select is((select count(*) from vn_content.v_vn_script_current)::int, 1, 'the player reads the published script');
select is((select count(*) from platform.template_pins)::int, 0, 'the player sees no template pins');
select is((select count(*) from platform.templates)::int, 0, 'the player sees no templates');

-- 6. assets and jobs ----------------------------------------------------------------------------------
select tx.act(tx.id('H'));
insert into tx.ids select 'asset', assets.create_asset(tx.id('world'), null, 'sprite', 'hero');
insert into tx.ids select 'spec', assets.add_spec(tx.id('asset'), 'a figure', '', 1, 20, 7, 'euler', 'normal', 512, 768);
insert into tx.ids select 'job', generation.request_job(tx.id('asset'), tx.id('spec'), 'flow-test-key-1');
select is(generation.request_job(tx.id('asset'), tx.id('spec'), 'flow-test-key-1'), tx.id('job'), 'the same key returns the same job');
select is((select status_key from assets.assets where id = tx.id('asset')), 'generating', 'the asset is generating');
select throws_ok(format('select generation.start_job(%L)', tx.id('job')), '42501', null, 'a person cannot report job progress');
select tx.act(tx.id('P'));
select is((select count(*) from generation.jobs)::int, 0, 'the player sees no jobs');
select is((select count(*) from assets.assets)::int, 1, 'the player sees the asset');

select tx.act(null, 'service_role');
select generation.start_job(tx.id('job'), 'prompt-1');
select throws_ok(format('select assets.record_render(%L, %L, %L)', tx.id('asset'), tx.id('spec'), 'wrong-folder/x.png'), '23514', null,
  'a render must live under the world folder');
select assets.record_render(tx.id('asset'), tx.id('spec'), tx.id('world')::text || '/_shared/sprite/hero.png', tx.id('job'));
select generation.finish_job(tx.id('job'), true);
select generation.finish_job(tx.id('job'), true);
select tx.act(tx.id('H'));
select is((select status_key from generation.jobs where id = tx.id('job')), 'succeeded', 'the job succeeded');
select is((select status_key from assets.assets where id = tx.id('asset')), 'ready', 'the asset is ready');
select is((select count(*) from generation.job_status_history where entity_id = tx.id('job'))::int, 2, 'job history has two moves');
reset role;
select throws_like(format('update generation.jobs set status_key = %L where id = %L', 'queued', tx.id('job')),
  '%not allowed%', 'a finished job cannot be reopened');
select tx.act(tx.id('H'));

-- 7. templates: resolve, override, validate ----------------------------------------------------------
select is((select count(*) from platform.effective_template(tx.id('world'), null, 'workflow_sprite'))::int, 1, 'the host resolves the default');
select tx.act(tx.id('O'));
select is((select count(*) from platform.effective_template(tx.id('world'), null, 'workflow_sprite'))::int, 0, 'the outsider resolves nothing');
select tx.act(tx.id('H'));
insert into tx.ids select 'tpl', platform.create_template_override('workflow_sprite', tx.id('world'));
update platform.template_drafts set body = jsonb_set(body, '{1,class_type}', '"NotAllowedNode"') where template_id = tx.id('tpl');
select platform.set_template_ready(tx.id('tpl'), true);
select throws_ok(format('select platform.publish_template(%L)', tx.id('tpl')), '22023', null, 'a disallowed node cannot be published');
update platform.template_drafts set body = jsonb_set(jsonb_set(body, '{1,class_type}', '"CheckpointLoaderSimple"'),
  '{1,inputs,ckpt_name}', '"http://example.test/model"') where template_id = tx.id('tpl');
select platform.set_template_ready(tx.id('tpl'), true);
select throws_ok(format('select platform.publish_template(%L)', tx.id('tpl')), '22023', null, 'a web address in a graph is refused');
update platform.template_drafts set body = jsonb_set(body, '{1,inputs,ckpt_name}', '"{{checkpoint}}"') where template_id = tx.id('tpl');
select platform.set_template_ready(tx.id('tpl'), true);
insert into tx.ids select 'tplv', platform.publish_template(tx.id('tpl'));
select is((select resolved_scope from platform.effective_template(tx.id('world'), null, 'workflow_sprite')), 'world',
  'the world override now wins');
reset role;
select throws_like(format('update platform.template_versions set note = %L where id = %L', 'x', tx.id('tplv')),
  '%immutable%', 'a template version cannot change');

-- 8. files and channels -----------------------------------------------------------------------------------
select tx.act(tx.id('P'));
select ok(membership.can_read_path(tx.id('world')::text || '/_shared/sprite/hero.png'), 'a member can read a world file');
select ok(not membership.can_write_path(tx.id('world')::text || '/_shared/sprite/hero.png'), 'a member cannot write a world file');
select ok(not membership.can_read_path('not-a-uuid/x.png'), 'a malformed path is refused');
select ok(membership.can_listen_topic('world:' || tx.id('world')::text), 'a member listens to the world channel');
select ok(membership.can_listen_topic('story:' || tx.id('story')::text), 'a seated player listens to the story channel');
select ok(not membership.can_listen_topic('job:' || tx.id('job')::text), 'a player does not listen to a job channel');
select ok(not membership.can_listen_topic('bogus'), 'an unknown topic is refused');
select tx.act(tx.id('M'));
select ok(membership.can_listen_topic('job:' || tx.id('job')::text), 'a moderator listens to a job channel');
select tx.act(tx.id('O'));
select ok(not membership.can_read_path(tx.id('world')::text || '/_shared/sprite/hero.png'), 'the outsider cannot read a world file');
select ok(not membership.can_listen_topic('world:' || tx.id('world')::text), 'the outsider does not listen to the world channel');

-- 9. anonymous callers get nothing ------------------------------------------------------------------------
select tx.act(null, 'anon');
select throws_ok('select * from world_lore.worlds', '42501', null, 'anon cannot read worlds');
select throws_ok('select * from story_run.turns', '42501', null, 'anon cannot read turns');
select throws_ok('select membership.is_host(gen_random_uuid())', '42501', null, 'anon cannot call helpers');

reset role;
create temp table _fails as select numb, descr, reason from __tresults__ where not aok;   -- finish() drops the results
select * from finish();
-- the editor shows the last result: list what failed
select coalesce(string_agg(numb || ': ' || descr || coalesce('  -- ' || nullif(reason, ''), ''), chr(10) order by numb), 'all passed') as failures
  from _fails;
rollback;
