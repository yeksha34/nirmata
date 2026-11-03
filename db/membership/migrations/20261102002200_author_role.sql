-- 022: the world role `host` becomes `author`, and a platform `admin` is added (ADR-0029).
-- Roles are admin, author, moderator, player. "Host" is only the label for an author who is running a
-- game: the game-side labels ('host' in actor and event kinds) stay as they are.
-- Needs 001-021. One transaction: if the final check fails, nothing is applied.

-- ---------------------------------------------------------------------------------------------
-- 1. data: the role row, the people who hold it, the invitations that carry it
-- ---------------------------------------------------------------------------------------------
insert into membership.roles (key, label, can_publish, can_moderate, sort_order) values
  ('author', 'Author', true, true, 5);
update membership.world_members set role_key = 'author' where role_key = 'host';
update identity.invitations     set role_key = 'author' where role_key = 'host';
delete from membership.roles where key = 'host';
update membership.roles set sort_order = 10 where key = 'author';

-- a platform administrator: can do everything, in every world
alter table identity.profiles add column is_admin boolean not null default false;
grant select (user_id, display_name, can_found_worlds, is_admin, created_at) on identity.profiles to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. the helpers: renamed, and an administrator passes every role check
-- ---------------------------------------------------------------------------------------------
alter function membership.is_host(uuid)         rename to is_author;
alter function membership.is_host_of(uuid, uuid) rename to is_author_of;
alter function platform.is_any_host()           rename to is_any_author;
alter function identity.create_host_invitation(text, interval) rename to create_author_invitation;

create or replace function membership.has_world_role(p_world uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from identity.profiles p
    join identity.profile_age a on a.user_id = p.user_id
    where p.user_id = (select platform.uid())
      and a.age_confirmed
      and p.disabled_at is null
      and (p.is_admin
           or exists (select 1 from membership.world_members m
                      where m.world_id = p_world and m.user_id = p.user_id
                        and m.revoked_at is null and m.role_key = any (p_roles))));
$$;

create or replace function membership.is_author(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['author']);
$$;
create or replace function membership.is_staff(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['author', 'moderator']);
$$;
create or replace function membership.is_member(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select membership.has_world_role(p_world, array['author', 'moderator', 'player']);
$$;
create or replace function membership.is_author_of(p_world uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from membership.world_members
                 where world_id = p_world and user_id = p_user and role_key = 'author' and revoked_at is null);
$$;

create or replace function platform.is_any_author() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from identity.profiles p
                 where p.user_id = (select platform.uid()) and p.is_admin)
      or exists (select 1 from membership.world_members
                 where user_id = (select platform.uid()) and role_key = 'author' and revoked_at is null);
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. the functions that carry the role by name
-- ---------------------------------------------------------------------------------------------
create or replace function membership._add_member(p_world uuid, p_user uuid, p_role text, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from identity.profile_age a join identity.profiles p using (user_id)
                 where a.user_id = p_user and a.age_confirmed and p.disabled_at is null) then
    raise exception 'age confirmation required' using errcode = '42501';
  end if;
  if p_role = 'author' and not exists (select 1 from identity.profiles where user_id = p_user and can_found_worlds) then
    raise exception 'this person may not author' using errcode = '42501';
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

-- the world's first author, called when a world is created
create or replace function membership.add_founder(p_world uuid, p_user uuid) returns uuid
language sql security definer set search_path = '' as $$
  select membership._add_member(p_world, p_user, 'author', p_user);
$$;

create or replace function membership.grant_role(p_world uuid, p_user uuid, p_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'player') then
    raise exception 'an author can grant moderator or player only' using errcode = '42501';
  end if;
  return membership._add_member(p_world, p_user, p_role, (select platform.uid()));
end $$;

