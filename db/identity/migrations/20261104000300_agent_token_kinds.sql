-- Agent token lanes (F-74, ADR-0037). An import can run as several workers at once, each on its own
-- kinds of card: one on characters, one on accessories, one on settings. A token may therefore name
-- the kinds of card it may write; the server refuses any other. No kinds means any kind.

alter table identity.agent_tokens add column kinds text[] check (
  kinds is null or (
    cardinality(kinds) between 1 and 40
    and array_to_string(kinds, ',') ~ '^[a-z][a-z0-9]{0,39}(,[a-z][a-z0-9]{0,39})*$'
  )
);
grant select (kinds) on identity.agent_tokens to authenticated;

drop function identity.create_agent_token(uuid, text, text[], interval);
create function identity.create_agent_token(
  p_world uuid, p_label text, p_scopes text[] default array['adaptation.read', 'adaptation.write'],
  p_ttl interval default interval '30 days', p_kinds text[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token text := 'nga_' || identity.new_token();
  v_id    uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if p_ttl <= interval '0' or p_ttl > interval '365 days' then
    raise exception 'invalid lifetime' using errcode = '22023';
  end if;
  insert into identity.agent_tokens (token_hash, world_id, created_by, label, scopes, expires_at, kinds)
    values (sha256(convert_to(v_token, 'UTF8')), p_world, (select platform.uid()), trim(p_label),
            p_scopes, now() + p_ttl, p_kinds)
    returning id into v_id;
  perform platform.write_audit((select platform.uid()), p_world, 'agent_token_create', 'agent_token', v_id,
                               jsonb_build_object('label', trim(p_label), 'scopes', to_jsonb(p_scopes),
                                                  'kinds', to_jsonb(p_kinds)));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

drop function identity.resolve_agent_token(text);
create function identity.resolve_agent_token(p_token text)
returns table (token_id uuid, world_id uuid, user_id uuid, scopes text[], kinds text[])
language plpgsql security definer set search_path = '' as $$
declare
  t identity.agent_tokens%rowtype;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  select * into t from identity.agent_tokens a
   where a.token_hash = sha256(convert_to(p_token, 'UTF8'))
     and a.revoked_at is null and a.expires_at > now();
  if not found then return; end if;
  if not (membership.is_author_of(t.world_id, t.created_by)
          or exists (select 1 from identity.profiles p where p.user_id = t.created_by and p.is_admin)) then
    return;
  end if;
  update identity.agent_tokens a set last_used_at = now() where a.id = t.id;
  return query select t.id, t.world_id, t.created_by, t.scopes, t.kinds;
end $$;

revoke execute on function identity.create_agent_token(uuid, text, text[], interval, text[]) from public, anon;
revoke execute on function identity.resolve_agent_token(text) from public, anon, authenticated;
grant execute on function identity.create_agent_token(uuid, text, text[], interval, text[]) to authenticated, app_rw;
grant execute on function identity.resolve_agent_token(text) to app_rw, service_role;
