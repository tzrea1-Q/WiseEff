-- A surviving parameter can retain a deleted Value after the mixed approval
-- that originally removed it is erased. Its replacement provenance is the
-- audited erasure, with no copy of the removed request's mixed source proof.
do $$
declare original_proof text;
begin
  select pg_get_expr(conbin,conrelid) into original_proof from pg_constraint
    where conrelid='parameter_catalog.project_value_source_pins'::regclass
      and conname='project_value_source_pin_delete_proof_ck';
  if original_proof is null then raise exception 'Missing source pin delete proof constraint'; end if;
  alter table parameter_catalog.project_value_source_pins drop constraint project_value_source_pin_delete_proof_ck;
  execute format('alter table parameter_catalog.project_value_source_pins add constraint project_value_source_pin_delete_proof_ck check (((erased_request_audit_id is null and (%s)) or (value_state=''deleted'' and delete_request_id is null and erased_request_audit_id is not null and delete_proof=jsonb_build_object(''kind'',''definition-erasure'',''auditEventId'',erased_request_audit_id))) is true)',original_proof);
end;
$$;
