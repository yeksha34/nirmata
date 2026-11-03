-- 016 vn_content: a visual novel's working copy (F-72, ADR-0035). The draft holds what the files held:
-- manifest.json (already here), adaptation.md and the compiled slides.json. Routes, scenes and the
-- publish path stay as they are; they are used when a visual novel is published, not while it is adapted.

alter table vn_content.vn_drafts
  add column adaptation_md text not null default '' check (octet_length(adaptation_md) <= 4194304),
  add column slides jsonb check (slides is null or (jsonb_typeof(slides) = 'object' and octet_length(slides::text) <= 4194304));

-- editing any of the three sends a ready visual novel back to draft
drop trigger vn_drafts_edit on vn_content.vn_drafts;
create trigger vn_drafts_edit before update of manifest, adaptation_md, slides on vn_content.vn_drafts
  for each row execute function vn_content.note_vn_draft_change();

grant update (adaptation_md, slides) on vn_content.vn_drafts to authenticated, app_rw;

-- Saves a visual novel's working copy, making the visual novel if it is new. A part left null is kept.
-- A new visual novel is pinned to the latest published version of the world's main line, so the world
-- has to be published once (import:world --publish) before it can be adapted.
create function vn_content.save_vn(
  p_world uuid, p_slug text, p_title text default null, p_tier text default null,
  p_manifest jsonb default null, p_adaptation_md text default null, p_slides jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_vn      uuid;
  v_version uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if p_manifest is not null and jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'a manifest is a json object' using errcode = '22023';
  end if;
  if p_slides is not null and jsonb_typeof(p_slides) <> 'object' then
    raise exception 'slides are a json object' using errcode = '22023';
  end if;

  select id into v_vn from vn_content.vns where world_id = p_world and slug = p_slug;
  if v_vn is null then
    select v.id into v_version
      from world_lore.world_versions v
      join world_lore.world_lines l on l.id = v.world_line_id and l.is_default
     where v.world_id = p_world and v.status_key = 'published'
     order by v.version_no desc limit 1;
    if v_version is null then
      raise exception 'publish the world before adapting it' using errcode = '23514';
    end if;
    v_vn := vn_content.create_vn(v_version, p_slug, coalesce(p_title, p_slug), coalesce(p_tier, 'medium'));
  elsif p_title is not null or p_tier is not null then
    update vn_content.vns
       set title = coalesce(p_title, title), tier_key = coalesce(p_tier, tier_key)
     where id = v_vn;
  end if;

  update vn_content.vn_drafts
     set manifest = coalesce(p_manifest, manifest),
         adaptation_md = coalesce(p_adaptation_md, adaptation_md),
         slides = coalesce(p_slides, slides)
   where vn_id = v_vn;
  return v_vn;
end $$;

revoke execute on function vn_content.save_vn(uuid, text, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function vn_content.save_vn(uuid, text, text, text, jsonb, text, jsonb) to authenticated, app_rw;
