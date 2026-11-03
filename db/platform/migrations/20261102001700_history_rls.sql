-- 017: platform.publish_status_history had no row level security (the baseline test found it). It is written by the
-- transition trigger (a definer function) and has no grants, so no policy is needed: RLS on with no policy denies everyone else.
alter table platform.publish_status_history enable row level security;
