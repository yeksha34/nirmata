-- asset links, part 2: migration 022 renamed membership.is_host to is_author, so set_links (first written
-- with is_host) is replaced here for databases that already applied the first file.

create or replace function assets.set_links(p_asset uuid, p_characters text[], p_cgs uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a   assets.assets%rowtype;
  v_uid uuid := (select platform.uid());
  v_chars text[] := coalesce(p_characters, '{}');
  v_cgs   uuid[] := coalesce(p_cgs, '{}');
begin
  select * into v_a from assets.assets where id = p_asset;
  if not found or not (select membership.is_author(v_a.world_id)) then
    raise exception 'host only' using errcode = '42501';
  end if;
  if v_a.kind_key not in ('clothes', 'adornment', 'object') then
    raise exception 'only clothes, adornments and objects carry links' using errcode = '23514';
  end if;
  if v_a.kind_key in ('clothes', 'adornment') then
    if cardinality(v_cgs) > 0 then
      raise exception '% is locked to a character, not a CG', v_a.kind_key using errcode = '23514';
    end if;
    if assets.is_unclad_base(v_a.name) then
      if cardinality(v_chars) > 1 then
        raise exception 'the unclad base takes at most one character' using errcode = '23514';
      end if;
    elsif cardinality(v_chars) <> 1 then
      raise exception '% must be locked to exactly one character', v_a.kind_key using errcode = '23514';
    end if;
  elsif cardinality(v_chars) + cardinality(v_cgs) = 0 then
    raise exception 'an object must link to a character or a CG' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_cgs) c
             where not exists (select 1 from assets.assets g
                               where g.id = c and g.world_id = v_a.world_id and g.kind_key = 'cg')) then
    raise exception 'a linked CG must be a cg asset of this world' using errcode = '23514';
  end if;
  delete from assets.asset_links where asset_id = p_asset;
  insert into assets.asset_links (world_id, asset_id, character_name)
    select v_a.world_id, p_asset, c from unnest(v_chars) c;
  insert into assets.asset_links (world_id, asset_id, cg_asset_id)
    select v_a.world_id, p_asset, c from unnest(v_cgs) c;
  perform platform.write_audit(v_uid, v_a.world_id, 'asset_links_set', 'asset', p_asset,
    jsonb_build_object('characters', v_chars, 'cgs', v_cgs));
end $$;
