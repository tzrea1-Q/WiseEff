-- Run-owned decoding artifacts; existing table DML grants apply to added columns.
alter table log_analysis_runs add column decoded_events_object_key text;
alter table log_analysis_runs add column decoded_event_counts jsonb;
alter table log_evidence add column decoded_fields jsonb;
comment on column log_analysis_runs.decoded_events_object_key is 'Organization-scoped object store key for gzip JSONL decoded-event v1 artifact';
comment on column log_analysis_runs.decoded_event_counts is 'Total, byExtractor and errors counters; null when no extractors were configured';
comment on column log_evidence.decoded_fields is 'Cited decoded events with file/line anchors and typed fields';
