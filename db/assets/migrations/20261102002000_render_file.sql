-- 020: what the backend needs to serve a render's file: where it is and how big. Returns no row for an unknown id,
-- and none for a caller who may not see it (the server sees all; a person must be a member of the render's world).
create function assets.render_file(p_render uuid)
returns table (storage_path text, store text, content_type text, bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_r record;
begin
  select r.world_id, r.storage_path, r.store, r.content_type, r.bytes into v_r from assets.renders r where r.id = p_render;
  if not found then
    return;
  end if;
  if not ((select platform.is_server()) or (select membership.is_member(v_r.world_id))) then
    return;
  end if;
  return query select v_r.storage_path, v_r.store, v_r.content_type, v_r.bytes;
end $$;

revoke execute on function assets.render_file(uuid) from public, anon;
grant execute on function assets.render_file(uuid) to authenticated, app_rw, service_role;
