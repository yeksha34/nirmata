-- 019: storage quota. The Supabase plan caps total storage, so the server asks before it uploads.
-- The limits are rows, not code: change them when the plan changes (as migration_owner).
create table assets.quota_limits (
  key         text primary key check (key = 'storage_bytes'),
  limit_bytes bigint not null check (limit_bytes > 0),
  warn_pct    int not null check (warn_pct between 1 and 100),
  block_pct   int not null check (block_pct between 1 and 100),
  check (warn_pct < block_pct)
);
select platform.open_lookup('assets.quota_limits');
-- free plan: about 1 GiB of file storage. Check your project's usage page and edit the row if it differs.
insert into assets.quota_limits values ('storage_bytes', 1073741824, 80, 95);

-- Where the project stands, counting every render held in Supabase storage. p_extra is an upload about to happen.
-- level: ok below warn_pct, warn from warn_pct, block from block_pct (the upload would reach it).
-- With p_notify, a warn or block level writes one 'quota.<level>' outbox event per level per day.
-- Server only: the totals cover every world.
create function assets.storage_status(p_extra bigint default 0, p_notify boolean default false)
returns table (used_bytes bigint, unknown_files bigint, limit_bytes bigint, used_pct numeric, level text)
language plpgsql security definer set search_path = '' as $$
declare
  v_q record;
  v_used bigint;
  v_unknown bigint;
  v_pct numeric;
  v_level text;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  if p_extra < 0 then
    raise exception 'p_extra must not be negative' using errcode = '22023';
  end if;
  select * into v_q from assets.quota_limits where key = 'storage_bytes';
  select coalesce(sum(r.bytes), 0), count(*) filter (where r.bytes is null)
    into v_used, v_unknown from assets.renders r where r.store = 'supabase';
  v_pct := round(((v_used + p_extra)::numeric * 100) / v_q.limit_bytes, 2);
  v_level := case when v_pct >= v_q.block_pct then 'block' when v_pct >= v_q.warn_pct then 'warn' else 'ok' end;
  if p_notify and v_level <> 'ok' then
    perform platform.emit('quota.' || v_level, null,
      jsonb_build_object('used_bytes', v_used, 'limit_bytes', v_q.limit_bytes, 'used_pct', v_pct),
      'quota:' || v_level || ':' || current_date::text);
  end if;
  return query select v_used, v_unknown, v_q.limit_bytes, v_pct, v_level;
end $$;

revoke execute on function assets.storage_status(bigint, boolean) from public, anon;
grant execute on function assets.storage_status(bigint, boolean) to authenticated, app_rw, service_role;
