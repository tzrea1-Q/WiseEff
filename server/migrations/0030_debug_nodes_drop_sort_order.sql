-- Debug nodes no longer expose catalog sort order; list by name instead.

alter table debug_nodes drop column if exists sort_order;
