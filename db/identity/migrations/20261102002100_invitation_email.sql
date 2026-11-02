-- 021: the address a pending invitation was made for, looked up by its token. The server uses it to create the
-- invited person's account itself (no email is sent), after checking they hold the token. Server only.
create function identity.invitation_email(p_token text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not (select platform.is_server()) then
    raise exception 'server only' using errcode = '42501';
  end if;
  select i.invitee_email into v_email from identity.invitations i
   where i.token_hash = sha256(convert_to(p_token, 'UTF8'))
     and i.status_key = 'pending' and i.expires_at > now();
  return v_email;
end $$;

revoke execute on function identity.invitation_email(text) from public, anon;
grant execute on function identity.invitation_email(text) to authenticated, app_rw, service_role;
