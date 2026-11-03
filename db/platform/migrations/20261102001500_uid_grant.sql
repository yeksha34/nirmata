-- 015: platform.uid() and platform.jwt() were revoked from authenticated by the blanket revoke at the end of 002,
-- so every policy and view that reads the caller failed for signed-in people. 002 now grants them after the revoke;
-- this file repairs a database that already ran the old 002.
grant execute on function platform.jwt(), platform.uid() to authenticated, app_rw, app_ro, service_role;
