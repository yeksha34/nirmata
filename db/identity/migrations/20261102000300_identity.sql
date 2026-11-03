-- 003 identity: people, age confirmation (by SSO), invitations. Sign-in is SSO only; sign-ups are
-- disabled in Auth, so a user exists only after an invitation. Content-neutral.

-- ---------------------------------------------------------------------------------------------
-- profiles. Age facts live in profile_age so that other members of a world can read a
-- display name without ever seeing anyone's age state (1:1 split on purpose).
-- ---------------------------------------------------------------------------------------------
create table identity.profiles (
  user_id          uuid primary key,   -- foreign key to auth.users is added by 003b (bootstrap)
  display_name     text not null check (length(display_name) between 1 and 80),
  can_found_worlds boolean not null default false,       -- set when a platform-issued host invitation is accepted
  disabled_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger profiles_touch before update on identity.profiles
  for each row execute function platform.touch();

create table identity.age_sources (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into identity.age_sources (key, label, sort_order) values
  ('idp_claim',       'Adult claim released by the sign-in provider', 10),
  ('idp_attestation', 'Attestation after provider sign-in',           20);
select platform.open_lookup('identity.age_sources');

-- The provider and claim that count as an adult assertion. Deployment configuration, inserted
-- out of band (no rows ship): with no rule for a provider, only attestation is possible.
create table identity.idp_age_rules (
  idp             text primary key,                       -- auth.identities.provider
  claim_name      text not null,
  accepted_values jsonb not null check (jsonb_typeof(accepted_values) = 'array'),
  created_at      timestamptz not null default now()
);
alter table identity.idp_age_rules enable row level security;   -- no policy: owner and server only

create table identity.profile_age (
  user_id          uuid primary key references identity.profiles (user_id) on delete restrict,
  age_confirmed    boolean not null default false,
  age_confirmed_at timestamptz,
  source_key       text references identity.age_sources (key),
  updated_at       timestamptz not null default now(),
  check (age_confirmed = (age_confirmed_at is not null)),
  check (age_confirmed = (source_key is not null))
);
create trigger profile_age_touch before update on identity.profile_age
  for each row execute function platform.touch();

-- append-only record of how each confirmation happened; no birth date, no claim payload
create table identity.age_confirmations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references identity.profiles (user_id) on delete restrict,
  source_key    text not null references identity.age_sources (key),
  idp           text,
  claim_name    text,
  evidence_hash bytea,                                     -- sha-256 of the asserted value
  asserted_at   timestamptz not null default now()
);
create index age_confirmations_user on identity.age_confirmations (user_id, asserted_at desc);
create trigger age_confirmations_append_only before update or delete on identity.age_confirmations
  for each row execute function platform.forbid_change();

-- ---------------------------------------------------------------------------------------------
-- invitations and their state machine
-- ---------------------------------------------------------------------------------------------
create table identity.invitation_statuses (
  key         text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  sort_order  int not null unique,
  created_at  timestamptz not null default now()
);
create table identity.invitation_transitions (
  from_key text not null references identity.invitation_statuses (key),
  to_key   text not null references identity.invitation_statuses (key),
  actor    text not null check (actor in ('system', 'host', 'moderator', 'player')),
  primary key (from_key, to_key, actor)
);
create table identity.invitation_status_history (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id    uuid not null,
  from_key     text,
  to_key       text not null references identity.invitation_statuses (key),
  actor_id     uuid,
  reason       text,
  at           timestamptz not null default now()
);
create index invitation_history_entity on identity.invitation_status_history (entity_id, at desc);
create trigger invitation_history_append_only before update or delete on identity.invitation_status_history
  for each row execute function platform.forbid_change();

insert into identity.invitation_statuses (key, label, is_terminal, sort_order) values
  ('pending',  'Pending',  false, 10),
  ('accepted', 'Accepted', true,  20),
  ('expired',  'Expired',  true,  30),
  ('revoked',  'Revoked',  true,  40);
insert into identity.invitation_transitions (from_key, to_key, actor) values
  ('pending', 'accepted', 'system'),     -- only identity.accept_invitation
  ('pending', 'expired',  'system'),     -- scheduled sweep
  ('pending', 'revoked',  'host'),
  ('pending', 'revoked',  'system');
select platform.open_lookup('identity.invitation_statuses');
select platform.open_lookup('identity.invitation_transitions');

create table identity.invitations (
  id            uuid primary key default gen_random_uuid(),
  token_hash    bytea not null unique check (length(token_hash) = 32),
  invitee_email text not null check (invitee_email = lower(invitee_email)),
  world_id      uuid,                         -- soft reference: world_lore.worlds (null for a platform host invitation)
  story_id      uuid,                         -- soft reference: story_run.stories
  role_key      text not null,                -- soft reference: membership.roles
  status_key    text not null default 'pending' references identity.invitation_statuses (key),
  is_terminal   boolean not null default false,     -- copied from the status by the trigger; lets the partial index skip a join
  invited_by    uuid references identity.profiles (user_id) on delete restrict,   -- null for a platform invitation
  expires_at    timestamptz not null,
  accepted_by   uuid references identity.profiles (user_id) on delete restrict,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status_key = 'accepted') = (accepted_at is not null))
);
create unique index invitations_pending
  on identity.invitations (coalesce(world_id, '00000000-0000-0000-0000-000000000000'::uuid), invitee_email)
  where not is_terminal;
