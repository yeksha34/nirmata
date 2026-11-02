-- 009 vn_content: visual novels pinned to a published world version, with one mutable draft per VN and
-- per scene, immutable scene revisions, immutable VN versions and a head pointer. Same draft / publish
-- pattern as world_lore and reader. Content-neutral.

-- ---------------------------------------------------------------------------------------------
-- lookups
-- ---------------------------------------------------------------------------------------------
create table vn_content.vn_tiers (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into vn_content.vn_tiers (key, label, sort_order) values
  ('short', 'Short', 10), ('medium', 'Medium', 20), ('long', 'Long', 30);
select platform.open_lookup('vn_content.vn_tiers');

create table vn_content.route_kinds (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into vn_content.route_kinds (key, label, sort_order) values
  ('common', 'Common route', 10), ('branch', 'Branch', 20), ('ending', 'Ending', 30);
select platform.open_lookup('vn_content.route_kinds');

-- ---------------------------------------------------------------------------------------------
-- visual novels
-- ---------------------------------------------------------------------------------------------
create table vn_content.vns (
  id                 uuid primary key default gen_random_uuid(),
  world_id           uuid not null,
  world_version_id   uuid not null,                           -- the lore version this VN adapts
  slug               text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title              text not null check (char_length(title) between 1 and 200),
  tier_key           text not null references vn_content.vn_tiers (key),
  head_version_id    uuid,                                     -- the published head; fk added below
  publish_status_key text not null default 'draft' references platform.publish_statuses (key),
  created_by         uuid not null references identity.profiles (user_id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (world_id, slug),
  unique (id, world_id),
  foreign key (world_version_id, world_id) references world_lore.world_versions (id, world_id) on delete restrict
);
create index vns_world on vn_content.vns (world_id, created_at desc);
create trigger vns_touch before update on vn_content.vns
  for each row execute function platform.touch();
create trigger vns_initial before insert on vn_content.vns
  for each row execute function platform.enforce_initial_status('platform', 'publish', 'publish_status_key');
create trigger vns_transition before update of publish_status_key on vn_content.vns
  for each row execute function platform.enforce_transition('platform', 'publish', 'publish_status_key');

-- world and creator never change; the pinned lore version moves only through rebase_vn
create function vn_content.guard_vn_pin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.world_id is distinct from old.world_id or new.created_by is distinct from old.created_by then
    raise exception 'a visual novel keeps its world and creator' using errcode = '23514';
  end if;
  if new.world_version_id is distinct from old.world_version_id
     and current_setting('app.rebase', true) is distinct from 'on' then
    raise exception 'use vn_content.rebase_vn to move a visual novel to another world version' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger vns_pin before update on vn_content.vns
  for each row execute function vn_content.guard_vn_pin();

create table vn_content.vn_drafts (
  vn_id           uuid primary key,
  world_id        uuid not null,
  manifest        jsonb not null default '{}'::jsonb check (jsonb_typeof(manifest) = 'object'),
  base_version_id uuid,                                        -- fk added below
  updated_by      uuid references identity.profiles (user_id) on delete restrict,
  updated_at      timestamptz not null default now(),
  foreign key (vn_id, world_id) references vn_content.vns (id, world_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- routes and scenes (identity only; the text lives in drafts and revisions)
-- ---------------------------------------------------------------------------------------------
create table vn_content.routes (
  id         uuid primary key default gen_random_uuid(),
  vn_id      uuid not null,
  world_id   uuid not null,
  key        text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  kind_key   text not null references vn_content.route_kinds (key),
  position   int not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (vn_id, key),
  unique (id, vn_id),
  foreign key (vn_id, world_id) references vn_content.vns (id, world_id) on delete cascade
);

create table vn_content.scenes (
  id         uuid primary key default gen_random_uuid(),
  vn_id      uuid not null,
  world_id   uuid not null,
  route_id   uuid not null,
  key        text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  position   int not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique (vn_id, key),
  unique (id, vn_id),
  foreign key (vn_id, world_id) references vn_content.vns (id, world_id) on delete cascade,
  foreign key (route_id, vn_id) references vn_content.routes (id, vn_id) on delete restrict
);
create index scenes_route on vn_content.scenes (route_id, position);

-- scene text: lines and slides are always read as a whole script, so they stay jsonb on purpose
create table vn_content.scene_drafts (
  scene_id              uuid primary key,
  vn_id                 uuid not null,
  world_id              uuid not null,
  title                 text not null default '' check (char_length(title) <= 300),
  lines                 jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(lines) = 'array' and octet_length(lines::text) <= 1048576),
  slides                jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(slides) = 'array' and octet_length(slides::text) <= 1048576),
  base_revision_id      uuid,                                   -- fk added below
  changed_since_publish boolean not null default true,
  updated_by            uuid references identity.profiles (user_id) on delete restrict,
  updated_at            timestamptz not null default now(),
  foreign key (scene_id, vn_id) references vn_content.scenes (id, vn_id) on delete cascade,
  foreign key (vn_id, world_id) references vn_content.vns (id, world_id) on delete cascade
);

create table vn_content.scene_revisions (
  id         uuid primary key default gen_random_uuid(),
  scene_id   uuid not null,
  vn_id      uuid not null,
  rev_no     int not null check (rev_no > 0),
  title      text not null,
  lines      jsonb not null,
  slides     jsonb not null,
  checksum   text not null,
  created_at timestamptz not null default now(),
  unique (scene_id, rev_no),
  unique (id, scene_id),
  foreign key (scene_id, vn_id) references vn_content.scenes (id, vn_id) on delete restrict
);
create trigger scene_revisions_immutable before update or delete on vn_content.scene_revisions
  for each row execute function platform.forbid_change();

alter table vn_content.scene_drafts
  add constraint scene_drafts_base_fk foreign key (base_revision_id) references vn_content.scene_revisions (id) on delete restrict;

-- ---------------------------------------------------------------------------------------------
-- versions
-- ---------------------------------------------------------------------------------------------
create table vn_content.vn_versions (
  id               uuid primary key default gen_random_uuid(),
  vn_id            uuid not null,
  world_id         uuid not null,
  version_no       int not null check (version_no > 0),
  manifest         jsonb not null,
  world_version_id uuid not null,                              -- the lore version this VN was published against
  note             text,
  published_by     uuid not null references identity.profiles (user_id) on delete restrict,
  published_at     timestamptz not null default now(),
  status_key       text not null default 'published' references platform.publish_statuses (key)
                   check (status_key in ('published', 'retracted')),
  unique (vn_id, version_no),
  unique (id, vn_id),
  foreign key (vn_id, world_id) references vn_content.vns (id, world_id) on delete restrict
);
create function vn_content.freeze_vn_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status_key') is distinct from (to_jsonb(old) - 'status_key') then
    raise exception 'a published visual novel version is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger vn_versions_frozen before update or delete on vn_content.vn_versions
  for each row execute function vn_content.freeze_vn_version();
create trigger vn_versions_transition before update of status_key on vn_content.vn_versions
  for each row execute function platform.enforce_transition('platform', 'publish', 'status_key');

alter table vn_content.vns
  add constraint vns_head_fk foreign key (head_version_id, id) references vn_content.vn_versions (id, vn_id) on delete restrict;
alter table vn_content.vn_drafts
  add constraint vn_drafts_base_fk foreign key (base_version_id) references vn_content.vn_versions (id) on delete restrict;

create table vn_content.vn_version_scenes (
  vn_version_id     uuid not null,
  vn_id             uuid not null,
  scene_id          uuid not null,
  scene_revision_id uuid not null,
  route_id          uuid not null,
  position          int not null check (position >= 0),
  primary key (vn_version_id, scene_id),
  foreign key (vn_version_id, vn_id) references vn_content.vn_versions (id, vn_id) on delete restrict,
  foreign key (scene_revision_id, scene_id) references vn_content.scene_revisions (id, scene_id) on delete restrict,
  foreign key (route_id, vn_id) references vn_content.routes (id, vn_id) on delete restrict
);
create trigger vn_version_scenes_immutable before update or delete on vn_content.vn_version_scenes
  for each row execute function platform.forbid_change();

-- ---------------------------------------------------------------------------------------------
-- draft edits send a ready VN back to draft
-- ---------------------------------------------------------------------------------------------
create function vn_content.note_scene_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.changed_since_publish := true;
  new.updated_at := now();
  new.updated_by := (select platform.uid());
  update vn_content.vns set publish_status_key = 'draft'
   where id = new.vn_id and publish_status_key = 'ready';
  return new;
end $$;
create trigger scene_drafts_edit before update of title, lines, slides on vn_content.scene_drafts
  for each row execute function vn_content.note_scene_draft_change();

create function vn_content.note_vn_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select platform.uid());
  update vn_content.vns set publish_status_key = 'draft'
   where id = new.vn_id and publish_status_key = 'ready';
  return new;
end $$;
create trigger vn_drafts_edit before update of manifest on vn_content.vn_drafts
  for each row execute function vn_content.note_vn_draft_change();

-- ---------------------------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------------------------
create function vn_content.create_vn(p_version uuid, p_slug text, p_title text, p_tier text default 'medium') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select platform.uid());
  v_world  uuid;
  v_status text;
  v_id     uuid;
begin
  select world_id, status_key into v_world, v_status from world_lore.world_versions where id = p_version;
  if v_world is null then
    raise exception 'unknown world version' using errcode = '23503';
  end if;
  if not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_status <> 'published' then
    raise exception 'that world version is not published' using errcode = '23514';
  end if;
  insert into vn_content.vns (world_id, world_version_id, slug, title, tier_key, created_by)
    values (v_world, p_version, p_slug, p_title, p_tier, v_uid) returning id into v_id;
  insert into vn_content.vn_drafts (vn_id, world_id, updated_by) values (v_id, v_world, v_uid);
  perform platform.pin_all_templates(v_world, v_id);        -- the VN keeps these pins until it upgrades
  perform platform.write_audit(v_uid, v_world, 'vn_create', 'vn', v_id, jsonb_build_object('world_version_id', p_version));
  return v_id;
end $$;

-- moves a VN to a later published version of the same line; explicit, host only, audited
create function vn_content.rebase_vn(p_vn uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_vn  record;
  v_old record;
  v_new record;
begin
  select * into v_vn from vn_content.vns where id = p_vn for update;
  if not found or not (select membership.is_host(v_vn.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  select * into v_old from world_lore.world_versions where id = v_vn.world_version_id;
  select * into v_new from world_lore.world_versions where id = p_version;
  if v_new.id is null or v_new.world_line_id <> v_old.world_line_id or v_new.status_key <> 'published'
     or v_new.version_no <= v_old.version_no then
    raise exception 'pick a later published version of the same line' using errcode = '23514';
  end if;
  perform set_config('app.rebase', 'on', true);
  update vn_content.vns set world_version_id = p_version where id = p_vn;
  perform set_config('app.rebase', '', true);
  perform platform.write_audit((select platform.uid()), v_vn.world_id, 'vn_rebase', 'vn', p_vn,
    jsonb_build_object('from_version', v_old.id, 'to_version', p_version));
end $$;

create function vn_content.create_route(p_vn uuid, p_key text, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_id    uuid;
begin
  select world_id into v_world from vn_content.vns where id = p_vn;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  insert into vn_content.routes (vn_id, world_id, key, kind_key, position)
    values (p_vn, v_world, p_key, p_kind,
            (select coalesce(max(position) + 1, 0) from vn_content.routes where vn_id = p_vn))
    returning id into v_id;
  return v_id;
end $$;

create function vn_content.create_scene(p_route uuid, p_key text, p_title text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_vn    uuid;
  v_world uuid;
  v_id    uuid;
begin
  select vn_id, world_id into v_vn, v_world from vn_content.routes where id = p_route;
  if v_vn is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  insert into vn_content.scenes (vn_id, world_id, route_id, key, position)
    values (v_vn, v_world, p_route, p_key,
            (select coalesce(max(position) + 1, 0) from vn_content.scenes where route_id = p_route))
    returning id into v_id;
  insert into vn_content.scene_drafts (scene_id, vn_id, world_id, title, updated_by)
    values (v_id, v_vn, v_world, p_title, (select platform.uid()));
  return v_id;
end $$;

create function vn_content.set_vn_ready(p_vn uuid, p_ready boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from vn_content.vns where id = p_vn;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update vn_content.vns set publish_status_key = case when p_ready then 'ready' else 'draft' end
   where id = p_vn;                                   -- the transition trigger checks the move
end $$;

-- a VN needs at least one scene, and every scene needs a script
create function vn_content.assert_publishable(p_vn uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from vn_content.scenes where vn_id = p_vn) then
    raise exception 'the visual novel has no scenes' using errcode = '23514';
  end if;
  if exists (select 1 from vn_content.scene_drafts d
             where d.vn_id = p_vn and jsonb_array_length(d.lines) = 0) then
    raise exception 'a scene has an empty script' using errcode = '23514';
  end if;
end $$;

create function vn_content.publish_vn(p_vn uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_vn    record;
  v_draft record;
  v_no    int;
  v_ver   uuid;
  v_rev   uuid;
  v_next  int;
  s       record;
begin
  select * into v_vn from vn_content.vns where id = p_vn for update;
  if not found or not (select membership.is_host(v_vn.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_vn.publish_status_key <> 'ready' then
    raise exception 'draft is not ready' using errcode = '23514';
  end if;
  perform vn_content.assert_publishable(p_vn);
  select * into v_draft from vn_content.vn_drafts where vn_id = p_vn;
  perform platform.assert_template_valid('vn', v_draft.manifest, '{}'::jsonb);

  select coalesce(max(version_no), 0) + 1 into v_no from vn_content.vn_versions where vn_id = p_vn;
  insert into vn_content.vn_versions (vn_id, world_id, version_no, manifest, world_version_id, note, published_by)
    values (p_vn, v_vn.world_id, v_no, v_draft.manifest, v_vn.world_version_id, p_note, v_uid)
    returning id into v_ver;

  for s in
    select sc.id as scene_id, sc.route_id, sc.position, d.title, d.lines, d.slides,
           d.base_revision_id, d.changed_since_publish
    from vn_content.scenes sc
    join vn_content.scene_drafts d on d.scene_id = sc.id
    join vn_content.routes r on r.id = sc.route_id
    where sc.vn_id = p_vn
    order by r.position, sc.position, sc.id
  loop
    if s.base_revision_id is null or s.changed_since_publish then
      select coalesce(max(rev_no), 0) + 1 into v_next from vn_content.scene_revisions where scene_id = s.scene_id;
      insert into vn_content.scene_revisions (scene_id, vn_id, rev_no, title, lines, slides, checksum)
        values (s.scene_id, p_vn, v_next, s.title, s.lines, s.slides,
                encode(sha256(convert_to(s.title || '|' || s.lines::text || '|' || s.slides::text, 'UTF8')), 'hex'))
        returning id into v_rev;
    else
      v_rev := s.base_revision_id;                   -- unchanged: share the earlier revision
    end if;
    insert into vn_content.vn_version_scenes (vn_version_id, vn_id, scene_id, scene_revision_id, route_id, position)
      values (v_ver, p_vn, s.scene_id, v_rev, s.route_id, s.position);
    update vn_content.scene_drafts set base_revision_id = v_rev, changed_since_publish = false
     where scene_id = s.scene_id;
  end loop;

  perform platform.mark_system();
  update vn_content.vns set publish_status_key = 'published', head_version_id = v_ver where id = p_vn;
  update vn_content.vns set publish_status_key = 'draft' where id = p_vn;
  perform platform.clear_actor();
  update vn_content.vn_drafts set base_version_id = v_ver where vn_id = p_vn;

  perform platform.write_audit(v_uid, v_vn.world_id, 'publish', 'vn_version', v_ver,
    jsonb_build_object('vn', p_vn, 'version_no', v_no));
  perform platform.emit('vn.published', v_ver, jsonb_build_object('vn', p_vn, 'version_no', v_no),
    'pubvn:' || v_ver::text);
  return v_ver;
end $$;

create function vn_content.rollback_vn(p_vn uuid, p_to_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from vn_content.vns where id = p_vn for update;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if not exists (select 1 from vn_content.vn_versions
                 where id = p_to_version and vn_id = p_vn and status_key = 'published') then
    raise exception 'not a published version of this visual novel' using errcode = '23514';
  end if;
  update vn_content.vns set head_version_id = p_to_version where id = p_vn;
  perform platform.write_audit((select platform.uid()), v_world, 'rollback', 'vn', p_vn,
    jsonb_build_object('to_version', p_to_version));
  perform platform.emit('vn.rolled_back', p_vn, jsonb_build_object('version', p_to_version),
    'rbvn:' || p_vn::text || ':' || p_to_version::text || ':' || extract(epoch from now())::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security: members read what is published; drafts and structure of unpublished VNs are host-only
-- ---------------------------------------------------------------------------------------------
alter table vn_content.vns               enable row level security;
alter table vn_content.vn_drafts         enable row level security;
alter table vn_content.routes            enable row level security;
alter table vn_content.scenes            enable row level security;
alter table vn_content.scene_drafts      enable row level security;
alter table vn_content.scene_revisions   enable row level security;
alter table vn_content.vn_versions       enable row level security;
alter table vn_content.vn_version_scenes enable row level security;

create policy vns_read on vn_content.vns for select to authenticated
  using ((select membership.is_host(world_id))
         or (head_version_id is not null and (select membership.is_member(world_id))));
create policy vns_update_host on vn_content.vns for update to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy vn_drafts_host on vn_content.vn_drafts for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy routes_read on vn_content.routes for select to authenticated
  using ((select membership.is_host(world_id))
         or ((select membership.is_member(world_id))
             and exists (select 1 from vn_content.vns v where v.id = vn_id and v.head_version_id is not null)));
create policy routes_write_host on vn_content.routes for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy scenes_read on vn_content.scenes for select to authenticated
  using ((select membership.is_host(world_id))
         or ((select membership.is_member(world_id))
             and exists (select 1 from vn_content.vns v where v.id = vn_id and v.head_version_id is not null)));
create policy scenes_write_host on vn_content.scenes for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy scene_drafts_host on vn_content.scene_drafts for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy scene_revisions_read on vn_content.scene_revisions for select to authenticated
  using (exists (select 1 from vn_content.vns v
                 where v.id = vn_id and ((select membership.is_host(v.world_id))
                                         or (v.head_version_id is not null and (select membership.is_member(v.world_id))))));

create policy vn_versions_read on vn_content.vn_versions for select to authenticated
  using ((select membership.is_host(world_id))
         or (status_key = 'published' and (select membership.is_member(world_id))));
create policy vn_version_scenes_read on vn_content.vn_version_scenes for select to authenticated
  using (exists (select 1 from vn_content.vn_versions vv where vv.id = vn_version_id));    -- versions policy decides

revoke all on all tables in schema vn_content from public, anon, authenticated;
grant select on vn_content.vn_tiers, vn_content.route_kinds to authenticated, app_ro, app_rw;   -- lookups: policy created above
grant select on vn_content.vns, vn_content.routes, vn_content.scenes, vn_content.scene_revisions,
  vn_content.vn_versions, vn_content.vn_version_scenes to authenticated, app_ro, app_rw;
grant select on vn_content.vn_drafts, vn_content.scene_drafts to authenticated, app_rw;   -- host-only by policy; never app_ro
grant update (title, tier_key) on vn_content.vns to authenticated, app_rw;
grant update (manifest) on vn_content.vn_drafts to authenticated, app_rw;
grant update (position), delete on vn_content.routes to authenticated, app_rw;
grant update (route_id, position), delete on vn_content.scenes to authenticated, app_rw;
grant update (title, lines, slides) on vn_content.scene_drafts to authenticated, app_rw;

-- ---------------------------------------------------------------------------------------------
-- views: the script as one read
-- ---------------------------------------------------------------------------------------------
create view vn_content.v_vn_list with (security_invoker = true) as
select v.id as vn_id, v.world_id, v.slug, v.title, v.tier_key, vv.id as version_id, vv.version_no, vv.published_at
from vn_content.vns v
join vn_content.vn_versions vv on vv.id = v.head_version_id and vv.status_key = 'published';

create view vn_content.v_vn_script_current with (security_invoker = true) as
select v.id as vn_id, v.world_id, vv.id as version_id, vv.version_no,
       r.key as route_key, r.kind_key as route_kind, r.position as route_position,
       sc.key as scene_key, vs.position as scene_position, rev.title, rev.lines, rev.slides
from vn_content.vns v
join vn_content.vn_versions vv on vv.id = v.head_version_id and vv.status_key = 'published'
join vn_content.vn_version_scenes vs on vs.vn_version_id = vv.id
join vn_content.routes r on r.id = vs.route_id
join vn_content.scenes sc on sc.id = vs.scene_id
join vn_content.scene_revisions rev on rev.id = vs.scene_revision_id;

grant select on vn_content.v_vn_list, vn_content.v_vn_script_current to authenticated, app_ro, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema vn_content from public, anon;
grant execute on function
  vn_content.create_vn(uuid, text, text, text), vn_content.rebase_vn(uuid, uuid),
  vn_content.create_route(uuid, text, text), vn_content.create_scene(uuid, text, text),
  vn_content.set_vn_ready(uuid, boolean), vn_content.publish_vn(uuid, text), vn_content.rollback_vn(uuid, uuid)
  to authenticated, app_rw;
-- assert_publishable and the trigger functions are granted to no one
