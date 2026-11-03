-- 007 reader: chapters with one mutable draft each and immutable published versions, and each
-- reader's place in a chapter. Same draft / publish pattern as world_lore. Content-neutral.
-- world_id and world_line_id are soft references to world_lore (checked by the functions).

-- ---------------------------------------------------------------------------------------------
-- chapters, drafts, versions
-- ---------------------------------------------------------------------------------------------
create table reader.chapters (
  id                 uuid primary key default gen_random_uuid(),
  world_id           uuid not null,
  world_line_id      uuid not null,
  slug               text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  position           int not null check (position >= 0),
  head_version_id    uuid,                                     -- the published head; fk added below
  publish_status_key text not null default 'draft' references platform.publish_statuses (key),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (world_line_id, slug),
  unique (id, world_id)
);
create index chapters_line on reader.chapters (world_line_id, position);
create trigger chapters_touch before update on reader.chapters
  for each row execute function platform.touch();
create trigger chapters_initial before insert on reader.chapters
  for each row execute function platform.enforce_initial_status('platform', 'publish', 'publish_status_key');
create trigger chapters_transition before update of publish_status_key on reader.chapters
  for each row execute function platform.enforce_transition('platform', 'publish', 'publish_status_key');

create table reader.chapter_versions (
  id                       uuid primary key default gen_random_uuid(),
  chapter_id               uuid not null,
  world_id                 uuid not null,
  version_no               int not null check (version_no > 0),
  title                    text not null,
  body                     text not null,
  checksum                 text not null,
  written_against_world_version_id uuid,                       -- soft reference: world_lore.world_versions
  note                     text,
  published_by             uuid not null references identity.profiles (user_id) on delete restrict,
  published_at             timestamptz not null default now(),
  status_key               text not null default 'published' references platform.publish_statuses (key)
                           check (status_key in ('published', 'retracted')),
  unique (chapter_id, version_no),
  unique (id, chapter_id),
  foreign key (chapter_id, world_id) references reader.chapters (id, world_id) on delete restrict
);

-- the text is frozen; only the lifecycle flag may move, and only through the transitions table
create function reader.freeze_chapter_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'status_key') is distinct from (to_jsonb(old) - 'status_key') then
    raise exception 'a published chapter version is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger chapter_versions_frozen before update or delete on reader.chapter_versions
  for each row execute function reader.freeze_chapter_version();
create trigger chapter_versions_transition before update of status_key on reader.chapter_versions
  for each row execute function platform.enforce_transition('platform', 'publish', 'status_key');

alter table reader.chapters
  add constraint chapters_head_fk foreign key (head_version_id, id)
  references reader.chapter_versions (id, chapter_id) on delete restrict;

create table reader.chapter_drafts (
  chapter_id      uuid primary key,
  world_id        uuid not null,
  title           text not null check (char_length(title) between 1 and 300),
  body            text not null default '',
  base_version_id uuid references reader.chapter_versions (id) on delete restrict,   -- the version this copy came from
  updated_by      uuid references identity.profiles (user_id) on delete restrict,
  updated_at      timestamptz not null default now(),
  foreign key (chapter_id, world_id) references reader.chapters (id, world_id) on delete cascade
);

-- editing a draft that was marked ready sends it back to draft
create function reader.note_draft_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select platform.uid());
  update reader.chapters set publish_status_key = 'draft'
   where id = new.chapter_id and publish_status_key = 'ready';
  return new;
end $$;
create trigger chapter_drafts_edit before update of title, body on reader.chapter_drafts
  for each row execute function reader.note_draft_change();

