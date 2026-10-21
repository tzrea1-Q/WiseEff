-- Separate-review member history has the same nullable account references as
-- direct administrator history. Only an actual deleted account may detach.
do $$
declare installed text; changed text;
begin
  select pg_get_functiondef('parameter_catalog.assert_member_removal_request()'::regprocedure) into strict installed;
  changed:=replace(installed,'declare','declare retained_actor_detach boolean := false;');
  changed:=replace(changed,E'begin\n',$body$begin
  if tg_op='UPDATE' then
    retained_actor_detach := (to_jsonb(new)-array['submitter_user_id','assigned_to_user_id','reviewer_user_id'])
        =(to_jsonb(old)-array['submitter_user_id','assigned_to_user_id','reviewer_user_id'])
      and (new.submitter_user_id is not distinct from old.submitter_user_id or
        (new.submitter_user_id is null and not exists(select 1 from public.users where id=old.submitter_user_id)))
      and (new.assigned_to_user_id is not distinct from old.assigned_to_user_id or
        (new.assigned_to_user_id is null and not exists(select 1 from public.users where id=old.assigned_to_user_id)))
      and (new.reviewer_user_id is not distinct from old.reviewer_user_id or
        (new.reviewer_user_id is null and not exists(select 1 from public.users where id=old.reviewer_user_id)));
  end if;
$body$);
  changed:=replace(changed,'if request_row.submitter_user_id is null or request_row.assigned_to_user_id is null',
    'if (not retained_actor_detach and (request_row.submitter_user_id is null or request_row.assigned_to_user_id is null))');
  changed:=replace(changed,'and audit.actor_user_id=request_row.reviewer_user_id',
    'and (audit.actor_user_id=request_row.reviewer_user_id or (retained_actor_detach and request_row.reviewer_user_id is null and audit.actor_user_id is null))');
  if position('if (not retained_actor_detach and (' in changed)=0 or position('and audit.actor_user_id is null)' in changed)=0 then
    raise exception 'Reviewed member historical actor markers are unavailable';
  end if;
  execute changed;
end $$;
