-- 010 assets: asset records, immutable prompt specs, renders (a row with archived_at set is a dataset
-- entry), per-tag feedback, the asset status machine. Files live in Storage; rows hold paths only.
-- Content-neutral. vn_id, job_id and workflow_template_version_id are soft references.

-- ---------------------------------------------------------------------------------------------
-- lookups and the status machine
-- ---------------------------------------------------------------------------------------------
create table assets.asset_kinds (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into assets.asset_kinds (key, label, sort_order) values
  ('sprite', 'Sprite', 10), ('cg', 'CG', 20), ('bg', 'Background', 30);
select platform.open_lookup('assets.asset_kinds');

create table assets.feedback_choices (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into assets.feedback_choices (key, label, sort_order) values
  ('better', 'Better', 10), ('keep', 'Keep', 20), ('worse', 'Worse', 30);
select platform.open_lookup('assets.feedback_choices');

create table assets.asset_statuses (
  key         text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  sort_order  int not null unique,
  created_at  timestamptz not null default now()
);
create table assets.asset_transitions (
  from_key text not null references assets.asset_statuses (key),
  to_key   text not null references assets.asset_statuses (key),
  actor    text not null check (actor in ('system', 'host', 'moderator', 'player')),
  primary key (from_key, to_key, actor)
);
create table assets.asset_status_history (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id    uuid not null,
  from_key     text,
  to_key       text not null references assets.asset_statuses (key),
  actor_id     uuid,
  reason       text,
  at           timestamptz not null default now()
);
create index asset_history_entity on assets.asset_status_history (entity_id, at desc);
create trigger asset_history_append_only before update or delete on assets.asset_status_history
  for each row execute function platform.forbid_change();

insert into assets.asset_statuses (key, label, is_terminal, sort_order) values
  ('planned',    'Planned',    false, 10),
  ('generating', 'Generating', false, 20),
  ('ready',      'Ready',      false, 30),
  ('retired',    'Retired',    true,  40);
insert into assets.asset_transitions (from_key, to_key, actor) values
  ('planned',    'generating', 'host'),
  ('planned',    'generating', 'system'),
  ('generating', 'ready',      'system'),
  ('generating', 'planned',    'system'),      -- the job failed or was cancelled
  ('planned',    'ready',      'system'),      -- a render recorded without a job
  ('ready',      'generating', 'host'),
  ('ready',      'generating', 'system'),
  ('planned',    'retired',    'host'),
  ('ready',      'retired',    'host');
select platform.open_lookup('assets.asset_statuses');
select platform.open_lookup('assets.asset_transitions');

-- ---------------------------------------------------------------------------------------------
-- assets, specs, renders, feedback
-- ---------------------------------------------------------------------------------------------
create table assets.assets (
  id                uuid primary key default gen_random_uuid(),
  world_id          uuid not null,                        -- soft reference: world_lore.worlds
  vn_id             uuid,                                 -- soft reference: vn_content.vns; null = the world's shared pool
  kind_key          text not null references assets.asset_kinds (key),
  name              text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$'),
  status_key        text not null default 'planned' references assets.asset_statuses (key),
  is_terminal       boolean not null default false,
  current_spec_id   uuid,                                 -- fk added below
  current_render_id uuid,
  created_by        uuid not null references identity.profiles (user_id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, world_id)
);
create unique index assets_vn_name on assets.assets (vn_id, kind_key, name) where vn_id is not null;
create unique index assets_shared_name on assets.assets (world_id, kind_key, name) where vn_id is null;
create index assets_world on assets.assets (world_id, kind_key) where not is_terminal;

create trigger assets_touch before update on assets.assets
  for each row execute function platform.touch();
create trigger assets_initial before insert on assets.assets
  for each row execute function platform.enforce_initial_status('assets', 'asset');
create trigger assets_transition before update of status_key on assets.assets
  for each row execute function platform.enforce_transition('assets', 'asset');

create function assets.guard_asset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.world_id is distinct from old.world_id or new.vn_id is distinct from old.vn_id
     or new.kind_key is distinct from old.kind_key or new.created_by is distinct from old.created_by then
    raise exception 'an asset keeps its world, pool, kind and creator' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger assets_guard before update on assets.assets
  for each row execute function assets.guard_asset();

-- the prompt record of one generation attempt: immutable; sampler settings are columns because the
-- dataset compares them
create table assets.asset_specs (
  id                          uuid primary key default gen_random_uuid(),
  asset_id                    uuid not null,
  world_id                    uuid not null,
  spec_no                     int not null check (spec_no > 0),
  positive                    text not null check (char_length(positive) <= 8000),
  negative                    text not null default '' check (char_length(negative) <= 8000),
  seed                        bigint not null,
  steps                       int not null check (steps between 1 and 150),
  cfg                         numeric(5, 2) not null check (cfg between 0 and 30),
  sampler                     text not null check (char_length(sampler) between 1 and 60),
  scheduler                   text not null check (char_length(scheduler) between 1 and 60),
  width                       int not null check (width between 64 and 4096),
  height                      int not null check (height between 64 and 4096),
  workflow_template_version_id uuid,                      -- soft reference: platform.template_versions
  created_by                  uuid references identity.profiles (user_id) on delete restrict,
  created_at                  timestamptz not null default now(),
  unique (asset_id, spec_no),
  unique (id, asset_id),
  foreign key (asset_id, world_id) references assets.assets (id, world_id) on delete restrict
);
create trigger asset_specs_immutable before update or delete on assets.asset_specs
  for each row execute function platform.forbid_change();

create table assets.renders (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null,
  world_id     uuid not null,
  spec_id      uuid not null,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]{1,250}$' and storage_path not like '%..%'),
  job_id       uuid,                                      -- soft reference: generation.jobs
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  archived_by  uuid references identity.profiles (user_id) on delete restrict,
  unique (id, asset_id),
  unique (id, world_id),
  check ((archived_at is null) = (archived_by is null)),
  foreign key (asset_id, world_id) references assets.assets (id, world_id) on delete restrict,
  foreign key (spec_id, asset_id) references assets.asset_specs (id, asset_id) on delete restrict
);
create index renders_asset on assets.renders (asset_id, created_at desc, id);
create index renders_dataset on assets.renders (asset_id, created_at desc, id) where archived_at is not null;

-- a render is a record of a file: only the archive flag may change, and it can be set and cleared
create function assets.guard_render() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - 'archived_at' - 'archived_by') is distinct from (to_jsonb(old) - 'archived_at' - 'archived_by') then
    raise exception 'a render is immutable apart from its archive flag' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger renders_guard before update or delete on assets.renders
  for each row execute function assets.guard_render();