create index invitations_inviter on identity.invitations (invited_by, created_at desc);

create trigger invitations_touch before update on identity.invitations
  for each row execute function platform.touch();
create trigger invitations_initial before insert on identity.invitations
  for each row execute function platform.enforce_initial_status('identity', 'invitation');
create trigger invitations_transition before update of status_key on identity.invitations
  for each row execute function platform.enforce_transition('identity', 'invitation');

-- ---------------------------------------------------------------------------------------------
-- Auth hook: before a user is created, require a pending invitation for the verified email.
-- Configure in Auth as pg-functions://postgres/identity/hook_before_user_created
-- ---------------------------------------------------------------------------------------------
create function identity.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is null or not exists (
    select 1 from identity.invitations i
    where i.invitee_email = v_email and i.status_key = 'pending' and i.expires_at > now()
  ) then
    return jsonb_build_object('error',
      jsonb_build_object('message', 'An invitation is required.', 'http_code', 403));
  end if;
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------------------------------------
-- profile and age functions
-- ---------------------------------------------------------------------------------------------
create function identity.ensure_profile() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select platform.uid());
  v_name text := coalesce(nullif(platform.jwt() -> 'user_metadata' ->> 'name', ''),
                          nullif(platform.jwt() ->> 'email', ''), 'member');
begin
  if v_uid is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;
  insert into identity.profiles (user_id, display_name) values (v_uid, left(v_name, 80))
    on conflict (user_id) do nothing;
  insert into identity.profile_age (user_id) values (v_uid) on conflict (user_id) do nothing;
end $$;

-- Confirms age when the sign-in provider released an accepted adult claim. Returns the result.
create function identity.confirm_age_from_idp() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select platform.uid());
  v_rule record;
  v_val  jsonb;
begin
  perform identity.ensure_profile();
  if (select age_confirmed from identity.profile_age where user_id = v_uid) then
    return true;
  end if;

  for v_rule in
    select r.idp, r.claim_name, r.accepted_values, ai.identity_data
    from identity.user_idp_claims(v_uid) ai
    join identity.idp_age_rules r on r.idp = ai.provider
  loop
    v_val := v_rule.identity_data -> v_rule.claim_name;
    if v_val is not null and v_rule.accepted_values @> jsonb_build_array(v_val) then
      insert into identity.age_confirmations (user_id, source_key, idp, claim_name, evidence_hash)
        values (v_uid, 'idp_claim', v_rule.idp, v_rule.claim_name, sha256(convert_to(v_val::text, 'UTF8')));
      update identity.profile_age
         set age_confirmed = true, age_confirmed_at = now(), source_key = 'idp_claim'
       where user_id = v_uid;
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Used only when the provider releases no adult claim: the person attests after signing in.
create function identity.attest_adult() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select platform.uid());
begin
  perform identity.ensure_profile();
  if exists (select 1 from identity.idp_age_rules r
             join identity.user_idp_claims(v_uid) ai on ai.provider = r.idp) then
    raise exception 'this provider confirms age itself' using errcode = '42501';
  end if;
  insert into identity.age_confirmations (user_id, source_key)
    values (v_uid, 'idp_attestation');
  update identity.profile_age
     set age_confirmed = true, age_confirmed_at = now(), source_key = 'idp_attestation'
   where user_id = v_uid and not age_confirmed;
end $$;

