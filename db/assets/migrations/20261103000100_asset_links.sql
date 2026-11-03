-- asset links: clothes, adornment and object asset kinds and the character / CG locks.
-- Content-neutral. Clothes and adornments are locked to exactly one character, except the unclad base
-- state (a name that is, or ends in, 'naked'). Objects link to characters and/or CGs. A link names a
-- character by card name (soft reference: world_lore.cards) or a CG asset of the same world.

insert into assets.asset_kinds (key, label, sort_order) values
  ('clothes', 'Clothes', 40), ('adornment', 'Adornment', 50), ('object', 'Object', 60);

create table assets.asset_links (
  id             uuid primary key default gen_random_uuid(),
  world_id       uuid not null,
  asset_id       uuid not null,
  character_name text check (character_name ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$'),
  cg_asset_id    uuid,
  created_at     timestamptz not null default now(),
  foreign key (asset_id, world_id) references assets.assets (id, world_id) on delete cascade,
  foreign key (cg_asset_id, world_id) references assets.assets (id, world_id) on delete cascade,
  check ((character_name is null) <> (cg_asset_id is null))
);
create unique index asset_links_character on assets.asset_links (asset_id, character_name) where character_name is not null;
create unique index asset_links_cg on assets.asset_links (asset_id, cg_asset_id) where cg_asset_id is not null;
create index asset_links_by_character on assets.asset_links (world_id, character_name) where character_name is not null;

-- true for the unlocked base state
create function assets.is_unclad_base(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(p_name) = 'naked' or lower(p_name) like '%\_naked' escape '\'
$$;

-- replaces the links of one asset, applying the lock rules for its kind
create function assets.set_links(p_asset uuid, p_characters text[], p_cgs uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_a   assets.assets%rowtype;
  v_uid uuid := (select platform.uid());
  v_chars text[] := coalesce(p_characters, '{}');
  v_cgs   uuid[] := coalesce(p_cgs, '{}');
begin
  select * into v_a from assets.assets where id = p_asset;
  if not found or not (select membership.is_host(v_a.world_id)) then
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

-- assets that break a lock rule (a planned asset may sit here until its links are set)
create view assets.v_asset_link_issues with (security_invoker = true) as
select a.id as asset_id, a.world_id, a.kind_key, a.name,
       case when a.kind_key in ('clothes', 'adornment') then 'needs exactly one character'
            else 'needs a character or a CG' end as issue
from assets.assets a
where not a.is_terminal
  and ((a.kind_key in ('clothes', 'adornment') and not assets.is_unclad_base(a.name)
        and (select count(*) from assets.asset_links l where l.asset_id = a.id) <> 1)
    or (a.kind_key = 'object'
        and not exists (select 1 from assets.asset_links l where l.asset_id = a.id)));

-- the list gains the links (columns appended; the old ones keep their order)
create or replace view assets.v_asset_list with (security_invoker = true) as
select a.id as asset_id, a.world_id, a.vn_id, a.kind_key, a.name, a.status_key, s.label as status_label,
       a.current_spec_id, a.current_render_id, r.storage_path as current_path, a.updated_at,
       r.store as current_store,
       (select coalesce(array_agg(l.character_name order by l.character_name), '{}')
          from assets.asset_links l where l.asset_id = a.id and l.character_name is not null) as link_characters,
       (select coalesce(array_agg(l.cg_asset_id), '{}')
          from assets.asset_links l where l.asset_id = a.id and l.cg_asset_id is not null) as link_cgs
from assets.assets a
join assets.asset_statuses s on s.key = a.status_key
left join assets.renders r on r.id = a.current_render_id;

alter table assets.asset_links enable row level security;
create policy asset_links_read on assets.asset_links for select to authenticated
  using ((select membership.is_member(world_id)));
revoke all on assets.asset_links from public, anon, authenticated;
grant select on assets.asset_links to authenticated, app_ro, app_rw;
grant select on assets.v_asset_link_issues, assets.v_asset_list to authenticated, app_ro, app_rw;

revoke execute on function assets.set_links(uuid, text[], uuid[]), assets.is_unclad_base(text) from public, anon;
grant execute on function assets.set_links(uuid, text[], uuid[]) to authenticated, app_rw;
grant execute on function assets.is_unclad_base(text) to authenticated, app_rw, app_ro;
