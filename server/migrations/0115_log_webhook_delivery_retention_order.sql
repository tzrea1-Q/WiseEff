drop index if exists log_webhook_deliveries_domain_recent_idx;

create index log_webhook_deliveries_domain_recent_idx
  on log_webhook_deliveries (
    organization_id,
    log_domain_id,
    created_at desc,
    id desc
  );
