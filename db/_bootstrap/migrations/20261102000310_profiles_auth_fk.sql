-- 003b: profiles.user_id -> auth.users. Run as postgres (migration_owner has no rights on auth).
alter table identity.profiles
  add constraint profiles_user_fk foreign key (user_id) references auth.users (id) on delete restrict;
