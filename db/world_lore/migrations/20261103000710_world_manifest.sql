-- 018 world_lore: a world's manifest (what world.json held) in the database (F-73, ADR-0035).
-- Title and tagline, genre and tone, perspective and the table's systems: what the host reads to run
-- the world. The name is the world's slug; the title also lives in worlds.title.

alter table world_lore.worlds
  add column manifest jsonb check (manifest is null or (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 65536));

create function world_lore.save_world_manifest(p_world uuid, p_manifest jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_manifest) is distinct from 'object' then
    raise exception 'a manifest is a json object' using errcode = '22023';
  end if;
  update world_lore.worlds
     set manifest = p_manifest,
         title = coalesce(nullif(left(p_manifest ->> 'title', 200), ''), title)
   where id = p_world;
end $$;

revoke execute on function world_lore.save_world_manifest(uuid, jsonb) from public, anon;
grant execute on function world_lore.save_world_manifest(uuid, jsonb) to authenticated, app_rw;
