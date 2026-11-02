-- 002 platform core: trigger helpers, shared publish statuses, the generic status-machine
-- enforcement, audit log, outbox. The runner connects as a member of migration_owner and does `set role`.

-- ---------------------------------------------------------------------------------------------
-- who is calling: read from the request claims, so nothing here depends on the auth schema
-- ---------------------------------------------------------------------------------------------
create function platform.jwt() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create function platform.uid() returns uuid
language sql stable set search_path = '' as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         platform.jwt() ->> 'sub'), '')::uuid;
$$;
grant execute on function platform.jwt(), platform.uid() to authenticated, app_rw, app_ro, service_role;

-- ---------------------------------------------------------------------------------------------
-- small trigger functions
-- ---------------------------------------------------------------------------------------------
create function platform.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function platform.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name
    using errcode = '42501';
end $$;

-- Marks the rest of the transaction as done by the system (a definer function, not a person).
-- Only definer functions and the trusted server roles can call it; it is never granted to the API.
create function platform.mark_system() returns void
language sql security definer set search_path = '' as $$
  select set_config('app.actor', 'system', true);
$$;

create function platform.clear_actor() returns void
language sql security definer set search_path = '' as $$
  select set_config('app.actor', '', true);
$$;

-- ---------------------------------------------------------------------------------------------
-- lookups are readable by every signed-in role and writable by nobody but the owner
-- ---------------------------------------------------------------------------------------------
create function platform.open_lookup(p_table regclass) returns void
language plpgsql set search_path = '' as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy lookup_read on %s for select to authenticated, app_rw, app_ro using (true)', p_table);
  execute format('revoke all on %s from public, anon', p_table);
  execute format('grant select on %s to authenticated, app_rw, app_ro', p_table);
end $$;

-- ---------------------------------------------------------------------------------------------
-- publish statuses: one vocabulary shared by every schema that has a draft / publish cycle
-- ---------------------------------------------------------------------------------------------
create table platform.publish_statuses (
  key         text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  sort_order  int not null unique,
  created_at  timestamptz not null default now()
);

create table platform.publish_transitions (
  from_key text not null references platform.publish_statuses (key),
  to_key   text not null references platform.publish_statuses (key),
  actor    text not null check (actor in ('system', 'host', 'moderator', 'player')),
  primary key (from_key, to_key, actor)
);

create table platform.publish_status_history (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,                 -- soft reference: schema.table of the entity
  entity_id    uuid not null,                 -- soft reference: its id
  from_key     text,
  to_key       text not null references platform.publish_statuses (key),
  actor_id     uuid,
  reason       text,
  at           timestamptz not null default now()
);
create index publish_history_entity on platform.publish_status_history (entity_table, entity_id, at desc);

insert into platform.publish_statuses (key, label, is_terminal, sort_order) values
  ('draft',     'Draft',     false, 10),
  ('ready',     'Ready',     false, 20),
  ('published', 'Published', false, 30),
  ('retracted', 'Retracted', true,  40);

insert into platform.publish_transitions (from_key, to_key, actor) values
  ('draft',     'ready',     'host'),
  ('ready',     'draft',     'host'),
  ('ready',     'published', 'system'),     -- only the publish function moves a draft to published
  ('published', 'retracted', 'host'),
  ('published', 'retracted', 'system');

select platform.open_lookup('platform.publish_statuses');
select platform.open_lookup('platform.publish_transitions');

-- ---------------------------------------------------------------------------------------------
-- generic status-machine enforcement
--   trigger args: (schema, prefix [, column])  ->  <prefix>_statuses, <prefix>_transitions,
--   <prefix>_status_history in <schema>. The column defaults to status_key.
-- The move is allowed only if (from, to, actor) is a row in the transitions table.
-- ---------------------------------------------------------------------------------------------
create function platform.enforce_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t_schema  text := tg_argv[0];
  t_prefix  text := tg_argv[1];
  t_column  text := coalesce(tg_argv[2], 'status_key');
  v_old     text := to_jsonb(old) ->> t_column;
  v_new     text := to_jsonb(new) ->> t_column;
  v_world   uuid := nullif(to_jsonb(new) ->> 'world_id', '')::uuid;
  v_actor   text;
  v_ok      boolean;
  v_final   boolean;
