-- Private project pins remain server-owned. Only the opaque evidence and shared hashes are public.
alter table public.shared_dtsi_drafts add column source_origin jsonb
  check (source_origin is null or (jsonb_typeof(source_origin)='object' and source_origin ? 'evidence'));
