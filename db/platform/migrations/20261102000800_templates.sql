-- 008 platform templates: workflow and VN templates with a platform default, per-world and per-VN
-- overrides, immutable versions, pins, and the resolver. Same draft / publish pattern as lore.
-- Content-neutral: this file ships the structure and the node allow-list; default graphs are seeded later.
-- scope_id is a soft reference (a world or a VN); world_id is the owning world for any non-platform scope.

-- ---------------------------------------------------------------------------------------------
-- kinds and the node allow-list
-- ---------------------------------------------------------------------------------------------
create table platform.template_kinds (
  key        text primary key,
  label      text not null,
  body_kind  text not null check (body_kind in ('comfy_graph', 'vn_skeleton')),
  max_bytes  int not null check (max_bytes > 0),
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into platform.template_kinds (key, label, body_kind, max_bytes, sort_order) values
  ('workflow_sprite', 'Sprite workflow',     'comfy_graph', 262144, 10),
  ('workflow_cg',     'CG workflow',         'comfy_graph', 262144, 20),
  ('workflow_bg',     'Background workflow', 'comfy_graph', 262144, 30),
  ('vn',              'Visual novel',        'vn_skeleton', 262144, 40);

-- the graph node classes a workflow template may use; extended by migration, never by a host
create table platform.allowed_node_types (
  class_type text primary key,
  kind_keys  text[] not null,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
insert into platform.allowed_node_types (class_type, kind_keys) values
  ('CheckpointLoaderSimple', array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('VAELoader',              array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('LoraLoader',             array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('CLIPTextEncode',         array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('EmptyLatentImage',       array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('KSampler',               array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('VAEDecode',              array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('SaveImage',              array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('LoadImage',              array['workflow_sprite', 'workflow_cg', 'workflow_bg']),
  ('ImageScale',             array['workflow_sprite', 'workflow_cg', 'workflow_bg']);

-- ---------------------------------------------------------------------------------------------
-- templates, drafts, versions, pins
-- ---------------------------------------------------------------------------------------------
create table platform.templates (
  id                 uuid primary key default gen_random_uuid(),
  kind_key           text not null references platform.template_kinds (key),
  scope_type         text not null check (scope_type in ('platform', 'world', 'vn')),
  scope_id           uuid,                                   -- soft reference: world or VN; null for platform
  world_id           uuid,                                   -- the owning world; null for platform
  scope_key          uuid generated always as (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  base_version_id    uuid,                                   -- what an override was derived from; fk added below
  head_version_id    uuid,                                   -- fk added below
  publish_status_key text not null default 'draft' references platform.publish_statuses (key),
  created_by         uuid references identity.profiles (user_id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((scope_type = 'platform') = (scope_id is null and world_id is null)),
  check (scope_type <> 'world' or scope_id = world_id),
  check (scope_type <> 'vn' or (scope_id is not null and world_id is not null)),
  unique (kind_key, scope_type, scope_key),
  unique (id, world_id),
  unique (id, kind_key)
);
create trigger templates_touch before update on platform.templates
  for each row execute function platform.touch();
create trigger templates_initial before insert on platform.templates
  for each row execute function platform.enforce_initial_status('platform', 'publish', 'publish_status_key');
create trigger templates_transition before update of publish_status_key on platform.templates
  for each row execute function platform.enforce_transition('platform', 'publish', 'publish_status_key');

create table platform.template_versions (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null,
  kind_key       text not null,
  version_no     int not null check (version_no > 0),
  body           jsonb not null,
  param_map      jsonb not null default '{}'::jsonb,
  schema_version int not null default 1,
  checksum       text not null,
  note           text,
  published_by   uuid references identity.profiles (user_id) on delete restrict,   -- null for versions shipped by a migration
  published_at   timestamptz not null default now(),
  status_key     text not null default 'published' references platform.publish_statuses (key)
                 check (status_key in ('published', 'retracted')),
  unique (template_id, version_no),
  unique (id, kind_key),
  foreign key (template_id, kind_key) references platform.templates (id, kind_key) on delete restrict
);
create function platform.freeze_template_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status_key') is distinct from (to_jsonb(old) - 'status_key') then
    raise exception 'a template version is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger template_versions_frozen before update or delete on platform.template_versions
  for each row execute function platform.freeze_template_version();
create trigger template_versions_transition before update of status_key on platform.template_versions
  for each row execute function platform.enforce_transition('platform', 'publish', 'status_key');

alter table platform.templates
  add constraint templates_base_fk foreign key (base_version_id) references platform.template_versions (id) on delete restrict,
  add constraint templates_head_fk foreign key (head_version_id) references platform.template_versions (id) on delete restrict;

create table platform.template_drafts (
  template_id uuid primary key,
  world_id    uuid,
  body        jsonb not null,
  param_map   jsonb not null default '{}'::jsonb,
  updated_by  uuid references identity.profiles (user_id) on delete restrict,
  updated_at  timestamptz not null default now(),
  foreign key (template_id, world_id) references platform.templates (id, world_id) on delete cascade
);
-- editing a draft that was marked ready sends it back to draft
create function platform.note_template_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select platform.uid());
  update platform.templates set publish_status_key = 'draft'
   where id = new.template_id and publish_status_key = 'ready';
  return new;
end $$;
create trigger template_drafts_edit before update of body, param_map on platform.template_drafts
  for each row execute function platform.note_template_draft_change();

-- the answer for every scope, including the platform default; a version of another kind cannot be pinned
create table platform.template_pins (
  id                  uuid primary key default gen_random_uuid(),
  scope_type          text not null check (scope_type in ('platform', 'world', 'vn')),
  scope_id            uuid,
  world_id            uuid,
  scope_key           uuid generated always as (coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  kind_key            text not null references platform.template_kinds (key),
  template_version_id uuid not null,
  pinned_by           uuid references identity.profiles (user_id) on delete restrict,
  pinned_at           timestamptz not null default now(),
  check ((scope_type = 'platform') = (scope_id is null and world_id is null)),
  check (scope_type <> 'world' or scope_id = world_id),
  check (scope_type <> 'vn' or (scope_id is not null and world_id is not null)),
  unique (scope_type, scope_key, kind_key),
  foreign key (template_version_id, kind_key) references platform.template_versions (id, kind_key) on delete restrict
);
create index template_pins_world on platform.template_pins (world_id) where world_id is not null;

-- ---------------------------------------------------------------------------------------------
-- validation
-- ---------------------------------------------------------------------------------------------
create function platform.assert_template_valid(p_kind text, p_body jsonb, p_map jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_kind record;
  n      record;
  m      record;
  v_val  jsonb;
  v_text text;
begin
  select body_kind, max_bytes into v_kind from platform.template_kinds where key = p_kind;
  if not found then
    raise exception 'unknown template kind %', p_kind using errcode = '23503';
  end if;
  if jsonb_typeof(p_body) is distinct from 'object' then
    raise exception 'a template body is a json object' using errcode = '22023';
  end if;
  if octet_length(p_body::text) + octet_length(coalesce(p_map, '{}'::jsonb)::text) > v_kind.max_bytes then
    raise exception 'template too large' using errcode = '22023';
  end if;

  if v_kind.body_kind = 'comfy_graph' then
    for n in select key, value from jsonb_each(p_body) loop
      if jsonb_typeof(n.value) is distinct from 'object' or jsonb_typeof(n.value -> 'class_type') is distinct from 'string' then
        raise exception 'node % is malformed', n.key using errcode = '22023';
      end if;
      if not exists (select 1 from platform.allowed_node_types a
                     where a.class_type = n.value ->> 'class_type' and a.enabled and p_kind = any (a.kind_keys)) then
        raise exception 'node % has a disallowed class_type', n.key using errcode = '22023';
      end if;
    end loop;

    -- no external address and no file path anywhere in the graph
    for v_val in select jsonb_path_query(p_body, 'strict $.**') loop
      if jsonb_typeof(v_val) = 'string' then
        v_text := v_val #>> '{}';
        if v_text ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' or v_text ~ '(^|[\\/])\.\.([\\/]|$)' or v_text ~ '^([A-Za-z]:)?[\\/]' then
          raise exception 'external address or file path in graph' using errcode = '22023';
        end if;
      end if;
    end loop;

    for m in select key, value from jsonb_each(coalesce(p_map, '{}'::jsonb)) loop
      if not (p_body ? (m.value ->> 'node')) or not ((p_body -> (m.value ->> 'node') -> 'inputs') ? (m.value ->> 'input')) then
        raise exception 'param_map entry % names a missing node or input', m.key using errcode = '22023';
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- helpers and the resolver
-- ---------------------------------------------------------------------------------------------
create function platform.is_any_host() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from membership.world_members
                 where user_id = (select platform.uid()) and role_key = 'host' and revoked_at is null);
$$;

-- vn pin, then world pin, then the platform default. session_user is the login (the definer's current_user
-- is the owner), so the server logins are trusted and everyone else must be a host of the world.
create function platform.effective_template(p_world uuid, p_vn uuid, p_kind text)
returns table (template_version_id uuid, resolved_scope text, body jsonb, param_map jsonb, schema_version int, checksum text)
language sql stable security definer set search_path = '' as $$
  select tv.id, p.scope_type, tv.body, tv.param_map, tv.schema_version, tv.checksum
  from platform.template_pins p
  join platform.template_versions tv on tv.id = p.template_version_id
  where p.kind_key = p_kind
    and ((p.scope_type = 'vn'       and p.scope_id = p_vn)
      or (p.scope_type = 'world'    and p.scope_id = p_world)
      or (p.scope_type = 'platform' and p.scope_id is null))
    and (session_user in ('app_rw', 'service_role') or (select membership.is_host(p_world)))
  order by case p.scope_type when 'vn' then 1 when 'world' then 2 else 3 end
  limit 1;
$$;

-- changed nodes between two versions, and which inputs changed
create function platform.template_diff(a uuid, b uuid) returns table (node text, change text, changed_inputs text[])
language sql stable set search_path = '' as $$
  with na as (select e.key, e.value from platform.template_versions v, jsonb_each(v.body) e where v.id = a),
       nb as (select e.key, e.value from platform.template_versions v, jsonb_each(v.body) e where v.id = b)
  select coalesce(na.key, nb.key),
         case when na.key is null then 'added' when nb.key is null then 'removed' else 'changed' end,
         case when na.key is not null and nb.key is not null then
           (select array_agg(k order by k)
              from jsonb_object_keys(coalesce(na.value -> 'inputs', '{}'::jsonb) || coalesce(nb.value -> 'inputs', '{}'::jsonb)) as k
             where (na.value -> 'inputs' -> k) is distinct from (nb.value -> 'inputs' -> k))
         end
  from na full join nb on na.key = nb.key
  where na.value is distinct from nb.value;
$$;

-- ---------------------------------------------------------------------------------------------
-- override lifecycle: create from the default (or any version of the kind), edit, ready, publish
-- ---------------------------------------------------------------------------------------------
create function platform.create_template_override(
  p_kind text, p_world uuid, p_vn uuid default null, p_base uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := (select platform.uid());
  v_vn_world uuid;
  v_base     uuid := p_base;
  v_ver      record;
  v_id       uuid;
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if p_vn is not null then
    select world_id into v_vn_world from vn_content.vns where id = p_vn;
    if v_vn_world is distinct from p_world then
      raise exception 'that visual novel is not in this world' using errcode = '23514';
    end if;
  end if;

  if v_base is null then
    select e.template_version_id into v_base from platform.effective_template(p_world, p_vn, p_kind) e;
  end if;
  select * into v_ver from platform.template_versions where id = v_base;
  if not found or v_ver.kind_key <> p_kind then
    raise exception 'no template of this kind to start from' using errcode = '23514';
  end if;

  insert into platform.templates (kind_key, scope_type, scope_id, world_id, base_version_id, created_by)
    values (p_kind, case when p_vn is null then 'world' else 'vn' end, coalesce(p_vn, p_world), p_world, v_base, v_uid)
    returning id into v_id;
  insert into platform.template_drafts (template_id, world_id, body, param_map, updated_by)
    values (v_id, p_world, v_ver.body, v_ver.param_map, v_uid);
  perform platform.write_audit(v_uid, p_world, 'template_create', 'template', v_id,
    jsonb_build_object('kind', p_kind, 'base_version', v_base));
  return v_id;
end $$;

create function platform.set_template_ready(p_template uuid, p_ready boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from platform.templates where id = p_template and scope_type <> 'platform';
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update platform.templates set publish_status_key = case when p_ready then 'ready' else 'draft' end
   where id = p_template;                             -- the transition trigger checks the move
end $$;

create function platform.publish_template(p_template uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_t     record;
  v_d     record;
  v_no    int;
  v_ver   uuid;
  v_sum   text;
begin
  select * into v_t from platform.templates where id = p_template and scope_type <> 'platform' for update;
  if not found or not (select membership.is_host(v_t.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_t.publish_status_key <> 'ready' then
    raise exception 'draft is not ready' using errcode = '23514';
  end if;
  select * into v_d from platform.template_drafts where template_id = p_template;
  perform platform.assert_template_valid(v_t.kind_key, v_d.body, v_d.param_map);

  v_sum := encode(sha256(convert_to(v_d.body::text || '|' || v_d.param_map::text, 'UTF8')), 'hex');
  select coalesce(max(version_no), 0) + 1 into v_no from platform.template_versions where template_id = p_template;
  insert into platform.template_versions (template_id, kind_key, version_no, body, param_map, checksum, note, published_by)
    values (p_template, v_t.kind_key, v_no, v_d.body, v_d.param_map, v_sum, p_note, v_uid)
    returning id into v_ver;

  perform platform.mark_system();
  update platform.templates set publish_status_key = 'published', head_version_id = v_ver where id = p_template;
  update platform.templates set publish_status_key = 'draft' where id = p_template;
  perform platform.clear_actor();

  insert into platform.template_pins (scope_type, scope_id, world_id, kind_key, template_version_id, pinned_by)
    values (v_t.scope_type, v_t.scope_id, v_t.world_id, v_t.kind_key, v_ver, v_uid)
    on conflict (scope_type, scope_key, kind_key)
    do update set template_version_id = excluded.template_version_id, pinned_by = excluded.pinned_by, pinned_at = now();

  perform platform.write_audit(v_uid, v_t.world_id, 'publish', 'template_version', v_ver,
    jsonb_build_object('template', p_template, 'version_no', v_no));
  perform platform.emit('template.published', v_ver, jsonb_build_object('template', p_template, 'version_no', v_no),
    'pubtpl:' || v_ver::text);
  return v_ver;
end $$;

-- ---------------------------------------------------------------------------------------------
-- pinning: a VN holds its own pins, so releasing a new default never changes it
-- ---------------------------------------------------------------------------------------------
-- pins every kind for a new VN from what its world resolves to now; called by the VN creation function
create function platform.pin_all_templates(p_world uuid, p_vn uuid) returns void
language sql security definer set search_path = '' as $$
  insert into platform.template_pins (scope_type, scope_id, world_id, kind_key, template_version_id, pinned_by)
  select 'vn', p_vn, p_world, k.key, e.template_version_id, (select platform.uid())
  from platform.template_kinds k
  cross join lateral platform.effective_template(p_world, null, k.key) e
  on conflict (scope_type, scope_key, kind_key) do nothing;
$$;

-- a world adopts the current platform default for a kind
create function platform.upgrade_world_template(p_world uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ver uuid;
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  select template_version_id into v_ver from platform.template_pins
   where scope_type = 'platform' and scope_id is null and kind_key = p_kind;
  if v_ver is null then
    raise exception 'there is no platform default for this kind' using errcode = '23514';
  end if;
  insert into platform.template_pins (scope_type, scope_id, world_id, kind_key, template_version_id, pinned_by)
    values ('world', p_world, p_world, p_kind, v_ver, (select platform.uid()))
    on conflict (scope_type, scope_key, kind_key)
    do update set template_version_id = excluded.template_version_id, pinned_by = excluded.pinned_by, pinned_at = now();
  perform platform.write_audit((select platform.uid()), p_world, 'template_upgrade', 'world', p_world,
    jsonb_build_object('kind', p_kind, 'version', v_ver));
  return v_ver;
end $$;

-- a VN adopts what its world resolves to now
create function platform.upgrade_vn_template(p_vn uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_ver   uuid;
begin
  select world_id into v_world from vn_content.vns where id = p_vn;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  select e.template_version_id into v_ver from platform.effective_template(v_world, null, p_kind) e;
  if v_ver is null then
    raise exception 'nothing to adopt for this kind' using errcode = '23514';
  end if;
  insert into platform.template_pins (scope_type, scope_id, world_id, kind_key, template_version_id, pinned_by)
    values ('vn', p_vn, v_world, p_kind, v_ver, (select platform.uid()))
    on conflict (scope_type, scope_key, kind_key)
    do update set template_version_id = excluded.template_version_id, pinned_by = excluded.pinned_by, pinned_at = now();
  perform platform.write_audit((select platform.uid()), v_world, 'template_upgrade', 'vn', p_vn,
    jsonb_build_object('kind', p_kind, 'version', v_ver));
  return v_ver;
end $$;

-- drops the world's own pin (back to the platform default); the override and its versions stay as history
create function platform.reset_world_template(p_world uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  delete from platform.template_pins where scope_type = 'world' and scope_id = p_world and kind_key = p_kind;
  perform platform.write_audit((select platform.uid()), p_world, 'template_reset', 'world', p_world,
    jsonb_build_object('kind', p_kind));
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security: hosts only. Defaults are readable by any host; overrides by the host of the world.
-- Nothing is writable except through the functions above and (draft body) by the owning host.
-- ---------------------------------------------------------------------------------------------
alter table platform.template_kinds     enable row level security;
alter table platform.allowed_node_types enable row level security;
alter table platform.templates          enable row level security;
alter table platform.template_versions  enable row level security;
alter table platform.template_drafts    enable row level security;
alter table platform.template_pins      enable row level security;

create policy template_kinds_read on platform.template_kinds for select to authenticated
  using ((select platform.is_any_host()));
create policy allowed_nodes_read on platform.allowed_node_types for select to authenticated
  using ((select platform.is_any_host()));
create policy template_kinds_read_server on platform.template_kinds for select to app_rw, app_ro using (true);
create policy allowed_nodes_read_server on platform.allowed_node_types for select to app_rw, app_ro using (true);

create policy templates_read on platform.templates for select to authenticated
  using ((scope_type = 'platform' and (select platform.is_any_host()))
         or (world_id is not null and (select membership.is_host(world_id))));
create policy template_versions_read on platform.template_versions for select to authenticated
  using (exists (select 1 from platform.templates t where t.id = template_id));      -- templates policy decides
create policy template_pins_read on platform.template_pins for select to authenticated
  using ((scope_type = 'platform' and (select platform.is_any_host()))
         or (world_id is not null and (select membership.is_host(world_id))));
create policy template_drafts_host on platform.template_drafts for all to authenticated
  using (world_id is not null and (select membership.is_host(world_id)))
  with check (world_id is not null and (select membership.is_host(world_id)));

-- the generation worker reads through app_rw / service_role (no JWT); policies above admit it by login
create policy templates_read_server on platform.templates for select to app_rw, app_ro
  using (session_user in ('app_rw', 'app_ro', 'service_role'));
create policy template_versions_read_server on platform.template_versions for select to app_rw, app_ro
  using (session_user in ('app_rw', 'app_ro', 'service_role'));
create policy template_pins_read_server on platform.template_pins for select to app_rw, app_ro
  using (session_user in ('app_rw', 'app_ro', 'service_role'));

revoke all on platform.template_kinds, platform.allowed_node_types, platform.templates,
  platform.template_versions, platform.template_drafts, platform.template_pins from public, anon, authenticated;
grant select on platform.template_kinds, platform.allowed_node_types, platform.templates,
  platform.template_versions, platform.template_pins to authenticated, app_ro, app_rw;
grant select on platform.template_drafts to authenticated, app_rw;       -- host-only by policy; never app_ro
grant update (body, param_map) on platform.template_drafts to authenticated, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on function
  platform.assert_template_valid(text, jsonb, jsonb), platform.is_any_host(),
  platform.effective_template(uuid, uuid, text), platform.template_diff(uuid, uuid),
  platform.create_template_override(text, uuid, uuid, uuid), platform.set_template_ready(uuid, boolean),
  platform.publish_template(uuid, text), platform.pin_all_templates(uuid, uuid),
  platform.upgrade_world_template(uuid, text), platform.upgrade_vn_template(uuid, text),
  platform.reset_world_template(uuid, text)
  from public, anon;
grant execute on function platform.is_any_host(), platform.assert_template_valid(text, jsonb, jsonb),
  platform.template_diff(uuid, uuid) to authenticated, app_rw, app_ro, service_role;
grant execute on function platform.effective_template(uuid, uuid, text) to authenticated, app_rw, service_role;
grant execute on function
  platform.create_template_override(text, uuid, uuid, uuid), platform.set_template_ready(uuid, boolean),
  platform.publish_template(uuid, text), platform.upgrade_world_template(uuid, text),
  platform.upgrade_vn_template(uuid, text), platform.reset_world_template(uuid, text)
  to authenticated, app_rw;
-- pin_all_templates, freeze_template_version and note_template_draft_change: granted to no one
