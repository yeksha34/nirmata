-- 016: the render path check used a repetition count above Postgres's limit of 255, so every insert failed.
-- 010 now has {1,250}; this repairs a database that already ran the old 010.
alter table assets.renders drop constraint renders_storage_path_check;
alter table assets.renders add constraint renders_storage_path_check
  check (storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._/-]{1,250}$' and storage_path not like '%..%');
