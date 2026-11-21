alter table catalog_publication.preview_snapshots
  add column has_dts_examples boolean not null default false;
