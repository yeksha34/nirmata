-- 006 story_run: stories pinned to a published world version, turns, events, host-only events,
-- plot points, the shared board; the story status machine; seating functions (membership).
-- Content-neutral. Runs as migration_owner.

-- ---------------------------------------------------------------------------------------------
-- lookups
-- ---------------------------------------------------------------------------------------------
create table story_run.story_statuses (
  key         text primary key,
  label       text not null,
  is_terminal boolean not null default false,
  sort_order  int not null unique,
  created_at  timestamptz not null default now()
);
create table story_run.story_transitions (
  from_key text not null references story_run.story_statuses (key),
  to_key   text not null references story_run.story_statuses (key),
  actor    text not null check (actor in ('system', 'host', 'moderator', 'player')),
  primary key (from_key, to_key, actor)
);
create table story_run.story_status_history (
  id           uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id    uuid not null,
  from_key     text,
  to_key       text not null references story_run.story_statuses (key),
  actor_id     uuid,
  reason       text,
  at           timestamptz not null default now()
);
create index story_history_entity on story_run.story_status_history (entity_id, at desc);
create trigger story_history_append_only before update or delete on story_run.story_status_history
  for each row execute function platform.forbid_change();

insert into story_run.story_statuses (key, label, is_terminal, sort_order) values
  ('preparing', 'Preparing', false, 10),
  ('running',   'Running',   false, 20),
  ('paused',    'Paused',    false, 30),
  ('finished',  'Finished',  false, 40),
  ('archived',  'Archived',  true,  50);
insert into story_run.story_transitions (from_key, to_key, actor) values
  ('preparing', 'running',  'host'),
  ('running',   'paused',   'host'),
  ('paused',    'running',  'host'),
  ('running',   'finished', 'host'),
  ('paused',    'finished', 'host'),
  ('preparing', 'archived', 'host'),
  ('finished',  'archived', 'host');
select platform.open_lookup('story_run.story_statuses');
select platform.open_lookup('story_run.story_transitions');

create table story_run.turn_kinds (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into story_run.turn_kinds (key, label, sort_order) values
  ('player', 'Player', 10), ('host', 'Host', 20), ('system', 'System', 30);
select platform.open_lookup('story_run.turn_kinds');

create table story_run.plot_point_states (
  key        text primary key,
  label      text not null,
  sort_order int not null unique,
  created_at timestamptz not null default now()
);
insert into story_run.plot_point_states (key, label, sort_order) values
  ('planned', 'Planned', 10), ('active', 'Active', 20), ('resolved', 'Resolved', 30), ('dropped', 'Dropped', 40);
select platform.open_lookup('story_run.plot_point_states');

-- ---------------------------------------------------------------------------------------------
-- stories
-- ---------------------------------------------------------------------------------------------
create table story_run.stories (
  id               uuid primary key default gen_random_uuid(),
  world_id         uuid not null,
  world_version_id uuid not null,
  title            text not null check (char_length(title) between 1 and 120),
  host_id          uuid not null references identity.profiles (user_id) on delete restrict,
  status_key       text not null default 'preparing' references story_run.story_statuses (key),
  is_terminal      boolean not null default false,
  turn_seq         bigint not null default 0,           -- counters: the row lock serialises writers per story
  event_seq        bigint not null default 0,
  host_event_seq   bigint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, world_id),
  -- the world is always the world of the pinned version
  foreign key (world_version_id, world_id) references world_lore.world_versions (id, world_id) on delete restrict
);
create index stories_world on story_run.stories (world_id, status_key) where not is_terminal;
create index stories_host on story_run.stories (host_id, created_at desc);

create trigger stories_initial before insert on story_run.stories
  for each row execute function platform.enforce_initial_status('story_run', 'story');
create trigger stories_transition before update of status_key on story_run.stories
  for each row execute function platform.enforce_transition('story_run', 'story');
create trigger stories_touch before update of title, status_key on story_run.stories
  for each row execute function platform.touch();

