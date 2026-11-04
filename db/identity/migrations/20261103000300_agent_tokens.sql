-- Agent tokens: an author hands the adaptation agent a revocable credential for one world (ADR-0035).
-- Only the sha-256 of the token is stored. The agent works through the backend, never the database;
-- the backend resolves a token to (world, author, scopes) and then acts as that author in that world.

create table identity.agent_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   bytea not null unique check (length(token_hash) = 32),
  world_id     uuid not null,                       -- soft reference: world_lore.worlds
  created_by   uuid not null references identity.profiles (user_id) on delete restrict,
  label        text not null check (length(trim(label)) between 1 and 80),
  scopes       text[] not null check (scopes <> '{}' and scopes <@ array['adaptation.read', 'adaptation.write']),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index agent_tokens_world on identity.agent_tokens (world_id, created_at desc);

alter table identity.agent_tokens enable row level security;
create policy agent_tokens_author on identity.agent_tokens for select to authenticated
  using ((select membership.is_author(world_id)));
-- no write policy: tokens are made and revoked only through the functions below
revoke all on identity.agent_tokens from authenticated;
grant select (id, world_id, created_by, label, scopes, expires_at, revoked_at, last_used_at, created_at)
  on identity.agent_tokens to authenticated;   -- token_hash is never granted

-- Make a token. Returned once; only its hash is kept. `nga_` marks it as an agent token.
create function identity.create_agent_token(
  p_world uuid, p_label text, p_scopes text[] default array['adaptation.read', 'adaptation.write'],
  p_ttl interval default interval '30 days'
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
  insert into identity.agent_tokens (token_hash, world_id, created_by, label, scopes, expires_at)
    values (sha256(convert_to(v_token, 'UTF8')), p_world, (select platform.uid()), trim(p_label),
            p_scopes, now() + p_ttl)
    returning id into v_id;
  perform platform.write_audit((select platform.uid()), p_world, 'agent_token_create', 'agent_token', v_id,
                               jsonb_build_object('label', trim(p_label), 'scopes', to_jsonb(p_scopes)));
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create function identity.revoke_agent_token(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from identity.agent_tokens where id = p_id for update;
  if v_world is null or not (select membership.is_author(v_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  update identity.agent_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  perform platform.write_audit((select platform.uid()), v_world, 'agent_token_revoke', 'agent_token', p_id);
end $$;

-- Server only: who a presented token speaks for. Nothing is returned for an unknown, revoked or
-- expired token, or when the author no longer holds the author role in that world.
create function identity.resolve_agent_token(p_token text)
returns table (token_id uuid, world_id uuid, user_id uuid, scopes text[])
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
  return query select t.id, t.world_id, t.created_by, t.scopes;
end $$;

revoke execute on function identity.create_agent_token(uuid, text, text[], interval) from public, anon;
revoke execute on function identity.revoke_agent_token(uuid) from public, anon;
revoke execute on function identity.resolve_agent_token(text) from public, anon, authenticated;
grant execute on function identity.create_agent_token(uuid, text, text[], interval) to authenticated, app_rw;
grant execute on function identity.revoke_agent_token(uuid) to authenticated, app_rw;
grant execute on function identity.resolve_agent_token(text) to app_rw, service_role;
