-- 001b: what migration_owner needs from Supabase's auth schema. Run as the bootstrap login (postgres).
-- Foreign keys to auth.users need REFERENCES; definer functions owned by migration_owner read
-- auth.identities and call auth.uid() / auth.jwt().
grant usage on schema auth to migration_owner;
grant references on auth.users to migration_owner;
grant select on auth.identities to migration_owner;
grant execute on function auth.uid() to migration_owner;
grant execute on function auth.jwt() to migration_owner;