-- world, host and pinned version never change by a plain update; rebase_story sets app.rebase
create function story_run.guard_story_pin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.world_id is distinct from old.world_id or new.host_id is distinct from old.host_id then
    raise exception 'a story keeps its world and host' using errcode = '23514';
  end if;
  if new.world_version_id is distinct from old.world_version_id
     and current_setting('app.rebase', true) is distinct from 'on' then
    raise exception 'use story_run.rebase_story to move a story to another world version' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger stories_pin before update on story_run.stories
  for each row execute function story_run.guard_story_pin();

-- ---------------------------------------------------------------------------------------------
-- rows that belong to a story: world copied from the story, per-story sequence numbers
-- ---------------------------------------------------------------------------------------------
create function story_run.copy_world() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select s.world_id into new.world_id from story_run.stories s where s.id = new.story_id;
  if new.world_id is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  return new;
end $$;

-- argument: the counter column on stories (turn_seq, event_seq, host_event_seq)
create function story_run.assign_seq() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_col   text := tg_argv[0];
  v_world uuid;
  v_seq   bigint;
begin
  execute format('update story_run.stories set %I = %I + 1 where id = $1 returning world_id, %I', v_col, v_col, v_col)
    into v_world, v_seq using new.story_id;
  if v_world is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  new.world_id := v_world;
  new.seq := v_seq;
  return new;
end $$;

create table story_run.turns (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null,
  world_id   uuid not null,
  seq        bigint not null,
  author_id  uuid references identity.profiles (user_id) on delete restrict,   -- null for system turns
  kind_key   text not null references story_run.turn_kinds (key),
  body       text not null check (char_length(body) between 1 and 20000),
  meta       jsonb not null default '{}'::jsonb check (octet_length(meta::text) <= 16384),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references identity.profiles (user_id) on delete restrict,
  unique (story_id, seq),
  foreign key (story_id, world_id) references story_run.stories (id, world_id) on delete restrict,
  check ((kind_key = 'system') = (author_id is null)),
  check ((removed_at is null) = (removed_by is null))
);
create index turns_feed on story_run.turns (story_id, seq desc) where removed_at is null;
create index turns_author on story_run.turns (author_id, created_at desc);
create trigger turns_seq before insert on story_run.turns
  for each row execute function story_run.assign_seq('turn_seq');