-- ---------------------------------------------------------------------------------------------
-- creating and revoking invitations
-- ---------------------------------------------------------------------------------------------
create function identity.new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- A host invites a moderator or a player into a world. The token is returned once; only its
-- hash is stored.
create function identity.create_invitation(
  p_world uuid, p_email text, p_role text, p_story uuid default null, p_ttl interval default interval '7 days'
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text := identity.new_token();
  v_id    uuid;
begin
  if not (select membership.is_host(p_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if p_role not in ('moderator', 'player') then
    raise exception 'only moderator or player invitations can be issued by a host' using errcode = '42501';
  end if;
  if p_ttl <= interval '0' or p_ttl > interval '30 days' then
    raise exception 'invalid lifetime' using errcode = '22023';
  end if;
  insert into identity.invitations (token_hash, invitee_email, world_id, story_id, role_key, invited_by, expires_at)
    values (sha256(convert_to(v_token, 'UTF8')), lower(trim(p_email)), p_world, p_story, p_role,
            (select platform.uid()), now() + p_ttl)
    returning id into v_id;
  perform platform.write_audit((select platform.uid()), p_world, 'invite', 'invitation', v_id,
                               jsonb_build_object('role', p_role));
  return v_token;
end $$;

-- A platform administrator (service role) invites someone who may found worlds.
create function identity.create_host_invitation(p_email text, p_ttl interval default interval '7 days')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_token text := identity.new_token();
begin
  insert into identity.invitations (token_hash, invitee_email, role_key, expires_at)
    values (sha256(convert_to(v_token, 'UTF8')), lower(trim(p_email)), 'host', now() + p_ttl);
  return v_token;
end $$;

create function identity.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from identity.invitations where id = p_invitation for update;
  if not found or v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update identity.invitations set status_key = 'revoked' where id = p_invitation;   -- trigger checks the move
  perform platform.write_audit((select platform.uid()), v_world, 'invite_revoke', 'invitation', p_invitation);
end $$;

-- The sweep that expires old invitations (scheduled; service role).
create function identity.expire_invitations() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform platform.mark_system();
  update identity.invitations set status_key = 'expired'
   where status_key = 'pending' and expires_at <= now();
  get diagnostics n = row_count;
  perform platform.clear_actor();
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security and API surface
-- ---------------------------------------------------------------------------------------------
alter table identity.profiles               enable row level security;
alter table identity.profile_age            enable row level security;
alter table identity.age_confirmations      enable row level security;
alter table identity.invitations            enable row level security;
alter table identity.invitation_status_history enable row level security;

-- own profile, and the profiles of people who share a world (policy helper added in 004)
create policy profiles_read_own on identity.profiles for select to authenticated
  using (user_id = (select platform.uid()));
create policy profiles_update_own on identity.profiles for update to authenticated
  using (user_id = (select platform.uid())) with check (user_id = (select platform.uid()));

create policy profile_age_read_own on identity.profile_age for select to authenticated
  using (user_id = (select platform.uid()));
create policy age_confirmations_read_own on identity.age_confirmations for select to authenticated
  using (user_id = (select platform.uid()));

create policy invitations_read_issued on identity.invitations for select to authenticated
  using (invited_by = (select platform.uid()));
create policy invitation_history_read_issued on identity.invitation_status_history for select to authenticated
  using (exists (select 1 from identity.invitations i
                 where i.id = entity_id and i.invited_by = (select platform.uid())));

revoke all on identity.profiles, identity.profile_age, identity.age_confirmations,
  identity.idp_age_rules, identity.invitations, identity.invitation_status_history
  from public, anon, authenticated;
grant select (user_id, display_name, can_found_worlds, created_at) on identity.profiles to authenticated;
grant update (display_name) on identity.profiles to authenticated;
grant select on identity.profile_age, identity.age_confirmations to authenticated;
-- token_hash is never granted
grant select (id, invitee_email, world_id, story_id, role_key, status_key, is_terminal,
              invited_by, expires_at, accepted_at, created_at)
  on identity.invitations to authenticated;
grant select on identity.invitation_status_history to authenticated;
grant select on identity.profiles, identity.profile_age, identity.invitations to app_ro;
grant select on identity.profiles, identity.profile_age, identity.invitations to app_rw;

create view identity.v_my_profile with (security_invoker = true) as
select p.user_id, p.display_name, p.can_found_worlds, a.age_confirmed, a.age_confirmed_at
from identity.profiles p
join identity.profile_age a on a.user_id = p.user_id;

create view identity.v_my_invitations with (security_invoker = true) as
select id, invitee_email, world_id, story_id, role_key, status_key, expires_at, accepted_at, created_at
from identity.invitations;

grant select on identity.v_my_profile, identity.v_my_invitations to authenticated, app_ro, app_rw;

-- functions: nothing is executable by default
revoke execute on all functions in schema identity from public, anon;
grant execute on function identity.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function identity.ensure_profile()      to authenticated, app_rw;
grant execute on function identity.confirm_age_from_idp() to authenticated, app_rw;
grant execute on function identity.attest_adult()        to authenticated, app_rw;
grant execute on function identity.create_invitation(uuid, text, text, uuid, interval) to authenticated, app_rw;
grant execute on function identity.revoke_invitation(uuid)  to authenticated, app_rw;
grant execute on function identity.create_host_invitation(text, interval) to service_role;
grant execute on function identity.expire_invitations()     to service_role;
