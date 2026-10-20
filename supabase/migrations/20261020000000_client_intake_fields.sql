-- Client intake: parent / guardian names and diagnosis (mirrors the desktop migration).
alter table public.patients
  add column parent_names text not null default '',
  add column diagnosis text not null default '';
