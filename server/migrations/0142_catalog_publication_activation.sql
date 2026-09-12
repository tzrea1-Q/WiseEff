-- Catalog publication activation helpers (CP-05).
--
-- catalog_synchronizer_role cannot UPDATE publication_jobs (coordinator owns
-- general job execution). mark_job_activated is SECURITY DEFINER so the
-- kernel-owned activation transaction can CAS status=active on the expected
-- fencing token without granting generic job UPDATE to the synchronizer.
--
-- After any catalog_activation_receipts row exists, catalog_state may only
-- point at a release that already has a Receipt in the same transaction.
-- Closing publication_enabled does not drop receipts and does not reopen
-- unauthorized legacy bootstrap/advance.
--
-- No second current pointer. 0137-0141 bytes are not modified.

select pg_catalog.pg_advisory_lock(140014000142);

create function catalog_publication.mark_job_activated(
  job_id text,
  expected_fence bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, catalog_publication
as $$
declare
  updated integer;
  actual_fence bigint;
  actual_status text;
begin
  update catalog_publication.publication_jobs
     set status = 'active',
         last_error_class = null,
         last_error_reason = null,
         updated_at = now()
   where id = mark_job_activated.job_id
     and fencing_token = mark_job_activated.expected_fence
     and status in ('queued', 'running', 'active');

  get diagnostics updated = row_count;
  if updated = 1 then
    return;
  end if;

  select fencing_token, status
    into actual_fence, actual_status
    from catalog_publication.publication_jobs
   where id = mark_job_activated.job_id;

  raise exception using
    errcode = 'PCA06',
    message = 'publication job fencing token mismatch or job is not activatable',
    detail = format(
      'PCAT-PUB-JOB-FENCE expected_fence=%s actual_fence=%s status=%s',
      mark_job_activated.expected_fence,
      coalesce(actual_fence::text, 'missing'),
      coalesce(actual_status, 'missing')
    );
end;
$$;

comment on function catalog_publication.mark_job_activated(text, bigint) is
  'Synchronizer-callable SECURITY DEFINER CAS: set publication_jobs.status=active when fencing_token matches. Coordinator still owns generic job execution UPDATE.';

create function parameter_catalog.assert_publication_regime_pointer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, parameter_catalog
as $$
begin
  if exists (select 1 from parameter_catalog.catalog_activation_receipts) then
    if not exists (
      select 1
      from parameter_catalog.catalog_activation_receipts receipt
      where receipt.release_id = new.current_catalog_release_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'legacy catalog pointer advance is forbidden after an activation receipt exists',
        detail = 'PCAT-PUB-REGIME-POINTER',
        constraint = 'catalog_state_publication_regime_receipt_ck';
    end if;
  end if;
  return new;
end;
$$;

comment on function parameter_catalog.assert_publication_regime_pointer() is
  'Commit-layer guard: once any Receipt exists, catalog_state.current must be a release that already has a Receipt. publication_enabled does not reopen legacy writers.';

create trigger catalog_state_publication_regime
before insert or update of current_catalog_release_id
on parameter_catalog.catalog_state
for each row execute function parameter_catalog.assert_publication_regime_pointer();

alter function catalog_publication.mark_job_activated(text, bigint)
  owner to catalog_migration_owner;
alter function parameter_catalog.assert_publication_regime_pointer()
  owner to catalog_migration_owner;

revoke all on function catalog_publication.mark_job_activated(text, bigint)
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role;

revoke all on function parameter_catalog.assert_publication_regime_pointer()
  from public, catalog_synchronizer_role, parameter_governance_writer_role,
  catalog_publication_coordinator_role, catalog_baseline_reader_role,
  catalog_verification_writer_role, catalog_verifier_role;

grant execute on function catalog_publication.mark_job_activated(text, bigint)
  to catalog_synchronizer_role;

select pg_catalog.pg_advisory_unlock(140014000142);
