-- The existing immutable activation receipt is the proof of global absence.
-- Its guard runs under the installer's exclusive Catalog pointer lock. Locking
-- the permanent Definition also serializes the FK locks of new references.
create function parameter_catalog.assert_zero_project_replacement_activation()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog,public as $$
declare proof record; retiring record;
begin
  if new.kind<>'online-publication' then return new; end if;
  for proof in select preview.* from parameter_catalog.definition_replacement_previews preview
    where preview.candidate_id=new.candidate_id and jsonb_array_length(preview.manifest)=0
    order by preview.old_definition_id,preview.id
  loop
    perform 1 from parameter_catalog.parameter_definitions where id=proof.old_definition_id for update;
    if not found or proof.preview_catalog_release_id is distinct from new.predecessor_release_id
      or proof.preview_catalog_release_digest is distinct from new.predecessor_release_digest
      or proof.expires_at<=transaction_timestamp()
      or not exists(select 1 from public.users administrator join public.user_role_bindings role on role.user_id=administrator.id
        and role.organization_id=administrator.organization_id where administrator.id=proof.approval_principal_id
        and administrator.organization_id=proof.organization_id and administrator.is_active
        and role.role_id='platform-admin' and role.project_id is null)
      or not exists(select 1 from public.users administrator join public.user_role_bindings role on role.user_id=administrator.id
        and role.organization_id=administrator.organization_id where administrator.id=new.actor_principal_id
        and administrator.organization_id=proof.organization_id and administrator.is_active
        and role.role_id='platform-admin' and role.project_id is null)
      or not exists(select 1 from parameter_catalog.parameter_definitions definition
        join parameter_catalog.catalog_release_definition_heads head on head.definition_id=definition.id
        where definition.id=proof.new_definition_id and definition.subject_id=proof.new_subject_id
          and definition.property_key=proof.new_property_key and head.release_id=new.release_id and head.revision_id=proof.new_revision_id)
      or exists(select 1 from parameter_catalog.current_project_parameter_bindings binding where binding.definition_id=proof.old_definition_id) then
      raise exception using errcode='PCA09',message='Zero-project correction requires current platform authority and no global current references';
    end if;
  end loop;
  -- Independent retirement must recheck the actual global references, including
  -- references created after a successful zero-project correction.
  for retiring in select distinct replacement.old_definition_id
    from parameter_catalog.definition_replacements replacement
    join parameter_catalog.catalog_release_definition_heads head on head.definition_id=replacement.old_definition_id and head.release_id=new.release_id
    join parameter_catalog.definition_revisions revision on revision.id=head.revision_id
    join parameter_catalog.catalog_release_definition_heads previous on previous.definition_id=head.definition_id and previous.release_id=new.predecessor_release_id
    join parameter_catalog.definition_revisions previous_revision on previous_revision.id=previous.revision_id
    where replacement.status='completed' and revision.content->>'lifecycle'='retired'
      and coalesce(previous_revision.content->>'lifecycle','active')<>'retired'
    order by replacement.old_definition_id
  loop
    perform 1 from parameter_catalog.parameter_definitions where id=retiring.old_definition_id for update;
    if exists(select 1 from parameter_catalog.current_project_parameter_bindings binding where binding.definition_id=retiring.old_definition_id) then
      raise exception using errcode='PCA09',message='Replacement retirement requires no global current references';
    end if;
  end loop;
  return new;
end $$;
alter function parameter_catalog.assert_zero_project_replacement_activation() owner to catalog_migration_owner;
revoke all on function parameter_catalog.assert_zero_project_replacement_activation() from public;
create trigger zero_project_replacement_activation before insert on parameter_catalog.catalog_activation_receipts
for each row execute function parameter_catalog.assert_zero_project_replacement_activation();
