-- 004 membership: roles per world, story seats, moderation, and the helper functions every
-- policy calls. Source of truth for who may do what. Content-neutral.
-- world_members.world_id gets its foreign key to world_lore.worlds in the world_lore migration.

create table membership.roles (
  key          text primary key,
  label        text not null,
  can_publish  boolean not null default false,
  can_moderate boolean not null default false,
  sort_order   int not null unique,
  created_at   timestamptz not null default now()
);
insert into membership.roles (key, label, can_publish, can_moderate, sort_order) values
  ('host',      'Host',      true,  true,  10),
  ('moderator', 'Moderator', false, true,  20),
  ('player',    'Player',    false, false, 30);
select platform.open_lookup('membership.roles');

create table membership.world_members (
  id         uuid primary key default gen_random_uuid(),
  world_id   uuid not null,                       -- fk to world_lore.worlds added in 005
  user_id    uuid not null references identity.profiles (user_id) on delete restrict,
  role_key   text not null references membership.roles (key),
  granted_by uuid references identity.profiles (user_id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one live row per (world, person, role); also the lookup every policy hits
create unique index world_members_live on membership.world_members (world_id, user_id, role_key)
  where revoked_at is null;
create index world_members_lookup on membership.world_members (user_id, world_id) include (role_key)
  where revoked_at is null;
create trigger world_members_touch before update on membership.world_members
  for each row execute function platform.touch();

create table membership.story_seats (
  id        uuid primary key default gen_random_uuid(),
  story_id  uuid not null,                        -- soft reference: story_run.stories
  world_id  uuid not null,                        -- copied from the story by seat_player(); policies need it without reading story_run
  user_id   uuid not null references identity.profiles (user_id) on delete restrict,
  joined_at timestamptz not null default now(),
  left_at   timestamptz
);
create unique index story_seats_live on membership.story_seats (story_id, user_id) where left_at is null;
create index story_seats_lookup on membership.story_seats (user_id, story_id) where left_at is null;

create table membership.moderation_action_kinds (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into membership.moderation_action_kinds (key, label, sort_order) values
  ('warn', 'Warn', 10), ('hush', 'Hush', 20), ('lift', 'Lift hush', 30), ('remove_turn', 'Remove turn', 40);
select platform.open_lookup('membership.moderation_action_kinds');

create table membership.moderation_actions (
  id             uuid primary key default gen_random_uuid(),
  world_id       uuid not null,
  story_id       uuid,                            -- soft reference
  target_user_id uuid not null references identity.profiles (user_id) on delete restrict,
  actor_id       uuid not null references identity.profiles (user_id) on delete restrict,
  kind_key       text not null references membership.moderation_action_kinds (key),
  target_ref     uuid,                            -- soft reference, e.g. a turn
  reason         text not null check (length(reason) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index moderation_world on membership.moderation_actions (world_id, created_at desc);
create index moderation_target on membership.moderation_actions (target_user_id, created_at desc);
create trigger moderation_actions_append_only before update or delete on membership.moderation_actions
  for each row execute function platform.forbid_change();

create table membership.hushes (
  id         uuid primary key default gen_random_uuid(),
  world_id   uuid not null,
  story_id   uuid not null,                       -- soft reference
  user_id    uuid not null references identity.profiles (user_id) on delete restrict,
  by_user_id uuid not null references identity.profiles (user_id) on delete restrict,
  reason     text not null,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz check (ends_at is null or ends_at > starts_at),
  lifted_at  timestamptz,
  lifted_by  uuid references identity.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now()
);
create index hushes_active on membership.hushes (story_id, user_id) where lifted_at is null;

-- ---------------------------------------------------------------------------------------------
-- policy helpers: stable, definer, empty search_path. They read the tables as their owner so a
-- policy that calls them never recurses into the policies of the table they read.
-- ---------------------------------------------------------------------------------------------
create function membership.has_world_role(p_world uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from membership.world_members m
    join identity.profiles p     on p.user_id = m.user_id
    join identity.profile_age a  on a.user_id = m.user_id
    where m.world_id = p_world
      and m.user_id = (select platform.uid())
      and m.revoked_at is null
      and m.role_key = any (p_roles)
      and a.age_confirmed
      and p.disabled_at is null);
$$;

create function membership.is_host(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['host']);
$$;
create function membership.is_staff(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['host', 'moderator']);
$$;
create function membership.is_member(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['host', 'moderator', 'player']);
$$;

create function membership.is_story_player(p_story uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from membership.story_seats s
    where s.story_id = p_story and s.user_id = (select platform.uid()) and s.left_at is null
      and membership.is_member(s.world_id));
$$;

create function membership.is_hushed(p_story uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from membership.hushes h
    where h.story_id = p_story and h.user_id = (select platform.uid()) and h.lifted_at is null
      and now() >= h.starts_at and now() < coalesce(h.ends_at, 'infinity'::timestamptz));
$$;

create function membership.shares_world_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from membership.world_members a
    join membership.world_members b on b.world_id = a.world_id
    where a.user_id = (select platform.uid()) and a.revoked_at is null
      and b.user_id = p_user and b.revoked_at is null);
$$;

-- ---------------------------------------------------------------------------------------------
-- changing roles. Nothing here is writable through a policy: only these functions write.
-- ---------------------------------------------------------------------------------------------
-- internal: not granted to anyone. Called by grant_role, accept_invitation and world creation.
create function membership._add_member(p_world uuid, p_user uuid, p_role text, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from identity.profile_age a join identity.profiles p using (user_id)
                 where a.user_id = p_user and a.age_confirmed and p.disabled_at is null) then
    raise exception 'age confirmation required' using errcode = '42501';
  end if;
  if p_role = 'host' and not exists (select 1 from identity.profiles where user_id = p_user and can_found_worlds) then
    raise exception 'this person may not host' using errcode = '42501';
  end if;

  insert into membership.world_members (world_id, user_id, role_key, granted_by)
    values (p_world, p_user, p_role, p_by)
    on conflict (world_id, user_id, role_key) where revoked_at is null do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from membership.world_members
     where world_id = p_world and user_id = p_user and role_key = p_role and revoked_at is null;
  else
    perform platform.write_audit(p_by, p_world, 'role_grant', 'world_member', v_id,
                                 jsonb_build_object('role', p_role));
  end if;
  return v_id;
end $$;

-- internal: the world's first host. Called when a world is created.
create function membership.add_founder(p_world uuid, p_user uuid) returns uuid
language sql security definer set search_path = '' as $$
  select membership._add_member(p_world, p_user, 'host', p_user);
$$;

create function membership.grant_role(p_world uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'player') then
    raise exception 'a host can grant moderator or player only' using errcode = '42501';
  end if;
  return membership._add_member(p_world, p_user, p_role, (select platform.uid()));
end $$;

create function membership.revoke_role(p_world uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if p_role = 'host' and not exists (
       select 1 from membership.world_members
       where world_id = p_world and role_key = 'host' and revoked_at is null and user_id <> p_user) then
    raise exception 'a world needs at least one host' using errcode = '23514';
  end if;
  update membership.world_members set revoked_at = now()
   where world_id = p_world and user_id = p_user and role_key = p_role and revoked_at is null
   returning id into v_id;
  if v_id is null then
    raise exception 'no such live role' using errcode = 'P0002';
  end if;
  perform platform.write_audit((select platform.uid()), p_world, 'role_revoke', 'world_member', v_id,
                               jsonb_build_object('role', p_role));
  perform platform.emit('membership.revoked', p_world, jsonb_build_object('user', p_user),
                        'revoke:' || v_id::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- moderation: staff only; every action is recorded
-- ---------------------------------------------------------------------------------------------
create function membership.hush_user(
  p_world uuid, p_story uuid, p_user uuid, p_reason text, p_ends_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_staff(p_world)) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if membership.is_host_of(p_world, p_user) then
    raise exception 'a host cannot be hushed' using errcode = '42501';
  end if;
  insert into membership.hushes (world_id, story_id, user_id, by_user_id, reason, ends_at)
    values (p_world, p_story, p_user, (select platform.uid()), p_reason, p_ends_at) returning id into v_id;
  insert into membership.moderation_actions (world_id, story_id, target_user_id, actor_id, kind_key, target_ref, reason)
    values (p_world, p_story, p_user, (select platform.uid()), 'hush', v_id, p_reason);
  perform platform.write_audit((select platform.uid()), p_world, 'moderate', 'hush', v_id);
  return v_id;
end $$;

create function membership.is_host_of(p_world uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from membership.world_members
                 where world_id = p_world and user_id = p_user and role_key = 'host' and revoked_at is null);
$$;

create function membership.lift_hush(p_hush uuid, p_reason text default 'lifted') returns void
language plpgsql security definer set search_path = '' as $$
declare
  h membership.hushes%rowtype;
begin
  select * into h from membership.hushes where id = p_hush for update;
  if not found or not (select membership.is_staff(h.world_id)) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update membership.hushes set lifted_at = now(), lifted_by = (select platform.uid())
   where id = p_hush and lifted_at is null;
  insert into membership.moderation_actions (world_id, story_id, target_user_id, actor_id, kind_key, target_ref, reason)
    values (h.world_id, h.story_id, h.user_id, (select platform.uid()), 'lift', p_hush, p_reason);
  perform platform.write_audit((select platform.uid()), h.world_id, 'moderate', 'hush_lift', p_hush);
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------------------------
alter table membership.world_members      enable row level security;
alter table membership.story_seats        enable row level security;
alter table membership.moderation_actions enable row level security;
alter table membership.hushes             enable row level security;

create policy members_read on membership.world_members for select to authenticated
  using (user_id = (select platform.uid()) or (select membership.is_staff(world_id)));
create policy seats_read on membership.story_seats for select to authenticated
  using (user_id = (select platform.uid()) or (select membership.is_staff(world_id)));
create policy moderation_read_staff on membership.moderation_actions for select to authenticated
  using ((select membership.is_staff(world_id)));
create policy moderation_read_target on membership.moderation_actions for select to authenticated
  using (target_user_id = (select platform.uid()));
create policy hushes_read_staff on membership.hushes for select to authenticated
  using ((select membership.is_staff(world_id)));
create policy hushes_read_own on membership.hushes for select to authenticated
  using (user_id = (select platform.uid()));

-- people who share a world can read each other's display name (identity.profiles, columns limited by grant)
create policy profiles_read_peers on identity.profiles for select to authenticated
  using ((select membership.shares_world_with(user_id)));

-- the audit log is readable by staff of the world
create policy audit_read_staff on platform.audit_log for select to authenticated, app_ro
  using (world_id is not null and (select membership.is_staff(world_id)));
grant usage on schema platform to authenticated;
grant select on platform.audit_log to authenticated;

revoke all on membership.world_members, membership.story_seats, membership.moderation_actions,
  membership.hushes from public, anon, authenticated;
grant select on membership.world_members, membership.story_seats, membership.moderation_actions,
  membership.hushes to authenticated, app_ro, app_rw;

create view membership.v_my_worlds with (security_invoker = true) as
select m.world_id, array_agg(m.role_key order by r.sort_order) as roles
from membership.world_members m
join membership.roles r on r.key = m.role_key
where m.user_id = (select platform.uid()) and m.revoked_at is null
group by m.world_id;

create view membership.v_world_members with (security_invoker = true) as
select m.world_id, m.user_id, p.display_name, m.role_key, m.granted_at
from membership.world_members m
join identity.profiles p on p.user_id = m.user_id
where m.revoked_at is null;

grant select on membership.v_my_worlds, membership.v_world_members to authenticated, app_ro, app_rw;

-- functions
revoke execute on all functions in schema membership from public, anon;
grant execute on function
  membership.has_world_role(uuid, text[]), membership.is_host(uuid), membership.is_staff(uuid),
  membership.is_member(uuid), membership.is_story_player(uuid), membership.is_hushed(uuid),
  membership.shares_world_with(uuid), membership.is_host_of(uuid, uuid)
  to authenticated, app_rw, app_ro, service_role;
grant execute on function
  membership.grant_role(uuid, uuid, text), membership.revoke_role(uuid, uuid, text),
  membership.hush_user(uuid, uuid, uuid, text, timestamptz), membership.lift_hush(uuid, text)
  to authenticated, app_rw;
-- _add_member and add_founder are granted to no one: only other definer functions call them.
