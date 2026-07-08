-- Roll back #17654: drop the imported_vote_count column.
--
-- The original #17654 migration (add column + backfill) was reverted in code. This
-- migration removes the column from databases that already applied it (prod, and any
-- environment restored from a post-#17654 dump). IF EXISTS makes it a no-op on fresh
-- databases that never had the column.
--
-- Note: manual/merged vote_count values changed during #17654 are NOT restored here —
-- dropping this column does not touch vote_count.

ALTER TABLE "posts" DROP COLUMN IF EXISTS "imported_vote_count";
