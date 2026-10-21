-- Durable upload admissions are not abandoned cleanup receipts until failed
-- or expired; the write transaction's row lock protects actual object IO.
alter table public.product_feedback_attachment_uploads
  add column in_flight boolean not null default false;
