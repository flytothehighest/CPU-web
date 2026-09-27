import { createError, defineEventHandler, setHeader } from 'h3'
import { desc, eq } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, songReviews } from '~/drizzle/schema'
import { getSongReviewConfig } from '../../services/songReviewService'
import { isSongAdviceExpired, songAdviceDeadline, songReviewAdvice, songReviewFingerprint } from '../../utils/song-review-policy'

export default defineEventHandler(async event => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: '请先登录' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const config = await getSongReviewConfig()
  if (!config.enabled) return { enabled: false, reviews: [] }
  // Never expose other submitters' private AI advice, provider details or prompts.
  const rows = await db.select({ song: songs, review: songReviews }).from(songs)
    .leftJoin(songReviews, eq(songs.id, songReviews.songId))
    .where(eq(songs.requesterId, user.id)).orderBy(desc(songs.createdAt)).limit(500)
  return { enabled: true, reviews: rows.map(({ song, review }) => {
    const current = review?.fingerprint === songReviewFingerprint(song) && review.policyVersion === config.policyVersion
    const advice = songReviewAdvice(current ? review.status : 'pending', current ? review.reason : '')
    if (current && review.attempts >= 3 && advice.status === 'error') advice.detail = '投稿已保存，暂时无法生成选曲建议；这不代表你的投稿不符合要求。'
    if (current && review.confirmedAt) {
      advice.message = '已确认继续投稿，等待排期'
      advice.detail = `你已阅读选曲建议并确认继续投稿，后续由广播站安排，不保证播出。原建议：${review.reason}`
    }
    return { songId: song.id, ...advice, requiresConfirmation: Boolean(current && !review.confirmedAt && ['rejected', 'uncertain'].includes(review.status)),
      reviewToken: current ? review.attemptId : null, confirmedAt: current ? review.confirmedAt : null,
      expiresAt: current ? songAdviceDeadline(review.notifiedAt) : null, expired: current ? isSongAdviceExpired(review) : false }
  }) }
})
