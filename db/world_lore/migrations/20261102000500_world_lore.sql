-- 005 world_lore: worlds, world-lines (branches of a world's lore), cards, host-only Secrets,
-- immutable versions, publish and rollback. Content-neutral: a card's kind is free text per world.

-- ---------------------------------------------------------------------------------------------
-- identity of worlds, lines, cards
-- ---------------------------------------------------------------------------------------------
create table world_lore.worlds (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  title       text not null check (length(title) between 1 and 200),
  created_by  uuid not null references identity.profiles (user_id) on delete restrict,
  archived_at timestamptz,                      -- worlds are archived, never deleted: soft references stay resolvable
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger worlds_touch before update on world_lore.worlds
  for each row execute function platform.touch();

-- membership.world_members gets its foreign key now that worlds exist
alter table membership.world_members
  add constraint world_members_world_fk foreign key (world_id) references world_lore.worlds (id) on delete restrict;

-- A world-line is a branch of the world's lore: its own draft, its own versions, and the version
-- it was forked from. Every world has one default line.
create table world_lore.world_lines (
  id                    uuid primary key default gen_random_uuid(),
  world_id              uuid not null references world_lore.worlds (id) on delete restrict,
  key                   text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title                 text not null,
  is_default            boolean not null default false,
  forked_from_version_id uuid,                  -- fk added below (versions come after lines)
  head_version_id       uuid,                   -- the published head; fk added below
  draft_base_version_id uuid,
  publish_status_key    text not null default 'draft' references platform.publish_statuses (key),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (world_id, key),
  unique (id, world_id)
);
create unique index world_lines_one_default on world_lore.world_lines (world_id) where is_default;
create trigger world_lines_touch before update on world_lore.world_lines
  for each row execute function platform.touch();
create trigger world_lines_initial before insert on world_lore.world_lines
  for each row execute function platform.enforce_initial_status('platform', 'publish', 'publish_status_key');
create trigger world_lines_transition before update of publish_status_key on world_lore.world_lines
  for each row execute function platform.enforce_transition('platform', 'publish', 'publish_status_key');

-- a published world returns to draft for the next cycle; only the publish function does this
insert into platform.publish_transitions (from_key, to_key, actor) values ('published', 'draft', 'system');

create table world_lore.cards (
  id         uuid primary key default gen_random_uuid(),
  world_id   uuid not null references world_lore.worlds (id) on delete restrict,
  kind       text not null check (length(kind) between 1 and 60),     -- free text per world
  slug       text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (world_id, slug),
  unique (id, world_id)
);
create trigger cards_touch before update on world_lore.cards
  for each row execute function platform.touch();

-- ---------------------------------------------------------------------------------------------
-- immutable revisions and versions
-- ---------------------------------------------------------------------------------------------
create table world_lore.card_revisions (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid not null,
  world_id   uuid not null,
  rev_no     int not null check (rev_no > 0),
  title      text not null,
  body       text not null,
  meta       jsonb not null default '{}'::jsonb,   -- denormalised on purpose: free-form, read whole, never filtered
  checksum   text not null,
  created_at timestamptz not null default now(),
  unique (card_id, rev_no),
  unique (id, card_id),
  unique (id, world_id),
  foreign key (card_id, world_id) references world_lore.cards (id, world_id) on delete restrict
);
create trigger card_revisions_frozen before update or delete on world_lore.card_revisions
  for each row execute function platform.forbid_change();

create table world_lore.card_revision_parts (
  card_revision_id uuid not null references world_lore.card_revisions (id) on delete restrict,
  position         int not null check (position >= 0),
  part_key         text not null,
  body             text not null,
  primary key (card_revision_id, position)
);
create trigger card_revision_parts_frozen before update or delete on world_lore.card_revision_parts
  for each row execute function platform.forbid_change();

-- Host-only Secrets live in their own table: no view over parts or revisions can carry one.
create table world_lore.card_revision_secrets (
  card_revision_id uuid not null,
  world_id         uuid not null,                  -- kept equal to the revision's world by the composite key
  position         int not null check (position >= 0),
  body             text not null,
  primary key (card_revision_id, position),
  foreign key (card_revision_id, world_id) references world_lore.card_revisions (id, world_id) on delete restrict
);
create trigger card_revision_secrets_frozen before update or delete on world_lore.card_revision_secrets
  for each row execute function platform.forbid_change();

create table world_lore.world_versions (
  id           uuid primary key default gen_random_uuid(),
  world_line_id uuid not null,
  world_id     uuid not null,
  version_no   int not null check (version_no > 0),
  note         text,
  published_by uuid not null references identity.profiles (user_id) on delete restrict,
  published_at timestamptz not null default now(),
  status_key   text not null default 'published' references platform.publish_statuses (key)
               check (status_key in ('published', 'retracted')),
  unique (world_line_id, version_no),
  unique (id, world_id),
  foreign key (world_line_id, world_id) references world_lore.world_lines (id, world_id) on delete restrict
);
-- content is frozen; only the lifecycle flag may move, and only through the transitions table
create function world_lore.freeze_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status_key') is distinct from (to_jsonb(old) - 'status_key') then
    raise exception 'a published version is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger world_versions_frozen before update or delete on world_lore.world_versions
  for each row execute function world_lore.freeze_version();
create trigger world_versions_transition before update of status_key on world_lore.world_versions
  for each row execute function platform.enforce_transition('platform', 'publish', 'status_key');

alter table world_lore.world_lines
  add constraint world_lines_forked_from_fk foreign key (forked_from_version_id) references world_lore.world_versions (id) on delete restrict,
  add constraint world_lines_head_fk foreign key (head_version_id) references world_lore.world_versions (id) on delete restrict,
  add constraint world_lines_draft_base_fk foreign key (draft_base_version_id) references world_lore.world_versions (id) on delete restrict;

create table world_lore.world_version_cards (
  world_version_id uuid not null references world_lore.world_versions (id) on delete restrict,
  card_id          uuid not null,
  card_revision_id uuid not null,
  primary key (world_version_id, card_id),
  foreign key (card_revision_id, card_id) references world_lore.card_revisions (id, card_id) on delete restrict
);
create trigger world_version_cards_frozen before update or delete on world_lore.world_version_cards
  for each row execute function platform.forbid_change();

-- ---------------------------------------------------------------------------------------------
-- drafts: one mutable working copy per card per line
-- ---------------------------------------------------------------------------------------------
create table world_lore.card_drafts (
  line_id               uuid not null,
  card_id               uuid not null,
  world_id              uuid not null,
  title                 text not null check (length(title) between 1 and 300),
  body                  text not null default '',
  meta                  jsonb not null default '{}'::jsonb,
  base_revision_id      uuid references world_lore.card_revisions (id) on delete restrict,   -- the revision this copy came from
  changed_since_publish boolean not null default true,
  updated_by            uuid references identity.profiles (user_id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (line_id, card_id),
  unique (line_id, card_id, world_id),
  foreign key (line_id, world_id) references world_lore.world_lines (id, world_id) on delete cascade,
  foreign key (card_id, world_id) references world_lore.cards (id, world_id) on delete cascade
);
create trigger card_drafts_touch before update on world_lore.card_drafts
  for each row execute function platform.touch();

create table world_lore.card_draft_parts (
  line_id   uuid not null,
  card_id   uuid not null,
  world_id  uuid not null,
  position  int not null check (position >= 0),
  part_key  text not null,
  body      text not null,
  primary key (line_id, card_id, position),
  foreign key (line_id, card_id, world_id) references world_lore.card_drafts (line_id, card_id, world_id) on delete cascade
);
create table world_lore.card_draft_secrets (
  line_id   uuid not null,
  card_id   uuid not null,
  world_id  uuid not null,
  position  int not null check (position >= 0),
  body      text not null,
  primary key (line_id, card_id, position),
  foreign key (line_id, card_id, world_id) references world_lore.card_drafts (line_id, card_id, world_id) on delete cascade
);

-- Any edit marks the card changed, and a line that was ready goes back to draft.
create function world_lore.note_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_line uuid := coalesce(new.line_id, old.line_id);
  v_card uuid := coalesce(new.card_id, old.card_id);
begin
  if tg_table_name = 'card_drafts' then
    if tg_op = 'UPDATE' and (new.title, new.body, new.meta) is not distinct from (old.title, old.body, old.meta) then
      return new;                                  -- publish bookkeeping, not an edit
    end if;
    if tg_op = 'UPDATE' then
      new.changed_since_publish := true;
      new.updated_by := (select platform.uid());
    end if;
  else
    update world_lore.card_drafts set changed_since_publish = true
     where line_id = v_line and card_id = v_card;
  end if;
  update world_lore.world_lines set publish_status_key = 'draft'
   where id = v_line and publish_status_key = 'ready';
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
create trigger card_drafts_edit before update on world_lore.card_drafts
  for each row execute function world_lore.note_draft_change();
create trigger card_draft_parts_edit after insert or update or delete on world_lore.card_draft_parts
  for each row execute function world_lore.note_draft_change();
create trigger card_draft_secrets_edit after insert or update or delete on world_lore.card_draft_secrets
  for each row execute function world_lore.note_draft_change();

-- ---------------------------------------------------------------------------------------------
-- functions: create, fork, ready, publish, rollback
-- ---------------------------------------------------------------------------------------------
create function world_lore.create_world(p_slug text, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_world uuid;
begin
  if v_uid is null or not exists (select 1 from identity.profiles where user_id = v_uid and can_found_worlds) then
    raise exception 'this person may not found worlds' using errcode = '42501';
  end if;
  insert into world_lore.worlds (slug, title, created_by) values (p_slug, p_title, v_uid) returning id into v_world;
  insert into world_lore.world_lines (world_id, key, title, is_default) values (v_world, 'main', p_title, true);
  perform membership.add_founder(v_world, v_uid);
  perform platform.write_audit(v_uid, v_world, 'create', 'world', v_world);
  return v_world;
end $$;

-- Marks the draft of a line ready to publish (or back to draft).
create function world_lore.set_line_ready(p_line uuid, p_ready boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from world_lore.world_lines where id = p_line;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update world_lore.world_lines set publish_status_key = case when p_ready then 'ready' else 'draft' end
   where id = p_line;                                -- the transition trigger checks the move
end $$;

-- Branch a line from its published head: a new line with its own draft.
create function world_lore.fork_line(p_line uuid, p_key text, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_head  uuid;
  v_new   uuid;
begin
  select world_id, head_version_id into v_world, v_head from world_lore.world_lines where id = p_line;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_head is null then
    raise exception 'publish the line before forking it' using errcode = '23514';
  end if;

  insert into world_lore.world_lines (world_id, key, title, forked_from_version_id, draft_base_version_id)
    values (v_world, p_key, p_title, v_head, v_head) returning id into v_new;

  insert into world_lore.card_drafts (line_id, card_id, world_id, title, body, meta, base_revision_id, changed_since_publish, updated_by)
    select v_new, vc.card_id, v_world, r.title, r.body, r.meta, r.id, false, (select platform.uid())
    from world_lore.world_version_cards vc
    join world_lore.card_revisions r on r.id = vc.card_revision_id
    where vc.world_version_id = v_head;
  insert into world_lore.card_draft_parts (line_id, card_id, world_id, position, part_key, body)
    select v_new, vc.card_id, v_world, p.position, p.part_key, p.body
    from world_lore.world_version_cards vc
    join world_lore.card_revision_parts p on p.card_revision_id = vc.card_revision_id
    where vc.world_version_id = v_head;
  insert into world_lore.card_draft_secrets (line_id, card_id, world_id, position, body)
    select v_new, vc.card_id, v_world, s.position, s.body
    from world_lore.world_version_cards vc
    join world_lore.card_revision_secrets s on s.card_revision_id = vc.card_revision_id
    where vc.world_version_id = v_head;

  -- inserting parts flagged the drafts as edited; a fresh fork has nothing unpublished
  update world_lore.card_drafts set changed_since_publish = false where line_id = v_new;

  perform platform.write_audit((select platform.uid()), v_world, 'fork', 'world_line', v_new,
                               jsonb_build_object('from_version', v_head));
  return v_new;
end $$;

create function world_lore.assert_publishable(p_line uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from world_lore.card_drafts where line_id = p_line) then
    raise exception 'nothing to publish' using errcode = '23514';
  end if;
end $$;

-- Publish: freeze changed cards into revisions, add a version, move the head, record it.
-- One transaction; the world row is locked so revision numbers cannot collide.
create function world_lore.publish_world_line(p_line uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select platform.uid());
  v_world  uuid;
  v_status text;
  v_ver    uuid;
  v_no     int;
  v_rev    uuid;
  v_next   int;
  d        record;
begin
  select world_id into v_world from world_lore.world_lines where id = p_line;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  perform 1 from world_lore.worlds where id = v_world for update;
  select publish_status_key into v_status from world_lore.world_lines where id = p_line for update;
  if v_status <> 'ready' then
    raise exception 'draft is not ready' using errcode = '23514';
  end if;
  perform world_lore.assert_publishable(p_line);

  select coalesce(max(version_no), 0) + 1 into v_no from world_lore.world_versions where world_line_id = p_line;
  insert into world_lore.world_versions (world_line_id, world_id, version_no, note, published_by)
    values (p_line, v_world, v_no, p_note, v_uid) returning id into v_ver;

  for d in select * from world_lore.card_drafts where line_id = p_line order by card_id loop
    if d.base_revision_id is null or d.changed_since_publish then
      select coalesce(max(rev_no), 0) + 1 into v_next from world_lore.card_revisions where card_id = d.card_id;
      insert into world_lore.card_revisions (card_id, world_id, rev_no, title, body, meta, checksum)
        values (d.card_id, v_world, v_next, d.title, d.body, d.meta,
                md5(concat_ws('|', d.title, d.body, d.meta::text)))
        returning id into v_rev;
      insert into world_lore.card_revision_parts (card_revision_id, position, part_key, body)
        select v_rev, position, part_key, body from world_lore.card_draft_parts
         where line_id = p_line and card_id = d.card_id;
      insert into world_lore.card_revision_secrets (card_revision_id, world_id, position, body)
        select v_rev, v_world, position, body from world_lore.card_draft_secrets
         where line_id = p_line and card_id = d.card_id;
    else
      v_rev := d.base_revision_id;                   -- unchanged: share the earlier revision
    end if;
    insert into world_lore.world_version_cards (world_version_id, card_id, card_revision_id)
      values (v_ver, d.card_id, v_rev);
    update world_lore.card_drafts set base_revision_id = v_rev, changed_since_publish = false
     where line_id = p_line and card_id = d.card_id;
  end loop;

  perform platform.mark_system();
  update world_lore.world_lines set publish_status_key = 'published', head_version_id = v_ver where id = p_line;
  update world_lore.world_lines set publish_status_key = 'draft', draft_base_version_id = v_ver where id = p_line;
  perform platform.clear_actor();

  perform platform.write_audit(v_uid, v_world, 'publish', 'world_version', v_ver,
                               jsonb_build_object('line', p_line, 'version_no', v_no));
  perform platform.emit('world.published', v_ver, jsonb_build_object('line', p_line, 'version_no', v_no),
                        'pub:' || v_ver::text);
  return v_ver;
end $$;

-- Rollback is a pointer move to an earlier published version. Nothing is deleted, and stories
-- that pinned another version are unaffected.
create function world_lore.rollback_world_line(p_line uuid, p_to_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from world_lore.world_lines where id = p_line for update;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if not exists (select 1 from world_lore.world_versions
                 where id = p_to_version and world_line_id = p_line and status_key = 'published') then
    raise exception 'not a published version of this line' using errcode = '23514';
  end if;
  update world_lore.world_lines set head_version_id = p_to_version where id = p_line;
  perform platform.write_audit((select platform.uid()), v_world, 'rollback', 'world_line', p_line,
                               jsonb_build_object('to_version', p_to_version));
  perform platform.emit('world.rolled_back', p_line, jsonb_build_object('version', p_to_version),
                        'rb:' || p_line::text || ':' || p_to_version::text || ':' || extract(epoch from now())::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- indexes (queries named in docs/supabase-database-plan.md section 7)
-- ---------------------------------------------------------------------------------------------
create index world_lines_world on world_lore.world_lines (world_id);                       -- lines of a world
create index world_versions_line on world_lore.world_versions (world_line_id, version_no desc);   -- version history, newest first
create index world_version_cards_revision on world_lore.world_version_cards (card_revision_id);   -- fk cover
create index card_revisions_card on world_lore.card_revisions (card_id, rev_no desc);       -- latest revision of a card
create index cards_world_kind on world_lore.cards (world_id, kind);                        -- list cards by kind
create index card_drafts_card on world_lore.card_drafts (card_id);                         -- fk cover
create index card_drafts_changed on world_lore.card_drafts (line_id) where changed_since_publish;   -- what publish must freeze

-- ---------------------------------------------------------------------------------------------
-- row level security. Players read published content only; drafts and Secrets are host-only.
-- Versions, revisions and history have no write policy: only the functions above write them.
-- ---------------------------------------------------------------------------------------------
alter table world_lore.worlds                enable row level security;
alter table world_lore.world_lines           enable row level security;
alter table world_lore.cards                 enable row level security;
alter table world_lore.card_revisions        enable row level security;
alter table world_lore.card_revision_parts   enable row level security;
alter table world_lore.card_revision_secrets enable row level security;
alter table world_lore.world_versions        enable row level security;
alter table world_lore.world_version_cards   enable row level security;
alter table world_lore.card_drafts           enable row level security;
alter table world_lore.card_draft_parts      enable row level security;
alter table world_lore.card_draft_secrets    enable row level security;

create policy worlds_read on world_lore.worlds for select to authenticated
  using ((select membership.is_member(id)));
create policy worlds_update_host on world_lore.worlds for update to authenticated
  using ((select membership.is_host(id))) with check ((select membership.is_host(id)));

create policy lines_read on world_lore.world_lines for select to authenticated
  using ((select membership.is_member(world_id)));

create policy cards_read on world_lore.cards for select to authenticated
  using ((select membership.is_member(world_id)));
create policy cards_write_host on world_lore.cards for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy revisions_read on world_lore.card_revisions for select to authenticated
  using ((select membership.is_member(world_id)));
create policy revision_parts_read on world_lore.card_revision_parts for select to authenticated
  using (exists (select 1 from world_lore.card_revisions r
                 where r.id = card_revision_id and (select membership.is_member(r.world_id))));
create policy versions_read on world_lore.world_versions for select to authenticated
  using ((select membership.is_member(world_id)));
create policy version_cards_read on world_lore.world_version_cards for select to authenticated
  using (exists (select 1 from world_lore.world_versions v
                 where v.id = world_version_id and (select membership.is_member(v.world_id))));

create policy secrets_host_only on world_lore.card_revision_secrets for select to authenticated
  using ((select membership.is_host(world_id)));

create policy drafts_host on world_lore.card_drafts for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));
create policy draft_parts_host on world_lore.card_draft_parts for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));
create policy draft_secrets_host on world_lore.card_draft_secrets for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

-- grants: explicit, per object
revoke all on all tables in schema world_lore from public, anon, authenticated;
grant select on world_lore.worlds, world_lore.world_lines, world_lore.cards, world_lore.card_revisions,
  world_lore.card_revision_parts, world_lore.world_versions, world_lore.world_version_cards
  to authenticated, app_ro, app_rw;
grant update (title, archived_at) on world_lore.worlds to authenticated;
grant insert, update, delete on world_lore.cards to authenticated;
grant select on world_lore.card_revision_secrets to authenticated, app_rw;   -- host-only by policy; never app_ro
grant select, insert, update, delete on world_lore.card_drafts, world_lore.card_draft_parts,
  world_lore.card_draft_secrets to authenticated;

-- ---------------------------------------------------------------------------------------------
-- views: the surface the API reads
-- ---------------------------------------------------------------------------------------------
create view world_lore.v_world_line_current with (security_invoker = true) as
select wl.id as line_id, wl.world_id, wl.key, wl.title, wl.is_default,
       wv.id as version_id, wv.version_no, wv.published_at
from world_lore.world_lines wl
join world_lore.world_versions wv on wv.id = wl.head_version_id and wv.status_key = 'published';

-- player-safe cards: no secrets table is referenced anywhere
create view world_lore.v_card_current with (security_invoker = true) as
select c.world_id, cur.line_id, cur.version_id, c.id as card_id, c.kind, c.slug, r.title, r.body, r.meta
from world_lore.v_world_line_current cur
join world_lore.world_version_cards vc on vc.world_version_id = cur.version_id
join world_lore.card_revisions r on r.id = vc.card_revision_id
join world_lore.cards c on c.id = vc.card_id;

create view world_lore.v_card_parts_current with (security_invoker = true) as
select cur.line_id, cur.version_id, vc.card_id, p.position, p.part_key, p.body
from world_lore.v_world_line_current cur
join world_lore.world_version_cards vc on vc.world_version_id = cur.version_id
join world_lore.card_revision_parts p on p.card_revision_id = vc.card_revision_id;

-- host view: the Secrets of the current version (the table policy admits hosts only)
create view world_lore.v_card_secrets_current with (security_invoker = true) as
select cur.line_id, cur.version_id, vc.card_id, s.position, s.body
from world_lore.v_world_line_current cur
join world_lore.world_version_cards vc on vc.world_version_id = cur.version_id
join world_lore.card_revision_secrets s on s.card_revision_id = vc.card_revision_id;

create view world_lore.v_world_version_list with (security_invoker = true) as
select v.world_line_id as line_id, v.world_id, v.id as version_id, v.version_no, v.note, v.published_at, v.status_key
from world_lore.world_versions v;

grant select on world_lore.v_world_line_current, world_lore.v_card_current, world_lore.v_card_parts_current,
  world_lore.v_world_version_list to authenticated, app_ro, app_rw;
grant select on world_lore.v_card_secrets_current to authenticated, app_rw;

-- functions
revoke execute on all functions in schema world_lore from public, anon;
grant execute on function
  world_lore.create_world(text, text), world_lore.set_line_ready(uuid, boolean),
  world_lore.fork_line(uuid, text, text), world_lore.publish_world_line(uuid, text),
  world_lore.rollback_world_line(uuid, uuid)
  to authenticated, app_rw;
