-- Exact expanded-source evidence is versioned separately from legacy affine CST proof.
alter table public.dts_config_revisions add column preprocessing jsonb;
alter table public.dts_config_revisions add constraint dts_preprocessing_receipt_shape check (
  preprocessing is null or (jsonb_typeof(preprocessing)='object'
    and preprocessing->>'schemaVersion'='dts-cpp/v1'
    and preprocessing->>'inputDigest' ~ '^sha256:[a-f0-9]{64}$'
    and preprocessing->>'outputDigest' ~ '^sha256:[a-f0-9]{64}$'));
