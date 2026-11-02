-- 004b accept_invitation. Lives in identity but needs membership, so it is ordered after 004.
-- One transaction: check the token, confirm age, mark the invitation accepted, grant the role.
-- Seating a player in a story (invitations.story_id) is added with story_run.

create function identity.accept_invitation(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text := lower(auth.jwt() ->> 'email');
  inv     identity.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'sign-in required' using errcode = '42501';
  end if;

  -- single use by construction: only a pending, unexpired row is selected, and it is locked
  select * into inv from identity.invitations
   where token_hash = sha256(convert_to(p_token, 'UTF8'))
     and status_key = 'pending' and expires_at > now()
   for update;
  if not found then
    raise exception 'invitation is not valid' using errcode = 'P0002';
  end if;
  if inv.invitee_email is distinct from v_email then
    raise exception 'invitation is for another address' using errcode = '42501';
  end if;

  perform identity.ensure_profile();
  if not identity.confirm_age_from_idp() then
    -- the invitation stays pending; the client shows the attestation step, then retries
    raise exception 'age_confirmation_required' using errcode = 'P0001';
  end if;

  perform platform.mark_system();
  update identity.invitations
     set status_key = 'accepted', accepted_by = v_uid, accepted_at = now()
   where id = inv.id;
  perform platform.clear_actor();

  if inv.role_key = 'host' and inv.world_id is null then
    update identity.profiles set can_found_worlds = true where user_id = v_uid;   -- platform host invitation
  else
    perform membership._add_member(inv.world_id, v_uid, inv.role_key, inv.invited_by);
  end if;

  perform platform.write_audit(v_uid, inv.world_id, 'invite_accept', 'invitation', inv.id,
                               jsonb_build_object('role', inv.role_key));
  return jsonb_build_object('world_id', inv.world_id, 'role', inv.role_key);
end $$;

revoke execute on function identity.accept_invitation(text) from public, anon;
grant execute on function identity.accept_invitation(text) to authenticated, app_rw;
