-- UTF-16 character offsets into extracted_text, indexed by physical page - 1.
-- NULL means no page metadata (non-PDF or a legacy extraction).
alter table knowledge_files add column page_offsets integer[];
-- Failed legacy files stay out of the startup scan until explicitly repaired.
alter table knowledge_files add column page_backfill_error text;
alter table knowledge_files add constraint knowledge_files_pdf_page_offsets_check
  check (page_offsets is null or (
    content_type = 'application/pdf' and cardinality(page_offsets) > 0
    and page_offsets[1] = 0 and 0 <= all(page_offsets)
  ));

alter table knowledge_chunks add column page_start integer;
alter table knowledge_chunks add column page_end integer;
alter table knowledge_chunks add constraint knowledge_chunks_page_range_check
  check ((page_start is null and page_end is null) or
    (page_start is not null and page_end is not null and page_start >= 1 and page_end >= page_start));
