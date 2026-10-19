-- Every derived receipt must cover the exact frozen Binding cohort, not merely
-- an equally-sized set of otherwise valid history rows.
create function parameter_catalog.assert_source_revision_cohort_receipt()
returns trigger language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare r public.project_parameter_value_change_requests%rowtype;
begin
  select * into r from public.project_parameter_value_change_requests where id=new.id;
  if r.request_kind<>'source_revision' or r.status<>'approved' then return null; end if;
  if exists(select 1 from jsonb_array_elements(r.applied_source_result->'results') item
    where item->>'kind'<>'created' and not exists(
      select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen
        where frozen->>'bindingId'=item->>'bindingId' and frozen->>'oldValueId'=item->>'oldValueId'))
    or exists(select 1 from jsonb_array_elements(r.source_revision_context->'cohort') frozen
      where not exists(select 1 from jsonb_array_elements(r.applied_source_result->'results') item
        where item->>'kind'<>'created' and frozen->>'bindingId'=item->>'bindingId'
          and frozen->>'oldValueId'=item->>'oldValueId')) then
    raise exception using errcode='23514',message='Whole-source receipt does not cover the frozen Binding cohort';
  end if;
  return null;
end $$;
create constraint trigger project_parameter_source_revision_cohort_receipt_ck
  after insert or update on public.project_parameter_value_change_requests
  deferrable initially deferred for each row when(new.request_kind='source_revision')
  execute function parameter_catalog.assert_source_revision_cohort_receipt();
alter function parameter_catalog.assert_source_revision_cohort_receipt() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_source_revision_cohort_receipt() from public;
