-- Character prep (ADR-0035): what asset generation needs to know about a character, written once by the
-- adaptation agent from the character card, before any chapter is adapted. Content-neutral.
-- The prep keeps the card's characterization as generation input (a base look, expressions, outfits and
-- adornments as tags); the card itself stays in world_lore. `card_hash` records which draft of the card
-- the prep was made from, so a card edited since then shows as out of date.

create table assets.character_prep (
  world_id       uuid not null,                       -- soft reference: world_lore.worlds
  character_name text not null check (character_name ~ '^[^\s/\\]{1,64}$'),   -- the card's name (soft reference)
  card_id        uuid,                                -- soft reference: world_lore.cards
  base_positive  text not null default '' check (length(base_positive) <= 4000),
  base_negative  text not null default '' check (length(base_negative) <= 2000),
  notes          text not null default '' check (length(notes) <= 4000),
  card_hash      text check (card_hash is null or length(card_hash) <= 128),
  prepared_by    uuid not null references identity.profiles (user_id) on delete restrict,
  prepared_at    timestamptz not null default now(),
  primary key (world_id, character_name)
);

create table assets.character_expressions (
  world_id       uuid not null,
  character_name text not null,
  expression     text not null check (expression ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  tags           text not null default '' check (length(tags) <= 2000),
  position       int  not null default 0,
  primary key (world_id, character_name, expression),
  foreign key (world_id, character_name) references assets.character_prep (world_id, character_name) on delete cascade
);

create table assets.character_outfits (
  world_id       uuid not null,
  character_name text not null,
  kind_key       text not null check (kind_key in ('clothes', 'adornment')),
  name           text not null check (name ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  tags           text not null default '' check (length(tags) <= 2000),
  position       int  not null default 0,
  primary key (world_id, character_name, kind_key, name),
  foreign key (world_id, character_name) references assets.character_prep (world_id, character_name) on delete cascade
);

-- Prep carries tags taken from the whole card, host-only Secrets included, so only an author reads it.
alter table assets.character_prep enable row level security;
alter table assets.character_expressions enable row level security;
alter table assets.character_outfits enable row level security;
create policy character_prep_author on assets.character_prep for select to authenticated
  using ((select membership.is_author(world_id)));
create policy character_expressions_author on assets.character_expressions for select to authenticated
  using ((select membership.is_author(world_id)));
create policy character_outfits_author on assets.character_outfits for select to authenticated
  using ((select membership.is_author(world_id)));
-- no write policy: prep is written only by the functions below
revoke all on assets.character_prep, assets.character_expressions, assets.character_outfits
  from public, anon, authenticated;
grant select on assets.character_prep, assets.character_expressions, assets.character_outfits
  to authenticated, app_ro, app_rw;

-- Replaces a character's prep, its expressions and its outfits in one step.
-- p_expressions: [{"expression": "calm", "tags": "..."}]; p_outfits: [{"kind": "clothes", "name": "robe", "tags": "..."}]
create function assets.save_character_prep(
  p_world uuid, p_name text, p_base_positive text, p_base_negative text, p_notes text,
  p_card_hash text, p_expressions jsonb default '[]', p_outfits jsonb default '[]'
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select platform.uid());
  v_card uuid;
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_expressions, '[]')) <> 'array' or jsonb_typeof(coalesce(p_outfits, '[]')) <> 'array' then
    raise exception 'expressions and outfits must be lists' using errcode = '23514';
  end if;
  select c.id into v_card from world_lore.cards c
   where c.world_id = p_world and c.kind = 'character' and lower(c.slug) = lower(regexp_replace(p_name, '\s+', '-', 'g'));

  insert into assets.character_prep (world_id, character_name, card_id, base_positive, base_negative, notes, card_hash, prepared_by)
    values (p_world, p_name, v_card, coalesce(p_base_positive, ''), coalesce(p_base_negative, ''), coalesce(p_notes, ''),
            p_card_hash, v_uid)
    on conflict (world_id, character_name) do update
      set card_id = excluded.card_id, base_positive = excluded.base_positive, base_negative = excluded.base_negative,
          notes = excluded.notes, card_hash = excluded.card_hash, prepared_by = excluded.prepared_by, prepared_at = now();

  delete from assets.character_expressions where world_id = p_world and character_name = p_name;
  insert into assets.character_expressions (world_id, character_name, expression, tags, position)
    select p_world, p_name, e.v ->> 'expression', coalesce(e.v ->> 'tags', ''), (e.ord - 1)::int
      from jsonb_array_elements(coalesce(p_expressions, '[]')) with ordinality as e(v, ord);

  delete from assets.character_outfits where world_id = p_world and character_name = p_name;
  insert into assets.character_outfits (world_id, character_name, kind_key, name, tags, position)
    select p_world, p_name, o.v ->> 'kind', o.v ->> 'name', coalesce(o.v ->> 'tags', ''), (o.ord - 1)::int
      from jsonb_array_elements(coalesce(p_outfits, '[]')) with ordinality as o(v, ord);

  perform platform.write_audit(v_uid, p_world, 'character_prep_save', 'character_prep', null,
    jsonb_build_object('character', p_name));
end $$;

create function assets.remove_character_prep(p_world uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select membership.is_author(p_world)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  delete from assets.character_prep where world_id = p_world and character_name = p_name;
  perform platform.write_audit((select platform.uid()), p_world, 'character_prep_remove', 'character_prep', null,
    jsonb_build_object('character', p_name));
end $$;

revoke execute on function assets.save_character_prep(uuid, text, text, text, text, text, jsonb, jsonb) from public, anon;
revoke execute on function assets.remove_character_prep(uuid, text) from public, anon;
grant execute on function assets.save_character_prep(uuid, text, text, text, text, text, jsonb, jsonb) to authenticated, app_rw;
grant execute on function assets.remove_character_prep(uuid, text) to authenticated, app_rw;

-- Takes an asset out of the plan. A planned asset that was never generated is deleted (so its name is
-- free again); anything with a spec or a render is retired and stays in the dataset's history.
create function assets.unplan_asset(p_asset uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_a assets.assets%rowtype;
  v_uid uuid := (select platform.uid());
begin
  select * into v_a from assets.assets where id = p_asset for update;
  if not found or not (select membership.is_author(v_a.world_id)) then
    raise exception 'author only' using errcode = '42501';
  end if;
  if v_a.status_key = 'planned'
     and not exists (select 1 from assets.asset_specs where asset_id = p_asset)
     and not exists (select 1 from assets.renders where asset_id = p_asset) then
    update assets.assets set current_spec_id = null, current_render_id = null where id = p_asset;
    delete from assets.assets where id = p_asset;
    perform platform.write_audit(v_uid, v_a.world_id, 'asset_unplan', 'asset', null,
      jsonb_build_object('kind', v_a.kind_key, 'name', v_a.name, 'result', 'deleted'));
    return 'deleted';
  end if;
  update assets.assets set status_key = 'retired' where id = p_asset;     -- the transition trigger checks the move
  perform platform.write_audit(v_uid, v_a.world_id, 'asset_unplan', 'asset', p_asset,
    jsonb_build_object('kind', v_a.kind_key, 'name', v_a.name, 'result', 'retired'));
  return 'retired';
end $$;

revoke execute on function assets.unplan_asset(uuid) from public, anon;
grant execute on function assets.unplan_asset(uuid) to authenticated, app_rw;
