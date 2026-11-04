-- 020 world_lore: chapter- and visual-novel-scoped cards and scene state tracking (ADR-0038).
--  * Allows cards to be scoped to a chapter (chapters/<slug>/cards/...) or a visual novel (vns/<slug>/cards/...).
--  * Maintains a composite unique constraint allowing scoped cards to override global world cards.
--  * Tracks scene-by-scene card states (character state, clothing state: intact/torn, equipped items, role).

-- ---------------------------------------------------------------------------------------------
-- 1. Extend cards table with chapter_slug and vn_slug
-- ---------------------------------------------------------------------------------------------
alter table world_lore.cards
  add column if not exists chapter_slug text check (chapter_slug is null or chapter_slug ~ '^[a-z0-9][a-z0-9_-]{0,120}$'),
  add column if not exists vn_slug text check (vn_slug is null or vn_slug ~ '^[a-z0-9][a-z0-9_-]{0,120}$');

-- Drop the old global unique constraint so that scoped overrides can share a slug
alter table world_lore.cards drop constraint if exists cards_world_id_slug_key;

-- Create composite unique index covering global cards (null scopes) and scoped cards
create unique index if not exists cards_world_scope_slug_idx on world_lore.cards (
  world_id,
  coalesce(chapter_slug, ''),
  coalesce(vn_slug, ''),
  slug
);

-- ---------------------------------------------------------------------------------------------
-- 2. Scene Card States table
-- ---------------------------------------------------------------------------------------------
create table world_lore.scene_card_states (
  id              uuid primary key default gen_random_uuid(),
  world_id        uuid not null references world_lore.worlds (id) on delete cascade,
  chapter_slug    text check (chapter_slug is null or chapter_slug ~ '^[a-z0-9][a-z0-9_-]{0,120}$'),
  vn_slug         text check (vn_slug is null or vn_slug ~ '^[a-z0-9][a-z0-9_-]{0,120}$'),
  scene_id        text not null check (length(scene_id) between 1 and 60),
  card_id         uuid not null references world_lore.cards (id) on delete cascade,
  character_state text check (character_state is null or length(character_state) <= 80),
  clothing_state  text check (clothing_state is null or length(clothing_state) <= 80),
  role            text check (role is null or length(role) <= 400),
  updated_by      uuid references identity.profiles (user_id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((chapter_slug is not null) or (vn_slug is not null))
);

create unique index scene_card_states_unique_idx on world_lore.scene_card_states (
  world_id,
  coalesce(chapter_slug, ''),
  coalesce(vn_slug, ''),
  scene_id,
  card_id
);

create index scene_card_states_lookup on world_lore.scene_card_states (
  world_id,
  coalesce(chapter_slug, ''),
  coalesce(vn_slug, ''),
  scene_id
);

create trigger scene_card_states_touch before update on world_lore.scene_card_states
  for each row execute function platform.touch();

-- ---------------------------------------------------------------------------------------------
-- 3. Row Level Security & Grants
-- ---------------------------------------------------------------------------------------------
alter table world_lore.scene_card_states enable row level security;

create policy scene_card_states_author on world_lore.scene_card_states for all to authenticated
  using ((select membership.is_author(world_id)))
  with check ((select membership.is_author(world_id)));

revoke all on world_lore.scene_card_states from public, anon;
grant select, insert, update, delete on world_lore.scene_card_states to authenticated, app_rw;
grant select on world_lore.scene_card_states to app_ro;

-- ---------------------------------------------------------------------------------------------
-- 4. Helper Functions for Scene Matrix Operations
-- ---------------------------------------------------------------------------------------------
create or replace function world_lore.set_scene_card_state(
  p_world uuid,
  p_chapter text,
  p_vn text,
  p_scene_id text,
  p_card_id uuid,
  p_char_state text default null,
  p_clothing_state text default null,
  p_role text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;

  if p_chapter is null and p_vn is null then
    raise exception 'either chapter or vn must be specified' using errcode = '23514';
  end if;

  insert into world_lore.scene_card_states (
    world_id, chapter_slug, vn_slug, scene_id, card_id,
    character_state, clothing_state, role, updated_by
  ) values (
    p_world, p_chapter, p_vn, p_scene_id, p_card_id,
    p_char_state, p_clothing_state, p_role, (select platform.uid())
  )
  on conflict (world_id, coalesce(chapter_slug, ''), coalesce(vn_slug, ''), scene_id, card_id)
  do update set
    character_state = excluded.character_state,
    clothing_state  = excluded.clothing_state,
    role            = excluded.role,
    updated_by      = excluded.updated_by
  returning id into v_id;

  return v_id;
end $$;

create or replace function world_lore.remove_scene_card_state(
  p_world uuid,
  p_chapter text,
  p_vn text,
  p_scene_id text,
  p_card_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;

  delete from world_lore.scene_card_states
   where world_id = p_world
     and coalesce(chapter_slug, '') = coalesce(p_chapter, '')
     and coalesce(vn_slug, '') = coalesce(p_vn, '')
     and scene_id = p_scene_id
     and card_id = p_card_id;
end $$;

revoke execute on function world_lore.set_scene_card_state(uuid, text, text, text, uuid, text, text, text),
                         world_lore.remove_scene_card_state(uuid, text, text, text, uuid)
  from public, anon;

grant execute on function world_lore.set_scene_card_state(uuid, text, text, text, uuid, text, text, text),
                          world_lore.remove_scene_card_state(uuid, text, text, text, uuid)
  to authenticated, app_rw;
