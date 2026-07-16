-- Semantic metadata on parameter_specs for post-cutover dashboard and policy reads.
-- module/title may still be derived from specification_key; risk defaults to Low until backfilled.

alter table parameter_specs
  add column if not exists semantic_module text;

alter table parameter_specs
  add column if not exists risk text not null default 'Low';

create index if not exists parameter_specs_org_risk_idx
  on parameter_specs (organization_id, risk)
  where risk is not null;
