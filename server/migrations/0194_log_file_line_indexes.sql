-- Existing text objects are indexed lazily on their next processing/viewer read.
alter table log_files add column line_index_key text;