create table story_run.events (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null,
  world_id   uuid not null,
  seq        bigint not null,
  kind_key   text not null check (kind_key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  payload    jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now(),
  unique (story_id, seq),
  foreign key (story_id, world_id) references story_run.stories (id, world_id) on delete restrict
);
create trigger events_seq before insert on story_run.events
  for each row execute function story_run.assign_seq('event_seq');
create trigger events_append_only before update or delete on story_run.events
  for each row execute function platform.forbid_change();

-- host material lives in its own table, not behind a visibility flag on events
create table story_run.host_events (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null,
  world_id   uuid not null,
  seq        bigint not null,
  kind_key   text not null check (kind_key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  payload    jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 65536),
  created_at timestamptz not null default now(),
  unique (story_id, seq),
  foreign key (story_id, world_id) references story_run.stories (id, world_id) on delete restrict
);
create trigger host_events_seq before insert on story_run.host_events
  for each row execute function story_run.assign_seq('host_event_seq');
create trigger host_events_append_only before update or delete on story_run.host_events
  for each row execute function platform.forbid_change();

create table story_run.plot_points (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null,
  world_id   uuid not null,
  position   int not null check (position >= 0),
  title      text not null check (char_length(title) between 1 and 200),
  body       text not null default '',
  state_key  text not null default 'planned' references story_run.plot_point_states (key),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (story_id, world_id) references story_run.stories (id, world_id) on delete restrict
);
create index plot_points_order on story_run.plot_points (story_id, position);
create trigger plot_points_world before insert on story_run.plot_points
  for each row execute function story_run.copy_world();
create trigger plot_points_touch before update on story_run.plot_points
  for each row execute function platform.touch();

create table story_run.board_items (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null,
  world_id   uuid not null,
  kind       text not null check (kind in ('note', 'clue', 'map', 'handout')),
  body       text not null check (char_length(body) between 1 and 20000),
  meta       jsonb not null default '{}'::jsonb check (octet_length(meta::text) <= 16384),
  created_by uuid not null default platform.uid() references identity.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (story_id, world_id) references story_run.stories (id, world_id) on delete restrict
);
create index board_items_story on story_run.board_items (story_id, created_at desc);
create trigger board_items_world before insert on story_run.board_items
  for each row execute function story_run.copy_world();
create trigger board_items_touch before update on story_run.board_items
  for each row execute function platform.touch();

-- ---------------------------------------------------------------------------------------------
-- helpers used by policies
-- ---------------------------------------------------------------------------------------------
create function story_run.accepts_turns(p_story uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from story_run.stories s where s.id = p_story and s.status_key = 'running');
$$;

-- an event payload may not carry host-only lore: no key that names a secret, and no id of a
-- revision that has secrets
create function story_run.assert_no_secret_refs(p_world uuid, p_payload jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_text text := p_payload::text;
  v_id   text;
begin
  if v_text ~* '"[^"]*secret[^"]*"\s*:' then
    raise exception 'a player-visible event cannot carry a secret' using errcode = '22023';
  end if;
  for v_id in select m[1] from regexp_matches(v_text, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') as m loop
    if exists (select 1 from world_lore.card_revision_secrets s
               where s.world_id = p_world and s.card_revision_id = v_id::uuid) then
      raise exception 'a player-visible event cannot reference host-only lore' using errcode = '22023';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------------------------
create function story_run.create_story(p_version uuid, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world  uuid;
  v_status text;
  v_id     uuid;
begin
  select world_id, status_key into v_world, v_status from world_lore.world_versions where id = p_version;
  if v_world is null then
    raise exception 'unknown world version' using errcode = '23503';
  end if;
  if not (select membership.is_host(v_world)) then
    raise exception 'only a host can start a story' using errcode = '42501';
  end if;
  if v_status <> 'published' then
    raise exception 'that world version is not published' using errcode = '23514';
  end if;
  insert into story_run.stories (world_id, world_version_id, title, host_id)
    values (v_world, p_version, p_title, (select platform.uid())) returning id into v_id;
  perform platform.write_audit((select platform.uid()), v_world, 'story_create', 'story', v_id,
    jsonb_build_object('world_version_id', p_version));
  return v_id;
end $$;

-- moves a story to a later published version of the same line; explicit, host only, audited
create function story_run.rebase_story(p_story uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_story record;
  v_old   record;
  v_new   record;
begin
  select * into v_story from story_run.stories where id = p_story for update;
  if not found then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  if not (select membership.is_host(v_story.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_story.is_terminal then
    raise exception 'the story is archived' using errcode = '23514';
  end if;
  select * into v_old from world_lore.world_versions where id = v_story.world_version_id;
  select * into v_new from world_lore.world_versions where id = p_version;
  if v_new.id is null or v_new.world_line_id <> v_old.world_line_id or v_new.status_key <> 'published'
     or v_new.version_no <= v_old.version_no then
    raise exception 'pick a later published version of the same line' using errcode = '23514';
  end if;
  perform set_config('app.rebase', 'on', true);
  update story_run.stories set world_version_id = p_version where id = p_story;
  perform set_config('app.rebase', '', true);
  perform platform.write_audit((select platform.uid()), v_story.world_id, 'story_rebase', 'story', p_story,
    jsonb_build_object('from_version', v_old.id, 'to_version', p_version));
end $$;

create function story_run.remove_turn(p_turn uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_turn record;
begin
  select * into v_turn from story_run.turns where id = p_turn for update;
  if not found then
    raise exception 'unknown turn' using errcode = '23503';
  end if;
  if not (select membership.is_staff(v_turn.world_id)) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if v_turn.removed_at is not null then
    raise exception 'already removed' using errcode = '23514';
  end if;
  if v_turn.author_id is null then
    raise exception 'system turns cannot be removed' using errcode = '23514';
  end if;
  update story_run.turns set removed_at = now(), removed_by = (select platform.uid()) where id = p_turn;
  insert into membership.moderation_actions (world_id, story_id, target_user_id, actor_id, kind_key, target_ref, reason)
    values (v_turn.world_id, v_turn.story_id, v_turn.author_id, (select platform.uid()), 'remove_turn', p_turn, p_reason);
  perform platform.write_audit((select platform.uid()), v_turn.world_id, 'moderate', 'turn', p_turn);
end $$;

-- player-visible log: the host, or the server acting as the system
create function story_run.record_event(p_story uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_seq   bigint;
begin
  select world_id into v_world from story_run.stories where id = p_story;
  if v_world is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  if not ((select membership.is_host(v_world)) or current_setting('app.actor', true) = 'system') then
    raise exception 'host or system only' using errcode = '42501';
  end if;
  perform story_run.assert_no_secret_refs(v_world, coalesce(p_payload, '{}'::jsonb));
  insert into story_run.events (story_id, world_id, seq, kind_key, payload)
    values (p_story, v_world, 0, p_kind, coalesce(p_payload, '{}'::jsonb)) returning seq into v_seq;
  return v_seq;
end $$;

create function story_run.record_host_event(p_story uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_seq   bigint;
begin
  select world_id into v_world from story_run.stories where id = p_story;
  if v_world is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  if not ((select membership.is_host(v_world)) or current_setting('app.actor', true) = 'system') then
    raise exception 'host or system only' using errcode = '42501';
  end if;
  insert into story_run.host_events (story_id, world_id, seq, kind_key, payload)
    values (p_story, v_world, 0, p_kind, coalesce(p_payload, '{}'::jsonb)) returning seq into v_seq;
  return v_seq;
end $$;

-- seating (membership owns story_seats; it reads the story to copy the world)
create function membership.seat_player(p_story uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_final boolean;
  v_id    uuid;
begin
  select world_id, is_terminal into v_world, v_final from story_run.stories where id = p_story;
  if v_world is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  if not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_final then
    raise exception 'the story is archived' using errcode = '23514';
  end if;
  if not exists (select 1 from membership.world_members
                 where world_id = v_world and user_id = p_user and role_key = 'player' and revoked_at is null) then
    raise exception 'only a player of this world can be seated' using errcode = '23514';
  end if;
  insert into membership.story_seats (story_id, world_id, user_id) values (p_story, v_world, p_user)
    on conflict (story_id, user_id) where left_at is null do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from membership.story_seats where story_id = p_story and user_id = p_user and left_at is null;
  else
    perform platform.write_audit((select platform.uid()), v_world, 'seat', 'story_seat', v_id,
      jsonb_build_object('story_id', p_story, 'user_id', p_user));
  end if;
  return v_id;
end $$;

create function membership.unseat_player(p_story uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from story_run.stories where id = p_story;
  if v_world is null then
    raise exception 'unknown story' using errcode = '23503';
  end if;
  if not ((select platform.uid()) = p_user or (select membership.is_host(v_world))) then
    raise exception 'host or the player themselves' using errcode = '42501';
  end if;
  update membership.story_seats set left_at = now()
   where story_id = p_story and user_id = p_user and left_at is null;
  perform platform.write_audit((select platform.uid()), v_world, 'unseat', 'story_seat', null,
    jsonb_build_object('story_id', p_story, 'user_id', p_user));
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------------------------
alter table story_run.stories              enable row level security;
alter table story_run.story_status_history enable row level security;
alter table story_run.turns                enable row level security;
alter table story_run.events               enable row level security;
alter table story_run.host_events          enable row level security;
alter table story_run.plot_points          enable row level security;
alter table story_run.board_items          enable row level security;

create policy stories_read on story_run.stories for select to authenticated
  using ((select membership.is_story_player(id)) or (select membership.is_staff(world_id)));
create policy stories_host_update on story_run.stories for update to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy story_history_read on story_run.story_status_history for select to authenticated
  using (exists (select 1 from story_run.stories s
                 where s.id = entity_id and (select membership.is_staff(s.world_id))));

create policy turns_read on story_run.turns for select to authenticated
  using ((select membership.is_story_player(story_id)) or (select membership.is_staff(world_id)));
create policy turns_write_own on story_run.turns for insert to authenticated
  with check (
    author_id = (select platform.uid()) and kind_key = 'player'
    and (select membership.is_story_player(story_id))
    and not (select membership.is_hushed(story_id))
    and (select story_run.accepts_turns(story_id)));
create policy turns_write_host on story_run.turns for insert to authenticated
  with check (
    author_id = (select platform.uid()) and kind_key = 'host'
    and (select membership.is_host(world_id))
    and (select story_run.accepts_turns(story_id)));

create policy events_read on story_run.events for select to authenticated
  using ((select membership.is_story_player(story_id)) or (select membership.is_staff(world_id)));

create policy host_events_host on story_run.host_events for select to authenticated
  using ((select membership.is_host(world_id)));

create policy plot_points_host on story_run.plot_points for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy board_read on story_run.board_items for select to authenticated
  using ((select membership.is_story_player(story_id)) or (select membership.is_staff(world_id)));
create policy board_host_write on story_run.board_items for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

-- ---------------------------------------------------------------------------------------------
-- grants: no insert on stories, events, host_events (functions), no update on turns (remove_turn)
-- ---------------------------------------------------------------------------------------------
revoke all on story_run.stories, story_run.story_status_history, story_run.turns, story_run.events,
  story_run.host_events, story_run.plot_points, story_run.board_items from public, anon, authenticated;

grant select on story_run.stories, story_run.story_status_history, story_run.turns, story_run.events,
  story_run.host_events, story_run.plot_points, story_run.board_items to authenticated, app_ro, app_rw;
grant update (title, status_key) on story_run.stories to authenticated, app_rw;
grant insert (story_id, author_id, kind_key, body, meta) on story_run.turns to authenticated, app_rw;
grant insert (story_id, position, title, body, state_key), update (position, title, body, state_key), delete
  on story_run.plot_points to authenticated, app_rw;
grant insert (story_id, kind, body, meta), update (kind, body, meta), delete
  on story_run.board_items to authenticated, app_rw;

-- ---------------------------------------------------------------------------------------------
-- views (caller's rights)
-- ---------------------------------------------------------------------------------------------
create view story_run.v_story_summary with (security_invoker = true) as
select s.id, s.world_id, s.world_version_id, s.title, s.host_id, s.status_key, st.label as status_label,
       s.turn_seq as turn_count, s.created_at, s.updated_at
from story_run.stories s
join story_run.story_statuses st on st.key = s.status_key;

create view story_run.v_turn_feed with (security_invoker = true) as
select t.id, t.story_id, t.seq, t.author_id, p.display_name as author_name, t.kind_key, t.body, t.created_at
from story_run.turns t
left join identity.profiles p on p.user_id = t.author_id
where t.removed_at is null;

grant select on story_run.v_story_summary, story_run.v_turn_feed to authenticated, app_ro, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema story_run from public, anon;
grant execute on function story_run.accepts_turns(uuid) to authenticated, app_rw, app_ro, service_role;
grant execute on function
  story_run.create_story(uuid, text), story_run.rebase_story(uuid, uuid), story_run.remove_turn(uuid, text),
  story_run.record_event(uuid, text, jsonb), story_run.record_host_event(uuid, text, jsonb)
  to authenticated, app_rw;
grant execute on function membership.seat_player(uuid, uuid), membership.unseat_player(uuid, uuid)
  to authenticated, app_rw;
-- copy_world, assign_seq, guard_story_pin and assert_no_secret_refs are trigger or internal helpers: granted to no one