alter table assets.assets
  add constraint assets_current_spec_fk foreign key (current_spec_id, id) references assets.asset_specs (id, asset_id) on delete restrict,
  add constraint assets_current_render_fk foreign key (current_render_id, id) references assets.renders (id, asset_id) on delete restrict;

create table assets.render_feedback (
  render_id  uuid not null,
  world_id   uuid not null,
  tag        text not null check (tag ~ '^[a-z0-9][a-z0-9_ -]{0,59}$'),
  choice_key text not null references assets.feedback_choices (key),
  created_by uuid not null references identity.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (render_id, tag),
  foreign key (render_id, world_id) references assets.renders (id, world_id) on delete cascade
);
create index feedback_tag on assets.render_feedback (tag, choice_key);

-- ---------------------------------------------------------------------------------------------
-- functions (the server logs in as app_rw with no role set; people act as authenticated)
-- ---------------------------------------------------------------------------------------------
create function assets.create_asset(p_world uuid, p_vn uuid, p_kind text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select platform.uid());
  v_id  uuid;
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if p_vn is not null and not exists (select 1 from vn_content.vns where id = p_vn and world_id = p_world) then
    raise exception 'that visual novel is not in this world' using errcode = '23514';
  end if;
  insert into assets.assets (world_id, vn_id, kind_key, name, created_by)
    values (p_world, p_vn, p_kind, p_name, v_uid) returning id into v_id;
  perform platform.write_audit(v_uid, p_world, 'asset_create', 'asset', v_id,
    jsonb_build_object('kind', p_kind, 'vn_id', p_vn));
  return v_id;
