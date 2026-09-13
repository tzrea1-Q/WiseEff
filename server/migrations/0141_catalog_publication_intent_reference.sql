-- CP-04 tagged publication intent reference.
--
-- Historical repository_reference remains for kind=repository.
-- Candidate kind stores candidate_id and leaves repository_reference null so
-- accept cannot mint a fake Git URL. This does not GRANT EXECUTE on
-- catalog_publication.revise_publication_policy and does not enable publication.

select pg_catalog.pg_advisory_lock(140014100141);

alter table catalog_publication.candidates
  add constraint candidates_id_proposal_revision_uidx
  unique (id, proposal_id, proposal_revision_id);

alter table parameter_catalog.catalog_publication_intents
  add column reference_kind text not null default 'repository'
    check (reference_kind in ('repository', 'candidate'));

alter table parameter_catalog.catalog_publication_intents
  add column candidate_id text
    check (
      candidate_id is null
      or (
        candidate_id <> ''
        and btrim(candidate_id) = candidate_id
        and candidate_id !~ '[[:cntrl:]]'
        and candidate_id like 'ccand_%'
      )
    );

alter table parameter_catalog.catalog_publication_intents
  alter column repository_reference drop not null;

alter table parameter_catalog.catalog_publication_intents
  drop constraint catalog_publication_intents_repository_reference_check;

alter table parameter_catalog.catalog_publication_intents
  add constraint catalog_publication_intents_reference_ck
  check (
    (
      reference_kind = 'repository'
      and repository_reference is not null
      and repository_reference <> ''
      and btrim(repository_reference) = repository_reference
      and candidate_id is null
    )
    or (
      reference_kind = 'candidate'
      and candidate_id is not null
      and repository_reference is null
    )
  );

alter table parameter_catalog.catalog_publication_intents
  add constraint catalog_publication_intents_candidate_proposal_fk
  foreign key (candidate_id, proposal_id, proposal_revision_id)
  references catalog_publication.candidates (id, proposal_id, proposal_revision_id)
  on delete restrict;

comment on column parameter_catalog.catalog_publication_intents.reference_kind is
  'Tagged publication reference kind: repository (historical URL) or candidate (ccand_ id). Candidate kind must not fill repository_reference.';

comment on column parameter_catalog.catalog_publication_intents.candidate_id is
  'Publication candidate id when reference_kind=candidate. Null for historical repository intents.';

select pg_catalog.pg_advisory_unlock(140014100141);