create or replace function membership.revoke_role(p_world uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if p_role = 'author' and not exists (
       select 1 from membership.world_members
       where world_id = p_world and role_key = 'author' and revoked_at is null and user_id <> p_user) then
    raise exception 'a world needs at least one author' using errcode = '23514';
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

-- accepting an invitation: a platform author invitation (no world) lets the person found worlds
create or replace function identity.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_email text := lower(platform.jwt() ->> 'email');
  inv     identity.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;

  select * into inv from identity.invitations
   where token_hash = sha256(convert_to(p_token, 'UTF8'))
     and status_key = 'pending' and expires_at > now()
   for update;
  if not found then
    raise exception 'invitation is not valid' using errcode = 'P0002';
  end if;
  if inv.invitee_email is distinct from v_email then
    raise exception 'invitation is for another address' using errcode = '42501';
  end if;

  perform identity.ensure_profile();
  if not identity.confirm_age_from_idp() then
    raise exception 'age_confirmation_required' using errcode = 'P0001';
  end if;

  perform platform.mark_system();
  update identity.invitations
     set status_key = 'accepted', accepted_by = v_uid, accepted_at = now()
   where id = inv.id;
  perform platform.clear_actor();

  if inv.role_key = 'author' and inv.world_id is null then
    update identity.profiles set can_found_worlds = true where user_id = v_uid;   -- platform author invitation
  else
    perform membership._add_member(inv.world_id, v_uid, inv.role_key, inv.invited_by);
  end if;

  perform platform.write_audit(v_uid, inv.world_id, 'invite_accept', 'invitation', inv.id,
                               jsonb_build_object('role', inv.role_key));
  return jsonb_build_object('world_id', inv.world_id, 'role', inv.role_key);
end $$;

-- A platform administrator (service role) invites someone who may found worlds.
create or replace function identity.create_author_invitation(p_email text, p_ttl interval default interval '7 days')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text := identity.new_token();
begin
  insert into identity.invitations (token_hash, invitee_email, role_key, expires_at)
    values (sha256(convert_to(v_token, 'UTF8')), lower(trim(p_email)), 'author', now() + p_ttl);
  return v_token;
end $$;

-- Makes someone an administrator, or takes it back. Service role (the owner's tools) only: the
-- backend's own login cannot call it.
create function identity.set_admin(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update identity.profiles set is_admin = p_on where user_id = p_user;
  if not found then
    raise exception 'no such person' using errcode = 'P0002';
  end if;
  perform platform.write_audit(null, null, case when p_on then 'admin_grant' else 'admin_revoke' end,
                               'profile', p_user);
end $$;
revoke execute on function identity.set_admin(uuid, boolean) from public, anon, authenticated, app_rw, app_ro;
grant execute on function identity.set_admin(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. every other caller of the old helper names is re-created with the new names
-- ---------------------------------------------------------------------------------------------
do $$
declare
  f   record;
  def text;
  n   int := 0;
begin
  for f in
    select p.oid
      from pg_proc p
      join pg_namespace s on s.oid = p.pronamespace
     where s.nspname in ('platform', 'identity', 'membership', 'world_lore', 'story_run', 'reader',
                         'vn_content', 'assets', 'generation')
       and (p.prosrc like '%membership.is_host(%' or p.prosrc like '%membership.is_host\_of(%'
            or p.prosrc like '%platform.is_any_host(%')
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'membership.is_host_of(', 'membership.is_author_of(');
    def := replace(def, 'membership.is_host(', 'membership.is_author(');
    def := replace(def, 'platform.is_any_host(', 'platform.is_any_author(');
    execute def;
    n := n + 1;
  end loop;
  raise notice 'author rename: % functions re-created', n;

  -- nothing may still refer to the old names
  if exists (
    select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname in ('platform', 'identity', 'membership', 'world_lore', 'story_run', 'reader',
                         'vn_content', 'assets', 'generation')
       and (p.prosrc like '%is\_host(%' or p.prosrc like '%is\_host\_of(%' or p.prosrc like '%is\_any\_host(%')) then
    raise exception 'a function still refers to is_host';
  end if;
  if exists (select 1 from membership.world_members where role_key = 'host')
     or exists (select 1 from identity.invitations where role_key = 'host') then
    raise exception 'a row still carries the host role';
  end if;
end $$;
