-- Track imported votes that have no backing rows in `votes`.
--
-- CSV import writes an aggregate `posts.vote_count` (e.g. 500 votes from Featurebase)
-- without creating per-voter rows in `votes`, because the source voter identities are
-- not imported. Merge recalculation counts unique real voters from `votes`, so those
-- imported votes were silently dropped when a post was merged.
--
-- This column stores that imported aggregate as an immutable baseline. Merge
-- recalculation then computes:
--     merged vote_count = COUNT(DISTINCT real voters across related posts)
--                       + SUM(imported_vote_count across related posts)
-- Because the baseline lives in its own column that recalculation never overwrites,
-- the result is idempotent across repeated merge/unmerge.

ALTER TABLE "posts" ADD COLUMN "imported_vote_count" integer DEFAULT 0 NOT NULL;

-- Backfill: freeze the existing "votes without backing rows" gap as the import baseline.
-- The fix applies going forward — already-merged canonical posts are not perfectly
-- reconstructed here (their vote_count may be an old aggregate); they self-correct on
-- their next merge/unmerge. This one-liner is a faithful reconstruction for the common
-- case (standalone and imported posts) and good enough for the rest.
UPDATE "posts" p
SET "imported_vote_count" = GREATEST(
  0,
  p."vote_count" - (SELECT COUNT(*) FROM "votes" v WHERE v."post_id" = p."id")
);
