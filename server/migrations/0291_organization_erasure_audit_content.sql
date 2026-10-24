-- Descriptive JSON is not an operator identity. Use the independently durable
-- global proof or original Organization intent, including across retries.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('parameter_catalog.minimal_organization_erasure_audit(jsonb,text,jsonb)'::regprocedure) into strict installed;
  changed:=replace(installed,
    $old$actor:=coalesce(proof.erased_by,p_row#>>'{metadata,actorUserId}',p_row->>'actor_user_id');$old$,
    $new$actor:=coalesce(proof.erased_by,(select e.actor_user_id from public.organization_erasures e where e.target_organization_id=p_org));$new$);
  if changed=installed then raise exception 'Organization provenance actor boundary unavailable'; end if;
  execute changed;
end $$;

-- The ordinary history trigger preserves names after FK detachment. Only the
-- exact authorized compaction may clear them, after that trigger has run.
create function parameter_catalog.finish_organization_erasure_audit() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$
declare intent public.organization_erasures%rowtype; minimal jsonb;
begin
  select * into intent from public.organization_erasures where
    id=current_setting('wiseeff.organization_erasure_id',true) and status='running' and stage in ('management','finalize')
    and lease_owner=current_setting('wiseeff.organization_erasure_lease',true) and lease_expires_at>clock_timestamp();
  if found then
    minimal:=parameter_catalog.minimal_organization_erasure_audit(to_jsonb(old),intent.target_organization_id,intent.counts);
    if to_jsonb(new)-'historical_attribution'=minimal-'historical_attribution' then new.historical_attribution:='{}'::jsonb; end if;
  end if;
  return new;
end $$;
alter function parameter_catalog.finish_organization_erasure_audit() owner to catalog_migration_owner;
revoke all on function parameter_catalog.finish_organization_erasure_audit() from public;
create trigger zzz_organization_erasure_audit before update on public.audit_events
  for each row execute function parameter_catalog.finish_organization_erasure_audit();
