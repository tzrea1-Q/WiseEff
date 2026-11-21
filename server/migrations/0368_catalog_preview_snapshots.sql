alter table catalog_publication.release_artifacts
  add column storage_format text not null default 'full'
    check (storage_format in ('full', 'successor-v1')),
  add column compact_base_digest text;
-- A compact candidate can outlive its creating request. Prevent concurrent
-- erasure from leaving a committed candidate pointing to bytes that no longer exist.
alter table catalog_publication.release_artifacts
  add constraint compact_artifact_has_base check (
    (storage_format = 'full' and compact_base_digest is null) or
    (storage_format = 'successor-v1' and predecessor_release_digest is not null and
      compact_base_digest is not null and compact_base_digest = predecessor_release_digest)
  ),
  add foreign key (compact_base_digest) references catalog_publication.release_artifacts (artifact_digest)
    deferrable initially deferred;
create index compact_artifact_base on catalog_publication.release_artifacts(compact_base_digest)
  where compact_base_digest is not null;

-- Published artifacts are immutable except during authorized Definition erasure.
-- The compiler version identifies the validation rules that certified this snapshot.
create table catalog_publication.preview_snapshots (
  artifact_id text not null,
  artifact_digest text not null,
  validator_version text not null,
  bytes_checksum text not null,
  has_subject_rules boolean not null,
  -- Compact artifacts already contain exactly this one-node bundle.
  target_bytes bytea,
  target_checksum text not null,
  primary key (artifact_id, validator_version),
  foreign key (artifact_id, artifact_digest) references catalog_publication.release_artifacts(id, artifact_digest) on delete cascade
);
alter table catalog_publication.preview_snapshots owner to catalog_migration_owner;
revoke all on catalog_publication.preview_snapshots from public;
grant select on catalog_publication.preview_snapshots to catalog_baseline_reader_role,
  catalog_synchronizer_role, catalog_publication_coordinator_role;
grant insert on catalog_publication.preview_snapshots to catalog_publication_coordinator_role;

create function catalog_publication.discard_rewritten_preview_snapshot() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  delete from catalog_publication.preview_snapshots where artifact_id = old.id;
  -- The erasure writer replaces the artifact with the rebuilt complete bundle.
  new.storage_format := 'full';
  new.compact_base_digest := null;
  return new;
end
$$;
alter function catalog_publication.discard_rewritten_preview_snapshot() owner to catalog_migration_owner;
revoke all on function catalog_publication.discard_rewritten_preview_snapshot() from public;
create trigger discard_rewritten_preview_snapshot before update of artifact_bytes, artifact_digest
  on catalog_publication.release_artifacts for each row
  execute function catalog_publication.discard_rewritten_preview_snapshot();
