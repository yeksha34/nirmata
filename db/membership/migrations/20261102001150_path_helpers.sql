-- 011b: helpers for the policies on Storage objects and Realtime channels (those policies are created by
-- the bootstrap file after this one). Paths start with the world id; channel topics are world:<id>,
-- story:<id> or job:<id>. Anything else is refused.
create function membership.path_world(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

create function membership.can_read_path(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(membership.is_member(membership.path_world(p_name)), false);
$$;

create function membership.can_write_path(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(membership.is_host(membership.path_world(p_name)), false);
$$;

create function membership.can_listen_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id   text := split_part(p_topic, ':', 2);
  v_uuid uuid;
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_uuid := v_id::uuid;
  if v_kind = 'world' then
    return membership.is_member(v_uuid);
  elsif v_kind = 'story' then
    return membership.is_story_player(v_uuid)
        or exists (select 1 from story_run.stories s where s.id = v_uuid and membership.is_staff(s.world_id));
  elsif v_kind = 'job' then
    return exists (select 1 from generation.jobs j where j.id = v_uuid and membership.is_staff(j.world_id));
  end if;
  return false;
end $$;

grant execute on function membership.path_world(text), membership.can_read_path(text),
  membership.can_write_path(text), membership.can_listen_topic(text)
  to authenticated, app_rw, app_ro, service_role;
