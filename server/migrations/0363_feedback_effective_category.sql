alter table product_feedback
  add column effective_feedback_type text
    check (effective_feedback_type in ('experience', 'data', 'export_submit', 'feature'));
