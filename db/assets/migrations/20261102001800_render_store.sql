-- 018: a render row records where its file lives, so the backend can serve it from any store.
-- store: 'supabase' = object in the vn-assets bucket, 'local' = file on the backend host, 'none' = bytes deleted (the row stays).
-- storage_path stays the one stable name; the backend maps it to the store (clients never see which one).
alter table assets.renders
  add column store            text not null default 'supabase' check (store in ('supabase', 'local', 'none')),
  add column content_type     text check (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  add column bytes            bigint check (bytes >= 0),
  add column sha256           text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column store_changed_at timestamptz not null default now();
create index renders_sha on assets.renders (world_id, sha256) where sha256 is not null;
create index renders_store on assets.renders (world_id, store);

-- immutable apart from the archive flag and the store location; size, hash and type may be filled in once
create or replace function assets.guard_render() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     or (to_jsonb(new) - 'archived_at' - 'archived_by' - 'store' - 'store_changed_at' - 'content_type' - 'bytes' - 'sha256')
        is distinct from
        (to_jsonb(old) - 'archived_at' - 'archived_by' - 'store' - 'store_changed_at' - 'content_type' - 'bytes' - 'sha256')
     or (old.content_type is not null and new.content_type is distinct from old.content_type)
     or (old.bytes        is not null and new.bytes        is distinct from old.bytes)
     or (old.sha256       is not null and new.sha256       is distinct from old.sha256) then
    raise exception 'a render is immutable apart from its archive flag and store' using errcode = '42501';
  end if;
  return new;
end $$;

-- record_render gains the store and file facts (all optional, so existing calls keep working)
drop function assets.record_render(uuid, uuid, text, uuid);
create function assets.record_render(
  p_asset uuid, p_spec uuid, p_path text, p_job uuid default null,
  p_store text default 'supabase', p_bytes bigint default null, p_sha256 text default null, p_content_type text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_a  record;
  v_id uuid;
begin
  select * into v_a from assets.assets where id = p_asset for update;
  if not found then
    raise exception 'unknown asset' using errcode = '23503';
  end if;
  if not ((select platform.is_server()) or (select membership.is_host(v_a.world_id))) then
    raise exception 'server or host only' using errcode = '42501';
  end if;
  if v_a.is_terminal then
    raise exception 'the asset is retired' using errcode = '23514';
  end if;
  if p_path not like v_a.world_id::text || '/%' then
    raise exception 'the file must live under the world folder' using errcode = '23514';
  end if;
  if p_store not in ('supabase', 'local') then
    raise exception 'a new render lives in supabase or local' using errcode = '23514';
  end if;
  insert into assets.renders (asset_id, world_id, spec_id, storage_path, job_id, store, bytes, sha256, content_type)
    values (p_asset, v_a.world_id, p_spec, p_path, p_job, p_store, p_bytes, p_sha256, p_content_type) returning id into v_id;
  perform platform.mark_system();
  update assets.assets set current_render_id = v_id,
         status_key = case when status_key in ('planned', 'generating') then 'ready' else status_key end
   where id = p_asset;
  perform platform.clear_actor();
  perform platform.emit('asset.rendered', v_id, jsonb_build_object('asset', p_asset, 'render', v_id), 'render:' || v_id::text);
  return v_id;
end $$;

-- moves a render between stores (upload, bring local, free space). The caller moved the bytes first.
-- 'none' (bytes deleted) is refused for the current render of an asset.
create function assets.set_render_store(
  p_render uuid, p_store text, p_bytes bigint default null, p_sha256 text default null, p_content_type text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_r record;
begin
  select * into v_r from assets.renders where id = p_render for update;
  if not found then
    raise exception 'unknown render' using errcode = '23503';
  end if;
  if not ((select platform.is_server()) or (select membership.is_host(v_r.world_id))) then
    raise exception 'server or host only' using errcode = '42501';
  end if;
  if p_store not in ('supabase', 'local', 'none') then
    raise exception 'unknown store %', p_store using errcode = '23514';
  end if;
  if p_store = 'none' and exists (select 1 from assets.assets where id = v_r.asset_id and current_render_id = p_render) then
    raise exception 'the current render of an asset must keep its file' using errcode = '23514';
  end if;
  update assets.renders
     set store = p_store, store_changed_at = now(),
         bytes = coalesce(bytes, p_bytes), sha256 = coalesce(sha256, p_sha256),
         content_type = coalesce(content_type, p_content_type)
   where id = p_render;
  perform platform.write_audit((select platform.uid()), v_r.world_id, 'render_store', 'render', p_render,
    jsonb_build_object('from', v_r.store, 'to', p_store));
  perform platform.emit('render.store_changed', p_render,
    jsonb_build_object('render', p_render, 'from', v_r.store, 'to', p_store), 'render-store:' || p_render::text || ':' || p_store);
end $$;

-- the views gain the store facts (columns are appended; the old ones keep their order)
create or replace view assets.v_asset_list with (security_invoker = true) as
select a.id as asset_id, a.world_id, a.vn_id, a.kind_key, a.name, a.status_key, s.label as status_label,
       a.current_spec_id, a.current_render_id, r.storage_path as current_path, a.updated_at,
       r.store as current_store
from assets.assets a
join assets.asset_statuses s on s.key = a.status_key
left join assets.renders r on r.id = a.current_render_id;

create or replace view assets.v_dataset_runs with (security_invoker = true) as
select r.id as render_id, r.asset_id, r.world_id, r.storage_path, r.archived_at, r.created_at,
       sp.spec_no, sp.positive, sp.negative, sp.seed, sp.steps, sp.cfg, sp.sampler, sp.scheduler,
       sp.width, sp.height,
       (select coalesce(jsonb_object_agg(f.tag, f.choice_key), '{}'::jsonb)
          from assets.render_feedback f where f.render_id = r.id) as feedback,
       r.store, r.bytes, r.sha256
from assets.renders r
join assets.asset_specs sp on sp.id = r.spec_id
where r.archived_at is not null;

-- bytes per world and store (the quota check sums the supabase rows); unknown_size counts files with no recorded size
create view assets.v_store_usage with (security_invoker = true) as
select world_id, store, count(*) as files, coalesce(sum(bytes), 0) as bytes, count(*) filter (where bytes is null) as unknown_size
from assets.renders
group by world_id, store;

revoke execute on function assets.record_render(uuid, uuid, text, uuid, text, bigint, text, text),
  assets.set_render_store(uuid, text, bigint, text, text) from public, anon;
grant execute on function assets.record_render(uuid, uuid, text, uuid, text, bigint, text, text),
  assets.set_render_store(uuid, text, bigint, text, text) to authenticated, app_rw, service_role;
grant select on assets.v_store_usage to authenticated, app_ro, app_rw;
