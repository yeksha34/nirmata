-- 001b: the only place that touches Supabase's auth schema. Run as the bootstrap login (postgres),
-- because migration_owner cannot be granted anything on auth (it belongs to supabase_admin).
-- Everything else gets the caller's id and claims from platform.uid() / platform.jwt().

-- The provider and released claims of one person's sign-ins. Owned by postgres, so it can read
-- auth.identities; callable only by migration_owner (our definer functions).
create function identity.user_idp_claims(p_user uuid)
returns table (provider text, identity_data jsonb)
language sql stable security definer set search_path = '' as $$
  select ai.provider, ai.identity_data from auth.identities ai where ai.user_id = p_user;
$$;
revoke all on function identity.user_idp_claims(uuid) from public;
grant execute on function identity.user_idp_claims(uuid) to migration_owner;
