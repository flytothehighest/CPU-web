import { createHash } from 'node:crypto'

export type ReviewableSong = {
  title: string
  artist: string
  musicPlatform?: string | null
  musicId?: string | null
  playUrl?: string | null
  requesterId?: number
}

export function songReviewFingerprint(song: ReviewableSong) {
  return createHash('sha256').update(JSON.stringify([
    song.title, song.artist, song.musicPlatform || '', song.musicId || '', song.playUrl || '', song.requesterId || null
  ])).digest('hex')
}

export function isSongReadyForScheduling(song: ReviewableSong, review: {
  status: string
  fingerprint: string
  policyVersion: string
  confirmedAt?: Date | null
} | undefined, policyVersion: string) {
  if (!review || review.fingerprint !== songReviewFingerprint(song) || review.policyVersion !== policyVersion) return false
  return review.status === 'approved' || (['rejected', 'uncertain'].includes(review.status) && Boolean(review.confirmedAt))
}

export function needsAutomaticSongReview(song: ReviewableSong, review: {
  status: string; fingerprint: string; policyVersion: string; attempts: number; updatedAt: Date; confirmedAt?: Date | null; notifiedAt?: Date | null
} | null | undefined, policyVersion: string, now = Date.now()) {
  if (!review || review.fingerprint !== songReviewFingerprint(song) || review.policyVersion !== policyVersion) return true
  if (review.confirmedAt || (['rejected', 'uncertain'].includes(review.status) && review.notifiedAt)) return false
  if (review.status === 'pending') return true
  if (review.attempts >= 3) return false
  const age = now - review.updatedAt.getTime()
  return (review.status === 'checking' && age >= 180_000)
    || (['uncertain', 'error'].includes(review.status) && age >= review.attempts * 300_000)
}

export const SONG_ADVICE_CONFIRMATION_MS = 24 * 60 * 60 * 1000
export function songAdviceDeadline(notifiedAt: Date | null | undefined) {
  return notifiedAt ? new Date(notifiedAt.getTime() + SONG_ADVICE_CONFIRMATION_MS) : null
}

export function isSongAdviceExpired(review: { status: string; confirmedAt?: Date | null; notifiedAt?: Date | null }, now = Date.now()) {
  const deadline = songAdviceDeadline(review.notifiedAt)
  return ['rejected', 'uncertain'].includes(review.status) && !review.confirmedAt && Boolean(deadline && deadline.getTime() <= now)
}

export function songReviewAdvice(status: string, reason: string) {
  if (status === 'rejected') return {
    status, message: '该投稿大概率不会被接受',
    detail: `${reason} 你可以撤回或仍然投稿；收到建议后24小时内未确认，系统将自动撤回。确认后才会进入待排期流程，不保证播出。`
  }
  if (status === 'uncertain') return {
    status, message: 'AI暂无法确认这首歌是否符合选曲要求',
    detail: `${reason} 该投稿可能不会被接受。你可以撤回或仍然投稿；收到建议后24小时内未确认，系统将自动撤回。`
  }
  if (status === 'approved') return { status, message: '暂未发现选曲风险，等待排期', detail: 'AI通过不代表一定会被安排播出。' }
  if (status === 'error') return { status, message: '选曲建议暂未生成', detail: '投稿已保存，系统会重试；这不代表你的投稿不符合要求。' }
  return { status: 'pending', message: '投稿已保存，AI正在后台检查选曲要求', detail: '无需等待，你可以继续使用其他功能。' }
}
