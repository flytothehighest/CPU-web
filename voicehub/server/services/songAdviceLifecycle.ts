import { createError } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, songReviews, schedules, requestTimes, songCollaborators, collaborationLogs } from '~/drizzle/schema'
import { cacheService } from './cacheService'
import { createSongReviewAdviceNotification } from './notificationService'
import { isSongAdviceExpired, songReviewFingerprint } from '../utils/song-review-policy'
import type { SongReviewConfig } from './songReviewService'

export type SongAdviceAction = { songId: number; reviewToken: string; action: 'confirm' | 'withdraw'; acknowledged: true }

export async function actOnSongAdvice(input: SongAdviceAction, userId: number, config: SongReviewConfig) {
  if (!config.enabled) throw createError({ statusCode: 409, message: '歌曲建议功能已关闭，请刷新' })
  const result = await db.transaction(async tx => {
    const [song] = await tx.select().from(songs).where(eq(songs.id, input.songId)).for('update')
    if (!song) throw createError({ statusCode: 404, message: '投稿已撤回或不存在' })
    if (song.requesterId !== userId) throw createError({ statusCode: 403, message: '只能处理自己的投稿建议' })
    const [review] = await tx.select().from(songReviews).where(eq(songReviews.songId, input.songId)).for('update')
    if (!review || review.attemptId !== input.reviewToken || review.fingerprint !== songReviewFingerprint(song)
      || review.policyVersion !== config.policyVersion || !['rejected', 'uncertain'].includes(review.status)) {
      throw createError({ statusCode: 409, message: '建议或歌曲已变化，请刷新并重新阅读' })
    }
    if (isSongAdviceExpired(review)) throw createError({ statusCode: 409, message: '24小时确认期限已过，投稿将自动撤回' })
    if (input.action === 'withdraw') {
      await deletePendingSong(tx, song)
      return { withdrawn: true, message: '投稿已撤回' }
    }
    if (!review.notifiedAt) throw createError({ statusCode: 409, message: '建议通知正在送达，请稍后确认' })
    if (!review.confirmedAt) await tx.update(songReviews).set({ confirmedAt: new Date() }).where(eq(songReviews.songId, song.id))
    return { withdrawn: false, message: '已确认继续投稿，现已进入待排期流程，但不保证播出' }
  })
  await clearSongAdviceCaches()
  return result
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
async function deletePendingSong(tx: Transaction, song: typeof songs.$inferSelect) {
  if (song.played) throw createError({ statusCode: 409, message: '已播放歌曲不能撤回' })
  const scheduled = await tx.select({ id: schedules.id }).from(schedules)
    .where(and(eq(schedules.songId, song.id), eq(schedules.isDraft, false))).limit(1)
  if (scheduled.length) throw createError({ statusCode: 409, message: '已排期歌曲不能撤回' })
  const collaborators = await tx.select({ id: songCollaborators.id }).from(songCollaborators).where(eq(songCollaborators.songId, song.id))
  if (collaborators.length) await tx.delete(collaborationLogs).where(inArray(collaborationLogs.collaboratorId, collaborators.map(c => c.id)))
  // Match the application's song deletion scope, including comments, votes, draft schedules and new FK tables.
  const references = await tx.execute(sql`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('songId','song_id')`)
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  for (const row of references as unknown as Array<{ table_name: string; column_name: string }>) {
    await tx.execute(sql`DELETE FROM ${sql.raw(quote(row.table_name))} WHERE ${sql.raw(quote(row.column_name))}=${song.id}`)
  }
  if (song.hitRequestId) await tx.update(requestTimes).set({ accepted: sql`GREATEST(0, ${requestTimes.accepted} - 1)` }).where(eq(requestTimes.id, song.hitRequestId))
  await tx.delete(songs).where(eq(songs.id, song.id))
}

async function clearSongAdviceCaches() {
  await Promise.all([cacheService.clearSongsCache(), cacheService.clearSchedulesCache(), cacheService.clearStatsCache()])
}

export async function deliverSongAdviceAndExpire(config: SongReviewConfig) {
  if (!config.enabled) return
  const rows = await db.select({ song: songs, review: songReviews }).from(songReviews).innerJoin(songs, eq(songReviews.songId, songs.id))
    .where(and(eq(songs.played, false), inArray(songReviews.status, ['rejected', 'uncertain'])))
  // Expiry cannot be starved by undeliverable legacy accounts; fresh notices precede old retries.
  rows.sort((a, b) => Number(isSongAdviceExpired(b.review)) - Number(isSongAdviceExpired(a.review))
    || b.review.updatedAt.getTime() - a.review.updatedAt.getTime())
  let handled = 0
  for (const { song, review } of rows) {
    if (handled >= 20) break
    if (review.confirmedAt || review.fingerprint !== songReviewFingerprint(song) || review.policyVersion !== config.policyVersion) continue
    if (!review.notifiedAt && review.notificationKey) {
      handled++
      const delivered = await createSongReviewAdviceNotification({ userId: song.requesterId, songId: song.id, title: song.title, reason: review.reason, deliveryKey: review.notificationKey })
      if (delivered?.count === 1) await db.update(songReviews).set({ notifiedAt: new Date() })
        .where(and(eq(songReviews.songId, song.id), eq(songReviews.notificationKey, review.notificationKey), sql`${songReviews.notifiedAt} IS NULL`))
    } else if (isSongAdviceExpired(review)) {
      handled++
      // Recheck under the same song lock as confirmation and scheduling. Only one outcome can win.
      try {
        const removed = await db.transaction(async tx => {
          const [currentSong] = await tx.select().from(songs).where(eq(songs.id, song.id)).for('update')
          const [current] = await tx.select().from(songReviews).where(eq(songReviews.songId, song.id)).for('update')
          if (!currentSong || !current || current.fingerprint !== songReviewFingerprint(currentSong) || current.policyVersion !== config.policyVersion || !isSongAdviceExpired(current)) return false
          await deletePendingSong(tx, currentSong)
          return true
        })
        if (removed) { await clearSongAdviceCaches(); console.info('[song-review] unconfirmed submission expired', song.id) }
      } catch (error: any) {
        console.warn('[song-review] expiry deferred', song.id, error?.statusCode || 'unavailable')
      }
    }
  }
}
