-- 012 storage and realtime. Run as the bootstrap login (postgres): Storage and Realtime objects belong to Supabase.
-- No public bucket exists. Files are private; people get short-lived signed URLs after passing these policies.
-- Path: <world_id>/<vn_id | _shared>/<kind>/<name>. Renders are written by the server with the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vn-assets', 'vn-assets', false, 20971520,  array['image/png', 'image/jpeg', 'image/webp']),
  ('exports',   'exports',   false, 524288000, array['application/zip', 'application/json'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy nirmata_assets_read on storage.objects for select to authenticated
  using (bucket_id = 'vn-assets' and (select membership.can_read_path(name)));
create policy nirmata_assets_write_host on storage.objects for insert to authenticated
  with check (bucket_id = 'vn-assets' and (select membership.can_write_path(name)));
create policy nirmata_exports_read_host on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (select membership.can_write_path(name)));

-- private broadcast channels only; clients can listen, never send (the server sends)
create policy nirmata_channels_listen on realtime.messages for select to authenticated
  using ((select membership.can_listen_topic((select realtime.topic()))));
