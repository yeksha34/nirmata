-- 017 reader: a world's chapters and drafts as prose files, in the database (F-73, ADR-0035, ADR-0036).
-- A writing is one markdown file under chapters/ or drafts/, kept by its path. It is not a published
-- chapter (reader.chapters is for what a reader is shown); it is the author's text that adaptation and
-- the Studio read. Authors only: drafts are unreleased by nature.

create table reader.writings (
  id             uuid primary key default gen_random_uuid(),
  world_id       uuid not null references world_lore.worlds (id) on delete cascade,
  dir            text generated always as (split_part(path, '/', 1)) stored,
  path           text not null check (
                   char_length(path) between 8 and 300
                   and path ~ '^(chapters|drafts)/[^/].*\.md$'
                   and path !~ '(^|/)\.\.(/|$)' and path !~ '[\\\x01-\x1f]'),
  title          text not null check (char_length(title) between 1 and 300),
  body           text not null check (octet_length(body) <= 4194304),
  body_hash      text generated always as (encode(sha256(convert_to(body, 'UTF8')), 'hex')) stored,
  imported_hash  text,                                  -- body_hash of what an import wrote; differs once edited here
  updated_by     uuid references identity.profiles (user_id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (world_id, path)
);
create index writings_world_dir on reader.writings (world_id, dir);
create trigger writings_touch before update on reader.writings
  for each row execute function platform.touch();

-- Saves one writing, making it if it is new. p_stamp is set by an import (the hash of what it wrote);
-- a save without one leaves the earlier stamp, so an edit shows as a difference from it.
create function reader.save_writing(
  p_world uuid, p_path text, p_title text, p_body text, p_stamp text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  insert into reader.writings (world_id, path, title, body, imported_hash, updated_by)
    values (p_world, p_path, p_title, p_body, p_stamp, (select platform.uid()))
    on conflict (world_id, path) do update
      set title = excluded.title, body = excluded.body,
          imported_hash = coalesce(excluded.imported_hash, reader.writings.imported_hash),
          updated_by = excluded.updated_by
    returning id into v_id;
  return v_id;
end $$;

create function reader.remove_writing(p_world uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  delete from reader.writings where world_id = p_world and path = p_path;
end $$;

alter table reader.writings enable row level security;
create policy writings_read on reader.writings for select to authenticated
  using ((select membership.is_author(world_id)));
revoke all on reader.writings from public, anon, authenticated;
grant select on reader.writings to authenticated, app_rw;       -- authors only by policy; never app_ro

revoke execute on function reader.save_writing(uuid, text, text, text, text), reader.remove_writing(uuid, text)
  from public, anon;
grant execute on function reader.save_writing(uuid, text, text, text, text), reader.remove_writing(uuid, text)
  to authenticated, app_rw;
