-- Prevent duplicate table names within the same business + branch.
-- name is stored inside the JSONB data column, so we use an expression index.
create unique index if not exists tables_business_branch_name_unique
  on public.tables (business_id, branch_id, (data->>'name'));