begin
  if v_new is not distinct from v_old then
    return new;
  end if;

  v_actor := case
    when current_setting('app.actor', true) = 'system'                    then 'system'
    when (select platform.uid()) is null                                      then 'system'
    when v_world is not null and (select membership.is_host(v_world))     then 'host'
    when v_world is not null and (select membership.is_staff(v_world))    then 'moderator'
    else 'player' end;

  execute format('select exists (select 1 from %I.%I where from_key = $1 and to_key = $2 and actor = $3)',
                 t_schema, t_prefix || '_transitions')
    into v_ok using v_old, v_new, v_actor;
  if not v_ok then
    raise exception 'status move % -> % is not allowed for %', v_old, v_new, v_actor
      using errcode = '23514';
  end if;

  execute format('select is_terminal from %I.%I where key = $1', t_schema, t_prefix || '_statuses')
    into v_final using v_new;
  new := jsonb_populate_record(new, jsonb_build_object('is_terminal', v_final));   -- ignored if absent

  execute format('insert into %I.%I (entity_table, entity_id, from_key, to_key, actor_id) values ($1, $2, $3, $4, $5)',
                 t_schema, t_prefix || '_status_history')
    using tg_table_schema || '.' || tg_table_name, (to_jsonb(new) ->> 'id')::uuid, v_old, v_new, (select platform.uid());
  return new;
end $$;

-- A new row must start in the first state of its machine (lowest sort_order).
create function platform.enforce_initial_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t_schema text := tg_argv[0];
  t_prefix text := tg_argv[1];
  t_column text := coalesce(tg_argv[2], 'status_key');
  v_first  text;
begin
  execute format('select key from %I.%I order by sort_order limit 1', t_schema, t_prefix || '_statuses')
    into v_first;
  if (to_jsonb(new) ->> t_column) is distinct from v_first then
    raise exception 'a new row must start as %', v_first using errcode = '23514';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- audit log: append-only, monthly partitions (a scheduled job adds the next month)
-- ---------------------------------------------------------------------------------------------
create table platform.audit_log (
  id           uuid not null default gen_random_uuid(),
  at           timestamptz not null default now(),
  actor_id     uuid,                          -- soft reference: identity.profiles
  world_id     uuid,                          -- soft reference: world_lore.worlds
  action       text not null,                 -- generic verb: publish, generate, moderate, role_change ...
  subject_kind text not null,
  subject_id   uuid,
  detail       jsonb not null default '{}'::jsonb,
  primary key (id, at)
) partition by range (at);

create table platform.audit_log_default partition of platform.audit_log default;
create index audit_world_at on platform.audit_log (world_id, at desc);

create trigger audit_log_append_only before update or delete on platform.audit_log
  for each row execute function platform.forbid_change();

alter table platform.audit_log enable row level security;
alter table platform.audit_log_default enable row level security;
-- readable by staff of the world; the staff policy is added with the membership helpers (004)

create function platform.write_audit(
  p_actor uuid, p_world uuid, p_action text, p_subject_kind text, p_subject_id uuid,
  p_detail jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into platform.audit_log (actor_id, world_id, action, subject_kind, subject_id, detail)
  values (p_actor, p_world, p_action, p_subject_kind, p_subject_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- outbox: written in the same transaction as the change, drained by the server
-- ---------------------------------------------------------------------------------------------
create table platform.outbox (
  id              bigint generated always as identity primary key,
  topic           text not null,
  aggregate_id    uuid,                       -- soft reference
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create index outbox_pending on platform.outbox (id) where delivered_at is null;
alter table platform.outbox enable row level security;   -- no policy: only definer functions and service_role

create function platform.emit(p_topic text, p_aggregate uuid, p_payload jsonb, p_key text) returns void
language sql security definer set search_path = '' as $$
  insert into platform.outbox (topic, aggregate_id, payload, idempotency_key)
  values (p_topic, p_aggregate, coalesce(p_payload, '{}'::jsonb), p_key)
  on conflict (idempotency_key) do nothing;
$$;

-- ---------------------------------------------------------------------------------------------
-- grants: platform is not exposed; only the server roles touch it
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema platform from public, anon, authenticated;
grant execute on function platform.write_audit(uuid, uuid, text, text, uuid, jsonb) to app_rw, service_role;
grant execute on function platform.emit(text, uuid, jsonb, text) to app_rw, service_role;
grant select, update (delivered_at) on platform.outbox to service_role;
grant select on platform.audit_log to app_ro;

