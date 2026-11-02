-- 011 generation: a generation request is a followable job. Idempotent per requester, pinned to the exact
-- workflow version it ran, with a status machine, stages and node states. The external generation server
-- is driven from the outbox and reports back through the server-only functions below.
-- Content-neutral. asset_id, spec_id and vn_id are soft references.

-- ---------------------------------------------------------------------------------------------
-- lookups and the job status machine
-- ---------------------------------------------------------------------------------------------
create table generation.stage_keys (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into generation.stage_keys (key, label, sort_order) values
  ('prepare', 'Prepare', 10), ('queue', 'Queue', 20), ('render', 'Render', 30), ('save', 'Save', 40);
select platform.open_lookup('generation.stage_keys');

create table generation.stage_states (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into generation.stage_states (key, label, sort_order) values
  ('pending', 'Pending', 10), ('active', 'Active', 20), ('done', 'Done', 30), ('failed', 'Failed', 40);
select platform.open_lookup('generation.stage_states');

create table generation.node_states (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into generation.node_states (key, label, sort_order) values
  ('pending', 'Pending', 10), ('active', 'Active', 20), ('done', 'Done', 30), ('cached', 'Cached', 40);
select platform.open_lookup('generation.node_states');

create table generation.job_statuses (
  key         text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  sort_order  int not null unique,
  created_at  timestamptz not null default now()
);
create table generation.job_transitions (
  from_key text not null references generation.job_statuses (key),
  to_key   text not null references generation.job_statuses (key),
  actor    text not null check (actor in ('system', 'host', 'moderator', 'player')),
  primary key (from_key, to_key, actor)
);
create table generation.job_status_history (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id    uuid not null,
  from_key     text,
  to_key       text not null references generation.job_statuses (key),
  actor_id     uuid,
  reason       text,
  at           timestamptz not null default now()
);
create index job_history_entity on generation.job_status_history (entity_id, at desc);
create trigger job_history_append_only before update or delete on generation.job_status_history
  for each row execute function platform.forbid_change();

insert into generation.job_statuses (key, label, is_terminal, sort_order) values
  ('queued',    'Queued',    false, 10),
  ('running',   'Running',   false, 20),
  ('succeeded', 'Succeeded', true,  30),
  ('failed',    'Failed',    true,  40),
  ('cancelled', 'Cancelled', true,  50);
insert into generation.job_transitions (from_key, to_key, actor) values
  ('queued',  'running',   'system'),
  ('queued',  'failed',    'system'),
  ('queued',  'cancelled', 'host'),
  ('queued',  'cancelled', 'system'),
  ('running', 'succeeded', 'system'),
  ('running', 'failed',    'system'),
  ('running', 'cancelled', 'host'),
  ('running', 'cancelled', 'system');
select platform.open_lookup('generation.job_statuses');
select platform.open_lookup('generation.job_transitions');

-- ---------------------------------------------------------------------------------------------
-- jobs, stages, nodes
-- ---------------------------------------------------------------------------------------------
create table generation.jobs (
  id                           uuid primary key default gen_random_uuid(),
  world_id                     uuid not null,
  vn_id                        uuid,
  asset_id                     uuid not null,
  spec_id                      uuid not null,
  requested_by                 uuid not null references identity.profiles (user_id) on delete restrict,
  idempotency_key              text not null check (char_length(idempotency_key) between 8 and 120),
  workflow_template_version_id uuid not null references platform.template_versions (id) on delete restrict,
  status_key                   text not null default 'queued' references generation.job_statuses (key),
  is_terminal                  boolean not null default false,
  comfy_prompt_id              text check (char_length(comfy_prompt_id) <= 120),
  queue_position               int check (queue_position >= 0),
  error_code                   text check (error_code ~ '^[a-z][a-z0-9_.]{0,63}$'),
  started_at                   timestamptz,
  finished_at                  timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (requested_by, idempotency_key),
  unique (id, world_id)
);
create index jobs_active on generation.jobs (world_id, created_at desc) where not is_terminal;
create index jobs_asset on generation.jobs (asset_id, created_at desc);

create trigger jobs_touch before update on generation.jobs
  for each row execute function platform.touch();
create trigger jobs_initial before insert on generation.jobs
  for each row execute function platform.enforce_initial_status('generation', 'job');
create trigger jobs_transition before update of status_key on generation.jobs
  for each row execute function platform.enforce_transition('generation', 'job');

-- who asked, what for and which graph never change
create function generation.guard_job() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.world_id is distinct from old.world_id or new.asset_id is distinct from old.asset_id
     or new.spec_id is distinct from old.spec_id or new.requested_by is distinct from old.requested_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.workflow_template_version_id is distinct from old.workflow_template_version_id then
    raise exception 'a job keeps its request' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger jobs_guard before update on generation.jobs
  for each row execute function generation.guard_job();

create table generation.job_stages (
  job_id      uuid not null,
  world_id    uuid not null,
  stage_key   text not null references generation.stage_keys (key),
  state_key   text not null default 'pending' references generation.stage_states (key),
  started_at  timestamptz,
  finished_at timestamptz,
  primary key (job_id, stage_key),
  foreign key (job_id, world_id) references generation.jobs (id, world_id) on delete cascade
);

create table generation.job_nodes (
  job_id    uuid not null,
  world_id  uuid not null,
  node_id   text not null check (char_length(node_id) between 1 and 64),
  title     text not null default '' check (char_length(title) <= 120),
  state_key text not null default 'pending' references generation.node_states (key),
  primary key (job_id, node_id),
  foreign key (job_id, world_id) references generation.jobs (id, world_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- people: ask for a job, cancel a job
-- ---------------------------------------------------------------------------------------------
-- idempotent: the same requester and key return the same job
create function generation.request_job(p_asset uuid, p_spec uuid, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_a     record;
  v_spec  record;
  v_tpl   uuid;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;
  select id into v_id from generation.jobs where requested_by = v_uid and idempotency_key = p_key;
  if v_id is not null then
    return v_id;
  end if;

  select * into v_a from assets.assets where id = p_asset for update;
  if not found or not (select membership.is_host(v_a.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_a.is_terminal then
    raise exception 'the asset is retired' using errcode = '23514';
  end if;
  select * into v_spec from assets.asset_specs where id = p_spec and asset_id = p_asset;
  if not found then
    raise exception 'not a spec of this asset' using errcode = '23514';
  end if;

  v_tpl := v_spec.workflow_template_version_id;
  if v_tpl is null then
    select e.template_version_id into v_tpl
      from platform.effective_template(v_a.world_id, v_a.vn_id, 'workflow_' || v_a.kind_key) e;
  end if;
  if v_tpl is null then
    raise exception 'there is no workflow template for this kind yet' using errcode = '23514';
  end if;

  insert into generation.jobs (world_id, vn_id, asset_id, spec_id, requested_by, idempotency_key, workflow_template_version_id)
    values (v_a.world_id, v_a.vn_id, p_asset, p_spec, v_uid, p_key, v_tpl)
    returning id into v_id;
  insert into generation.job_stages (job_id, world_id, stage_key)
    select v_id, v_a.world_id, key from generation.stage_keys;

  update assets.assets set status_key = 'generating' where id = p_asset and status_key in ('planned', 'ready');
  perform platform.write_audit(v_uid, v_a.world_id, 'generate', 'job', v_id,
    jsonb_build_object('asset', p_asset, 'spec', p_spec, 'template_version', v_tpl));
  perform platform.emit('generation.requested', v_id,
    jsonb_build_object('job', v_id, 'asset', p_asset, 'spec', p_spec, 'template_version', v_tpl),
    'job:' || v_id::text);
  return v_id;
end $$;

create function generation.cancel_job(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
begin
  select * into v_job from generation.jobs where id = p_job for update;
  if not found or not (select membership.is_host(v_job.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_job.is_terminal then
    raise exception 'the job has already finished' using errcode = '23514';
  end if;
  update generation.jobs set status_key = 'cancelled', finished_at = now() where id = p_job;   -- host move, checked by the trigger
  perform generation.release_asset(v_job.asset_id);
  perform platform.write_audit((select platform.uid()), v_job.world_id, 'generate_cancel', 'job', p_job);
  perform platform.emit('generation.cancelled', p_job, jsonb_build_object('job', p_job, 'prompt', v_job.comfy_prompt_id),
    'jobcancel:' || p_job::text);
end $$;

-- an asset goes back to planned when its last open job ends without a render
create function generation.release_asset(p_asset uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from generation.jobs where asset_id = p_asset and not is_terminal) then
    return;
  end if;
  perform platform.mark_system();
  update assets.assets set status_key = 'planned' where id = p_asset and status_key = 'generating';
  perform platform.clear_actor();
end $$;

-- ---------------------------------------------------------------------------------------------
-- the generation server: login app_rw with no role set, or service_role. People cannot call these.
-- ---------------------------------------------------------------------------------------------
create function generation.start_job(p_job uuid, p_prompt_id text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  perform platform.mark_system();
  update generation.jobs set status_key = 'running', started_at = now(), comfy_prompt_id = p_prompt_id, queue_position = null
   where id = p_job and status_key = 'queued';
  get diagnostics v_n = row_count;
  perform platform.clear_actor();
  if v_n = 0 then
    raise exception 'the job is not queued' using errcode = '23514';
  end if;
end $$;

create function generation.set_stage(p_job uuid, p_stage text, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  update generation.job_stages
     set state_key = p_state,
         started_at = case when p_state = 'active' then coalesce(started_at, now()) else started_at end,
         finished_at = case when p_state in ('done', 'failed') then now() else null end
   where job_id = p_job and stage_key = p_stage;
  if not found then
    raise exception 'unknown job or stage' using errcode = '23503';
  end if;
end $$;

-- p_nodes: [{"id": "...", "title": "...", "state": "pending|active|done|cached"}, ...]
create function generation.set_nodes(p_job uuid, p_nodes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_nodes) is distinct from 'array' or jsonb_array_length(p_nodes) > 200 then
    raise exception 'nodes must be an array of at most 200' using errcode = '22023';
  end if;
  select world_id into v_world from generation.jobs where id = p_job;
  if v_world is null then
    raise exception 'unknown job' using errcode = '23503';
  end if;
  insert into generation.job_nodes (job_id, world_id, node_id, title, state_key)
    select p_job, v_world, e ->> 'id', coalesce(e ->> 'title', ''), coalesce(e ->> 'state', 'pending')
    from jsonb_array_elements(p_nodes) e
    on conflict (job_id, node_id) do update set title = excluded.title, state_key = excluded.state_key;
end $$;

create function generation.set_queue_position(p_job uuid, p_position int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  update generation.jobs set queue_position = p_position where id = p_job and status_key = 'queued';
end $$;

-- call assets.record_render first, then this
create function generation.finish_job(p_job uuid, p_ok boolean, p_error_code text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job record;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  select * into v_job from generation.jobs where id = p_job for update;
  if not found then
    raise exception 'unknown job' using errcode = '23503';
  end if;
  if v_job.is_terminal then
    return;                                            -- a repeated report changes nothing
  end if;
  perform platform.mark_system();
  update generation.jobs
     set status_key = case when p_ok then 'succeeded' else 'failed' end,
         error_code = case when p_ok then null else coalesce(p_error_code, 'failed') end,
         finished_at = now(), queue_position = null
   where id = p_job;
  perform platform.clear_actor();
  perform generation.release_asset(v_job.asset_id);
  perform platform.emit('generation.finished', p_job, jsonb_build_object('job', p_job, 'ok', p_ok),
    'jobdone:' || p_job::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security: the host and moderators read; nothing is written directly
-- ---------------------------------------------------------------------------------------------
alter table generation.jobs               enable row level security;
alter table generation.job_status_history enable row level security;
alter table generation.job_stages         enable row level security;
alter table generation.job_nodes          enable row level security;

create policy jobs_read on generation.jobs for select to authenticated
  using ((select membership.is_staff(world_id)));
create policy job_history_read on generation.job_status_history for select to authenticated
  using (exists (select 1 from generation.jobs j where j.id = entity_id and (select membership.is_staff(j.world_id))));
create policy job_stages_read on generation.job_stages for select to authenticated
  using ((select membership.is_staff(world_id)));
create policy job_nodes_read on generation.job_nodes for select to authenticated
  using ((select membership.is_staff(world_id)));

revoke all on generation.jobs, generation.job_status_history, generation.job_stages, generation.job_nodes
  from public, anon, authenticated;
grant select on generation.jobs, generation.job_status_history, generation.job_stages, generation.job_nodes
  to authenticated, app_ro, app_rw;

-- the server logins have no JWT: let them read jobs to work the queue
create policy jobs_read_server on generation.jobs for select to app_rw, app_ro using (true);
create policy job_stages_read_server on generation.job_stages for select to app_rw, app_ro using (true);
create policy job_nodes_read_server on generation.job_nodes for select to app_rw, app_ro using (true);

-- ---------------------------------------------------------------------------------------------
-- view
-- ---------------------------------------------------------------------------------------------
create view generation.v_job_list with (security_invoker = true) as
select j.id as job_id, j.world_id, j.vn_id, j.asset_id, j.requested_by, j.status_key, s.label as status_label,
       j.queue_position, j.error_code, j.created_at, j.started_at, j.finished_at,
       (select jsonb_object_agg(st.stage_key, st.state_key) from generation.job_stages st where st.job_id = j.id) as stages
from generation.jobs j
join generation.job_statuses s on s.key = j.status_key;

grant select on generation.v_job_list to authenticated, app_ro, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema generation from public, anon;
grant execute on function generation.request_job(uuid, uuid, text), generation.cancel_job(uuid)
  to authenticated, app_rw;
grant execute on function
  generation.start_job(uuid, text), generation.set_stage(uuid, text, text), generation.set_nodes(uuid, jsonb),
  generation.set_queue_position(uuid, int), generation.finish_job(uuid, boolean, text)
  to app_rw, service_role;
-- release_asset and guard_job are internal / trigger functions: granted to no one