create table reader.reading_progress (
  user_id     uuid not null references identity.profiles (user_id) on delete cascade,
  chapter_id  uuid not null references reader.chapters (id) on delete cascade,
  char_offset int not null default 0 check (char_offset >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

-- ---------------------------------------------------------------------------------------------
-- functions
-- ---------------------------------------------------------------------------------------------
create function reader.create_chapter(p_line uuid, p_slug text, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
  v_id    uuid;
begin
  select world_id into v_world from world_lore.world_lines where id = p_line;
  if v_world is null then
    raise exception 'unknown world line' using errcode = '23503';
  end if;
  if not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  insert into reader.chapters (world_id, world_line_id, slug, position)
    values (v_world, p_line, p_slug,
            (select coalesce(max(position) + 1, 0) from reader.chapters where world_line_id = p_line))
    returning id into v_id;
  insert into reader.chapter_drafts (chapter_id, world_id, title, updated_by)
    values (v_id, v_world, p_title, (select platform.uid()));
  perform platform.write_audit((select platform.uid()), v_world, 'chapter_create', 'chapter', v_id);
  return v_id;
end $$;

-- puts the listed chapters first, in that order; any others keep their relative order after them
create function reader.reorder_chapters(p_line uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from world_lore.world_lines where id = p_line;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update reader.chapters c set position = o.n
  from (
    select id, row_number() over (order by (array_position(p_ids, id) is null), array_position(p_ids, id), position) - 1 as n
    from reader.chapters where world_line_id = p_line
  ) o
  where c.id = o.id and c.position <> o.n;
end $$;

create function reader.set_chapter_ready(p_chapter uuid, p_ready boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from reader.chapters where id = p_chapter;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  update reader.chapters set publish_status_key = case when p_ready then 'ready' else 'draft' end
   where id = p_chapter;                              -- the transition trigger checks the move
end $$;

create function reader.publish_chapter(p_chapter uuid, p_note text default null, p_world_version uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select platform.uid());
  v_ch     record;
  v_draft  record;
  v_head   text;
  v_sum    text;
  v_wv     uuid := p_world_version;
  v_no     int;
  v_ver    uuid;
begin
  select * into v_ch from reader.chapters where id = p_chapter for update;
  if not found or not (select membership.is_host(v_ch.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_ch.publish_status_key <> 'ready' then
    raise exception 'draft is not ready' using errcode = '23514';
  end if;
  select * into v_draft from reader.chapter_drafts where chapter_id = p_chapter;
  if btrim(v_draft.body) = '' then
    raise exception 'the chapter is empty' using errcode = '23514';
  end if;

  v_sum := encode(sha256(convert_to(v_draft.title || E'\n' || v_draft.body, 'UTF8')), 'hex');
  select checksum into v_head from reader.chapter_versions where id = v_ch.head_version_id;
  if v_head = v_sum then
    raise exception 'nothing changed since the head version' using errcode = '23514';
  end if;

  if v_wv is null then
    select head_version_id into v_wv from world_lore.world_lines where id = v_ch.world_line_id;
  elsif not exists (select 1 from world_lore.world_versions
                    where id = v_wv and world_line_id = v_ch.world_line_id and status_key = 'published') then
    raise exception 'not a published version of this line' using errcode = '23514';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no from reader.chapter_versions where chapter_id = p_chapter;
  insert into reader.chapter_versions (chapter_id, world_id, version_no, title, body, checksum,
                                       written_against_world_version_id, note, published_by)
    values (p_chapter, v_ch.world_id, v_no, v_draft.title, v_draft.body, v_sum, v_wv, p_note, v_uid)
    returning id into v_ver;

  perform platform.mark_system();
  update reader.chapters set publish_status_key = 'published', head_version_id = v_ver where id = p_chapter;
  update reader.chapters set publish_status_key = 'draft' where id = p_chapter;
  perform platform.clear_actor();
  update reader.chapter_drafts set base_version_id = v_ver where chapter_id = p_chapter;

  perform platform.write_audit(v_uid, v_ch.world_id, 'publish', 'chapter_version', v_ver,
                               jsonb_build_object('chapter', p_chapter, 'version_no', v_no));
  perform platform.emit('chapter.published', v_ver, jsonb_build_object('chapter', p_chapter, 'version_no', v_no),
                        'pubch:' || v_ver::text);
  return v_ver;
end $$;

create function reader.rollback_chapter(p_chapter uuid, p_to_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_world uuid;
begin
  select world_id into v_world from reader.chapters where id = p_chapter for update;
  if v_world is null or not (select membership.is_host(v_world)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if not exists (select 1 from reader.chapter_versions
                 where id = p_to_version and chapter_id = p_chapter and status_key = 'published') then
    raise exception 'not a published version of this chapter' using errcode = '23514';
  end if;
  update reader.chapters set head_version_id = p_to_version where id = p_chapter;
  perform platform.write_audit((select platform.uid()), v_world, 'rollback', 'chapter', p_chapter,
                               jsonb_build_object('to_version', p_to_version));
  perform platform.emit('chapter.rolled_back', p_chapter, jsonb_build_object('version', p_to_version),
                        'rbch:' || p_chapter::text || ':' || p_to_version::text || ':' || extract(epoch from now())::text);
end $$;

-- a reader's place; members only, published chapters only
create function reader.save_progress(p_chapter uuid, p_offset int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select platform.uid());
  v_world uuid;
  v_head  uuid;
begin
  select world_id, head_version_id into v_world, v_head from reader.chapters where id = p_chapter;
  if v_world is null or v_head is null or not (select membership.is_member(v_world)) then
    raise exception 'no such chapter' using errcode = '42501';
  end if;
  insert into reader.reading_progress (user_id, chapter_id, char_offset)
    values (v_uid, p_chapter, greatest(p_offset, 0))
    on conflict (user_id, chapter_id) do update set char_offset = excluded.char_offset, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- row level security: members read what is published; drafts are host-only; progress is own
-- ---------------------------------------------------------------------------------------------
alter table reader.chapters          enable row level security;
alter table reader.chapter_versions  enable row level security;
alter table reader.chapter_drafts    enable row level security;
alter table reader.reading_progress  enable row level security;

create policy chapters_read on reader.chapters for select to authenticated
  using ((select membership.is_host(world_id))
         or (head_version_id is not null and (select membership.is_member(world_id))));
create policy chapters_update_host on reader.chapters for update to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy chapter_versions_read on reader.chapter_versions for select to authenticated
  using ((select membership.is_host(world_id))
         or (status_key = 'published' and (select membership.is_member(world_id))));

create policy chapter_drafts_host on reader.chapter_drafts for all to authenticated
  using ((select membership.is_host(world_id))) with check ((select membership.is_host(world_id)));

create policy progress_own on reader.reading_progress for select to authenticated
  using (user_id = (select platform.uid()));

revoke all on reader.chapters, reader.chapter_versions, reader.chapter_drafts, reader.reading_progress
  from public, anon, authenticated;
grant select on reader.chapters, reader.chapter_versions, reader.reading_progress to authenticated, app_ro, app_rw;
grant update (slug) on reader.chapters to authenticated, app_rw;
grant select on reader.chapter_drafts to authenticated, app_rw;       -- host-only by policy; never app_ro
grant update (title, body) on reader.chapter_drafts to authenticated, app_rw;

-- ---------------------------------------------------------------------------------------------
-- views
-- ---------------------------------------------------------------------------------------------
-- list screen: no text
create view reader.v_chapter_list with (security_invoker = true) as
select c.id as chapter_id, c.world_id, c.world_line_id as line_id, c.slug, c.position,
       v.version_no, v.title, v.published_at
from reader.chapters c
join reader.chapter_versions v on v.id = c.head_version_id and v.status_key = 'published';

-- reading screen: one chapter's current text
create view reader.v_chapter_current with (security_invoker = true) as
select c.id as chapter_id, c.world_id, c.world_line_id as line_id, c.slug, c.position,
       v.id as version_id, v.version_no, v.title, v.body, v.published_at
from reader.chapters c
join reader.chapter_versions v on v.id = c.head_version_id and v.status_key = 'published';

create view reader.v_my_progress with (security_invoker = true) as
select p.chapter_id, c.slug, p.char_offset, p.updated_at
from reader.reading_progress p
join reader.chapters c on c.id = p.chapter_id
where p.user_id = (select platform.uid());

grant select on reader.v_chapter_list, reader.v_chapter_current, reader.v_my_progress
  to authenticated, app_ro, app_rw;

-- ---------------------------------------------------------------------------------------------
-- function grants
-- ---------------------------------------------------------------------------------------------
revoke execute on all functions in schema reader from public, anon;
grant execute on function
  reader.create_chapter(uuid, text, text), reader.reorder_chapters(uuid, uuid[]),
  reader.set_chapter_ready(uuid, boolean), reader.publish_chapter(uuid, text, uuid),
  reader.rollback_chapter(uuid, uuid), reader.save_progress(uuid, int)
  to authenticated, app_rw;
-- freeze_chapter_version and note_draft_change are trigger functions: granted to no one
