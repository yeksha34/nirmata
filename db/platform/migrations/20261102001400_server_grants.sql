-- 014: the generation worker may run as service_role (through the API) as well as app_rw. It needs to see the
-- generation and assets schemas, and record renders. The server-only functions still check platform.is_server().
grant usage on schema generation, assets to service_role;
grant execute on function assets.record_render(uuid, uuid, text, uuid) to service_role;
