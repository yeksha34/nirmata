-- 019 world_lore: what a world's author wrote about the world beyond its cards (F-74, ADR-0037).
--  * A world skill is the author's guide to writing in the world: its premise, voice, structure and
--    the way scenes are built. A world may have several. It is a document, not a card: it is read
--    whole by whoever writes in the world, and it is never cut into parts.
--  * An author rule is one rule of writing the world ("no child is shown sexually", "monsters speak
--    in short lines"). It is kept apart from rule cards, which the host checks during play: these
--    are the author's own instructions to whoever drafts, adapts or reviews text.
-- Both are the author's working material: authors only, never shown to players.

create table world_lore.world_skills (
  id          uuid primary key default gen_random_uuid(),
  world_id    uuid not null references world_lore.worlds (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title       text not null check (char_length(title) between 1 and 300),
  description text not null default '' check (char_length(description) <= 2000),
  body        text not null check (octet_length(body) <= 1048576),
  updated_by  uuid references identity.profiles (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (world_id, slug)
);
create trigger world_skills_touch before update on world_lore.world_skills
  for each row execute function platform.touch();

create table world_lore.author_rules (
  id          uuid primary key default gen_random_uuid(),
  world_id    uuid not null references world_lore.worlds (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title       text not null check (char_length(title) between 1 and 300),
  body        text not null check (octet_length(body) <= 262144),
  updated_by  uuid references identity.profiles (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (world_id, slug)
);
create trigger author_rules_touch before update on world_lore.author_rules
  for each row execute function platform.touch();

create function world_lore.save_world_skill(
  p_world uuid, p_slug text, p_title text, p_description text, p_body text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  insert into world_lore.world_skills (world_id, slug, title, description, body, updated_by)
    values (p_world, p_slug, p_title, coalesce(p_description, ''), p_body, (select platform.uid()))
    on conflict (world_id, slug) do update
      set title = excluded.title, description = excluded.description, body = excluded.body,
          updated_by = excluded.updated_by
    returning id into v_id;
  return v_id;
end $$;

create function world_lore.remove_world_skill(p_world uuid, p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  delete from world_lore.world_skills where world_id = p_world and slug = p_slug;
end $$;

create function world_lore.save_author_rule(p_world uuid, p_slug text, p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  insert into world_lore.author_rules (world_id, slug, title, body, updated_by)
    values (p_world, p_slug, p_title, p_body, (select platform.uid()))
    on conflict (world_id, slug) do update
      set title = excluded.title, body = excluded.body, updated_by = excluded.updated_by
    returning id into v_id;
  return v_id;
end $$;

create function world_lore.remove_author_rule(p_world uuid, p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  delete from world_lore.author_rules where world_id = p_world and slug = p_slug;
end $$;

alter table world_lore.world_skills enable row level security;
alter table world_lore.author_rules enable row level security;
create policy world_skills_read on world_lore.world_skills for select to authenticated
  using ((select membership.is_author(world_id)));
create policy author_rules_read on world_lore.author_rules for select to authenticated
  using ((select membership.is_author(world_id)));
revoke all on world_lore.world_skills, world_lore.author_rules from public, anon, authenticated;
grant select on world_lore.world_skills, world_lore.author_rules to authenticated, app_rw;   -- authors only by policy; never app_ro

revoke execute on function
  world_lore.save_world_skill(uuid, text, text, text, text), world_lore.remove_world_skill(uuid, text),
  world_lore.save_author_rule(uuid, text, text, text), world_lore.remove_author_rule(uuid, text)
  from public, anon;
grant execute on function
  world_lore.save_world_skill(uuid, text, text, text, text), world_lore.remove_world_skill(uuid, text),
  world_lore.save_author_rule(uuid, text, text, text), world_lore.remove_author_rule(uuid, text)
  to authenticated, app_rw;