end $$;

create function assets.add_spec(
  p_asset uuid, p_positive text, p_negative text, p_seed bigint, p_steps int, p_cfg numeric,
  p_sampler text, p_scheduler text, p_width int, p_height int, p_template_version uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_a    record;
  v_no   int;
  v_id   uuid;
  v_tpl  text;
begin
  select * into v_a from assets.assets where id = p_asset for update;
  if not found or not (select membership.is_host(v_a.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_a.is_terminal then
    raise exception 'the asset is retired' using errcode = '23514';
  end if;
  if p_template_version is not null then
    select kind_key into v_tpl from platform.template_versions where id = p_template_version;
    if v_tpl is distinct from 'workflow_' || v_a.kind_key then
      raise exception 'that template is not a % workflow', v_a.kind_key using errcode = '23514';
    end if;
  end if;
  select coalesce(max(spec_no), 0) + 1 into v_no from assets.asset_specs where asset_id = p_asset;
  insert into assets.asset_specs (asset_id, world_id, spec_no, positive, negative, seed, steps, cfg, sampler,
                                  scheduler, width, height, workflow_template_version_id, created_by)
    values (p_asset, v_a.world_id, v_no, p_positive, coalesce(p_negative, ''), p_seed, p_steps, p_cfg, p_sampler,
            p_scheduler, p_width, p_height, p_template_version, (select platform.uid()))
    returning id into v_id;
  update assets.assets set current_spec_id = v_id where id = p_asset;
  return v_id;
end $$;

-- records a finished file. The generation worker (server) or the host (a manual import) calls it.
create function assets.record_render(p_asset uuid, p_spec uuid, p_path text, p_job uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_a  record;
  v_id uuid;
begin
  select * into v_a from assets.assets where id = p_asset for update;
  if not found then
    raise exception 'unknown asset' using errcode = '23503';
  end if;
  if not ((select platform.is_server()) or (select membership.is_host(v_a.world_id))) then
    raise exception 'server or host only' using errcode = '42501';
  end if;
  if v_a.is_terminal then
    raise exception 'the asset is retired' using errcode = '23514';
  end if;
  if p_path not like v_a.world_id::text || '/%' then
    raise exception 'the file must live under the world folder' using errcode = '23514';
  end if;
  insert into assets.renders (asset_id, world_id, spec_id, storage_path, job_id)
    values (p_asset, v_a.world_id, p_spec, p_path, p_job) returning id into v_id;
  perform platform.mark_system();
  update assets.assets set current_render_id = v_id,
         status_key = case when status_key in ('planned', 'generating') then 'ready' else status_key end
   where id = p_asset;
  perform platform.clear_actor();
  perform platform.emit('asset.rendered', v_id, jsonb_build_object('asset', p_asset, 'render', v_id), 'render:' || v_id::text);
  return v_id;
end $$;

create function assets.set_current_render(p_asset uuid, p_render uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from assets.assets where id = p_asset for update;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if not exists (select 1 from assets.renders where id = p_render and asset_id = p_asset) then
    raise exception 'not a render of this asset' using errcode = '23514';
  end if;
  update assets.assets set current_render_id = p_render where id = p_asset;
end $$;

create function assets.retire_asset(p_asset uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from assets.assets where id = p_asset;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update assets.assets set status_key = 'retired' where id = p_asset;        -- the transition trigger checks the move
  perform platform.write_audit((select platform.uid()), v_world, 'asset_retire', 'asset', p_asset);
end $$;

-- puts a render into (or takes it out of) the dataset
create function assets.archive_render(p_render uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from assets.renders where id = p_render;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update assets.renders
     set archived_at = case when p_archive then coalesce(archived_at, now()) end,
         archived_by = case when p_archive then coalesce(archived_by, (select platform.uid())) end
   where id = p_render;
end $$;

create function assets.set_feedback(p_render uuid, p_tag text, p_choice text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from assets.renders where id = p_render;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  insert into assets.render_feedback (render_id, world_id, tag, choice_key, created_by)
    values (p_render, v_world, p_tag, p_choice, (select platform.uid()))
    on conflict (render_id, tag) do update set choice_key = excluded.choice_key, created_by = excluded.created_by;
end $$;

create function assets.remove_feedback(p_render uuid, p_tag text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from assets.renders where id = p_render;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  delete from assets.render_feedback where render_id = p_render and tag = p_tag;
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security: members read; moderators and the host read feedback; writes go through functions
-- ---------------------------------------------------------------------------------------------
alter table assets.assets               enable row level security;
alter table assets.asset_status_history enable row level security;
alter table assets.asset_specs          enable row level security;
alter table assets.renders              enable row level security;
alter table assets.render_feedback      enable row level security;

create policy assets_read on assets.assets for select to authenticated
  using ((select membership.is_member(world_id)));
create policy assets_rename_host on assets.assets for update to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));
create policy asset_history_read on assets.asset_status_history for select to authenticated
  using (exists (select 1 from assets.assets a where a.id = entity_id and (select membership.is_staff(a.world_id))));
create policy specs_read on assets.asset_specs for select to authenticated
  using ((select membership.is_member(world_id)));
create policy renders_read on assets.renders for select to authenticated
  using ((select membership.is_member(world_id)));
create policy feedback_read_staff on assets.render_feedback for select to authenticated
  using ((select membership.is_staff(world_id)));

revoke all on assets.assets, assets.asset_status_history, assets.asset_specs, assets.renders,
  assets.render_feedback from public, anon, authenticated;
grant select on assets.assets, assets.asset_status_history, assets.asset_specs, assets.renders,
  assets.render_feedback to authenticated, app_ro, app_rw;
grant update (name) on assets.assets to authenticated, app_rw;

-- ---------------------------------------------------------------------------------------------
-- views
-- ---------------------------------------------------------------------------------------------
create view assets.v_asset_list with (security_invoker = true) as
select a.id as asset_id, a.world_id, a.vn_id, a.kind_key, a.name, a.status_key, s.label as status_label,
       a.current_spec_id, a.current_render_id, r.storage_path as current_path, a.updated_at
from assets.assets a
join assets.asset_statuses s on s.key = a.status_key
left join assets.renders r on r.id = a.current_render_id;

-- the dataset gallery: archived renders with the settings that made them and their feedback tags
create view assets.v_dataset_runs with (security_invoker = true) as
select r.id as render_id, r.asset_id, r.world_id, r.storage_path, r.archived_at, r.created_at,
       sp.spec_no, sp.positive, sp.negative, sp.seed, sp.steps, sp.cfg, sp.sampler, sp.scheduler,
       sp.width, sp.height,
       (select coalesce(jsonb_object_agg(f.tag, f.choice_key), '{}'::jsonb)
          from assets.render_feedback f where f.render_id = r.id) as feedback
from assets.renders r
join assets.asset_specs sp on sp.id = r.spec_id
where r.archived_at is not null;

grant select on assets.v_asset_list, assets.v_dataset_runs to authenticated, app_ro, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema assets from public, anon;
grant execute on function
  assets.create_asset(uuid, uuid, text, text),
  assets.add_spec(uuid, text, text, bigint, int, numeric, text, text, int, int, uuid),
  assets.record_render(uuid, uuid, text, uuid), assets.set_current_render(uuid, uuid),
  assets.retire_asset(uuid), assets.archive_render(uuid, boolean),
  assets.set_feedback(uuid, text, text), assets.remove_feedback(uuid, text)
  to authenticated, app_rw;
-- guard_asset and guard_render are trigger functions: granted to no one
