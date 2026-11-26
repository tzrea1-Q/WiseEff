-- Only the synchronizer can certify a compiled, materialized release. The
-- coordinator may append candidate artifacts, but cannot provide this proof.
create table catalog_publication.checkpoint_epoch (
  singleton boolean primary key check (singleton),
  generation bigint not null
);
alter table catalog_publication.checkpoint_epoch owner to catalog_migration_owner;
insert into catalog_publication.checkpoint_epoch values (true, 1);
revoke all on catalog_publication.checkpoint_epoch from public;
grant select on catalog_publication.checkpoint_epoch to catalog_synchronizer_role;

create table catalog_publication.activation_checkpoints (
  artifact_id text not null,
  artifact_digest text not null,
  version text not null,
  generation bigint not null,
  artifact_checksum text not null,
  compiled_model_digest text not null,
  toolchain_digest text not null,
  materialization_fingerprint text not null,
  proof_bytes bytea not null,
  proof_checksum text not null,
  -- The physical compact artifact already contains exactly the target node.
  target_bytes bytea,
  target_checksum text not null,
  primary key (artifact_id, version),
  foreign key (artifact_id, artifact_digest) references catalog_publication.release_artifacts(id, artifact_digest)
    on update cascade on delete cascade
);
alter table catalog_publication.activation_checkpoints owner to catalog_migration_owner;
revoke all on catalog_publication.activation_checkpoints from public;
grant select, insert on catalog_publication.activation_checkpoints to catalog_synchronizer_role;
grant insert on catalog_publication.preview_snapshots to catalog_synchronizer_role;

-- Readers capture an epoch in their read-only snapshot. Under the pointer lock
-- writers lock the same row and compare it again before installing the result.
create function catalog_publication.lock_checkpoint_epoch() returns bigint
language sql volatile security definer set search_path = pg_catalog as $$
  select generation from catalog_publication.checkpoint_epoch where singleton for share
$$;
alter function catalog_publication.lock_checkpoint_epoch() owner to catalog_migration_owner;
revoke all on function catalog_publication.lock_checkpoint_epoch() from public;
grant execute on function catalog_publication.lock_checkpoint_epoch() to catalog_synchronizer_role;

-- Erasure may rewrite an ancestor of many compact artifacts. Clear all
-- derived payloads across all versions, including proofs inserted earlier
-- in this same transaction. A logical counter remains valid after restore.
-- Rollback restores the previous epoch and all proofs.
create function catalog_publication.invalidate_activation_checkpoints() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  update catalog_publication.checkpoint_epoch set generation = generation + 1 where singleton;
  delete from catalog_publication.activation_checkpoints;
  return null;
end
$$;
alter function catalog_publication.invalidate_activation_checkpoints() owner to catalog_migration_owner;
revoke all on function catalog_publication.invalidate_activation_checkpoints() from public;
create trigger invalidate_artifact_activation_checkpoints after update or delete
  on catalog_publication.release_artifacts for each row execute function catalog_publication.invalidate_activation_checkpoints();
create trigger invalidate_release_activation_checkpoints after update or delete
  on parameter_catalog.catalog_releases for each row execute function catalog_publication.invalidate_activation_checkpoints();
create trigger invalidate_materialized_activation_checkpoints after update or delete
  on parameter_catalog.catalog_materializations for each row execute function catalog_publication.invalidate_activation_checkpoints();

-- An older API inherits the predecessor's compiler string. Its worker only
-- checks the candidate capability revision, so prevent it from approving a
-- v2 artifact as a release understood by the legacy installer.
create function catalog_publication.check_candidate_install_contract() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if exists (
    select from catalog_publication.release_artifacts a where a.id = new.artifact_id and (
      (a.toolchain->>'sourceFormat' is not distinct from 'wiseeff-catalog-release@2')
        <> (new.capability_contract->>'revision' is not distinct from 'catalog-capability/v9')
      or (a.toolchain->>'sourceFormat' = 'wiseeff-catalog-release@2'
        and a.toolchain->>'compiler' is distinct from 'wiseeff-catalog-install-chain/v2')
    )
  ) then
    raise exception using errcode = '23514', constraint = 'candidate_install_contract',
      message = 'Catalog candidate capability is incompatible with its artifact compiler';
  end if;
  return null;
end
$$;
alter function catalog_publication.check_candidate_install_contract() owner to catalog_migration_owner;
revoke all on function catalog_publication.check_candidate_install_contract() from public;
create constraint trigger candidate_install_contract after insert on catalog_publication.candidates
  deferrable initially deferred for each row execute function catalog_publication.check_candidate_install_contract();
