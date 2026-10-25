-- Lifecycle operations reuse immutable same-transaction audit receipts, including late retries.
alter table public.shared_dtsi_resources drop column lifecycle_request;
