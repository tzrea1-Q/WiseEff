alter table agent_run_traces
  add column if not exists latency_ms integer,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists safety_status text,
  add column if not exists safety_reasons jsonb,
  add column if not exists fallback_reason text;
