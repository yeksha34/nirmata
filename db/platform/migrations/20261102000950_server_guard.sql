-- 009b: tell the trusted server apart from a person. The backend logs in as app_rw and, for user work,
-- does `set local role authenticated`; session_user alone cannot tell the two apart, the role setting can.
-- Server work runs with no role set (app_rw) or as service_role. Replaces the guard used by effective_template.
create function platform.is_server() returns boolean
language sql stable set search_path = '' as $$
  select current_setting('role') = 'service_role'
      or (session_user = 'app_rw' and current_setting('role') = 'none');
$$;
grant execute on function platform.is_server() to authenticated, app_rw, app_ro, service_role;

create or replace function platform.effective_template(p_world uuid, p_vn uuid, p_kind text)
returns table (template_version_id uuid, resolved_scope text, body jsonb, param_map jsonb, schema_version int, checksum text)
language sql stable security definer set search_path = '' as $$
  select tv.id, p.scope_type, tv.body, tv.param_map, tv.schema_version, tv.checksum
  from platform.template_pins p
  join platform.template_versions tv on tv.id = p.template_version_id
  where p.kind_key = p_kind
    and ((p.scope_type = 'vn'       and p.scope_id = p_vn)
      or (p.scope_type = 'world'    and p.scope_id = p_world)
      or (p.scope_type = 'platform' and p.scope_id is null))
    and ((select platform.is_server()) or (select membership.is_host(p_world)))
  order by case p.scope_type when 'vn' then 1 when 'world' then 2 else 3 end
  limit 1;
$$;
