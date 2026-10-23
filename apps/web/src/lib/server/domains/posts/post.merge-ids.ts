/**
 * Shared "this post + posts merged into it" id set.
 *
 * Merge links the source (`canonical_post_id`) rather than moving votes or
 * comments. Every read/write that should treat a canonical and its sources as
 * one thread (vote identity, voter list, comment/vote recounts) uses this set.
 *
 * Passing a merged source id resolves up to the canonical first, so a stale
 * client holding the source still mutates the surviving thread.
 */
import { db, posts, postComments, boards, eq, sql } from '@/lib/server/db'
import { isValidTypeId, toUuid, type PostId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils'

type TransactionalDb = Pick<typeof db, 'execute' | 'update'>

/**
 * Merge-thread ids for `IN (...)`: the canonical (resolved from the given
 * post, which may itself be a source) plus every live source whose board
 * has not been soft-deleted.
 */
export function relatedPostIdsSql(postUuid: string) {
  return sql`(
    SELECT COALESCE(p.canonical_post_id, p.id)
    FROM ${posts} p
    WHERE p.id = ${postUuid}::uuid
    UNION ALL
    SELECT s.id
    FROM ${posts} s
    INNER JOIN ${boards} b ON b.id = s.board_id
    WHERE s.canonical_post_id = (
      SELECT COALESCE(p.canonical_post_id, p.id)
      FROM ${posts} p
      WHERE p.id = ${postUuid}::uuid
    )
      AND s.deleted_at IS NULL
      AND b.deleted_at IS NULL
  )`
}

/**
 * Drizzle-friendly form of {@link relatedPostIdsSql}. Safe to pass to
 * `inArray` or interpolate into `IN (...)`.
 */
export function relatedPostIdsSubquery(postId: PostId) {
  return relatedPostIdsSql(toUuid(postId))
}

/**
 * Bump `commentCount` on the canonical when the given post is a merged
 * source. No-op when the post is itself the canonical (the caller's own
 * update already covered it).
 */
export async function adjustCanonicalCommentCount(
  postId: PostId,
  delta: number,
  conn: TransactionalDb = db
): Promise<void> {
  if (delta === 0) return
  // Unit fixtures often use placeholder ids (`post_mock`) that are not
  // TypeIDs. Skip rather than throw; production callers always pass a
  // real post id and the source-row commentCount update still runs.
  if (!isValidTypeId(postId, 'post')) return
  const postUuid = toUuid(postId)
  await conn.execute(sql`
    UPDATE ${posts}
    SET comment_count = GREATEST(0, comment_count + ${delta})
    WHERE id = (
      SELECT p.canonical_post_id
      FROM ${posts} p
      INNER JOIN ${boards} b ON b.id = p.board_id
      WHERE p.id = ${postUuid}::uuid
        AND p.canonical_post_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND b.deleted_at IS NULL
    )
  `)
}

/**
 * Add `delta` to a post's stored `vote_count` (never below zero).
 *
 * Votes are merged additively (#17654): Featurebase-imported posts carry an
 * aggregate vote_count with no rows in `post_votes` (voter identities were not
 * imported), so a distinct-voter recount would drop those votes. Merge adds the
 * source's vote_count to the canonical, and unmerge, source deletion and board
 * deletion subtract it again. A source's vote_count is frozen while merged
 * (vote mutations update the canonical), so it is exactly what it contributed.
 */
export async function adjustCanonicalVoteCount(
  canonicalPostId: PostId,
  delta: number,
  conn: TransactionalDb = db
): Promise<number> {
  const [row] = await conn
    .update(posts)
    .set({ voteCount: sql`GREATEST(0, ${posts.voteCount} + ${delta})` })
    .where(eq(posts.id, canonicalPostId))
    .returning({ voteCount: posts.voteCount })
  return row?.voteCount ?? 0
}

/**
 * Recount public comments across a canonical + its sources.
 * Runs via the transaction handle when called from merge/unmerge so the
 * recount commits atomically with the link change.
 *
 * Vote counts are not recounted here: they are adjusted additively, see
 * {@link adjustCanonicalVoteCount}.
 *
 * Also correct for a standalone (unmerged) post: the related set is just
 * that post, so unmerge can restore the source's stored comment count this way.
 */
export async function recalculateCanonicalCommentCount(
  canonicalPostId: PostId,
  options?: { resetMergeCheck?: boolean },
  tx?: TransactionalDb
): Promise<void> {
  if (!tx) {
    return db.transaction((inner) =>
      recalculateCanonicalCommentCount(canonicalPostId, options, inner)
    )
  }
  const conn = tx
  const canonicalUuid = toUuid(canonicalPostId)
  // Hold the canonical row across the aggregate + write so a concurrent
  // comment increment cannot land between the snapshot and this assignment.
  await conn.execute(sql`
    SELECT id FROM ${posts} WHERE id = ${canonicalUuid}::uuid FOR UPDATE
  `)
  const result = await conn.execute<{ visible_comments: number }>(sql`
    WITH related_post_ids AS (
      SELECT ${canonicalUuid}::uuid AS post_id
      UNION ALL
      SELECT s.id
      FROM ${posts} s
      INNER JOIN ${boards} b ON b.id = s.board_id
      WHERE s.canonical_post_id = ${canonicalUuid}::uuid
        AND s.deleted_at IS NULL
        AND b.deleted_at IS NULL
    )
    SELECT COUNT(*)::int AS visible_comments
    FROM ${postComments} c
    WHERE c.post_id IN (SELECT post_id FROM related_post_ids)
      AND c.deleted_at IS NULL
      AND c.is_private = false
      AND c.moderation_state <> 'pending'
  `)

  const rows = getExecuteRows<{ visible_comments: number }>(result)
  const newCommentCount = rows[0]?.visible_comments ?? 0

  await conn
    .update(posts)
    .set({
      commentCount: newCommentCount,
      ...(options?.resetMergeCheck && { mergeCheckedAt: null }),
    })
    .where(eq(posts.id, canonicalPostId))
}
