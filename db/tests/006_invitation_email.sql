-- pgTAP: finding an invitation's address by its token (migration 021). Needs migrations 001-021 and pgtap.
-- Run in the SQL editor as postgres (it rolls back and leaves nothing behind), or: supabase test db
begin;
select * from no_plan();

create schema tx;
grant usage on schema tx to public;
create table tx.out (n int generated always as identity primary key, line text);
grant all on tx.out to public;
create table tx.tok (t text);
grant all on tx.tok to public;
create function tx.act(p_user uuid default null, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
end $$;
grant execute on function tx.act(uuid, text) to public;

select tx.act(null, 'service_role');
insert into tx.tok select identity.create_host_invitation('Invitee@Example.test');

insert into tx.out (line) select is(identity.invitation_email((select t from tx.tok)), 'invitee@example.test', 'the token finds the address');
insert into tx.out (line) select is(identity.invitation_email('not-a-real-token'), null, 'a wrong token finds nothing');

reset role;
update identity.invitations set expires_at = now() - interval '1 minute' where invitee_email = 'invitee@example.test';
select tx.act(null, 'service_role');
insert into tx.out (line) select is(identity.invitation_email((select t from tx.tok)), null, 'an expired invitation finds nothing');

select tx.act(null, 'authenticated');
insert into tx.out (line) select throws_ok(format('select identity.invitation_email(%L)', 'x'), '42501', null, 'a person cannot look up invitations');
select tx.act(null, 'anon');
insert into tx.out (line) select throws_ok(format('select identity.invitation_email(%L)', 'x'), '42501', null, 'anon cannot call it');

reset role;
select count(*) filter (where line like 'ok%') as passed, count(*) filter (where line like 'not ok%') as failed,
       coalesce(string_agg(line, chr(10) order by n) filter (where line like 'not ok%'), 'all passed') as failures
  from tx.out;
rollback;
