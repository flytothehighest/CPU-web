import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import { and, desc, eq, inArray, notExists } from 'drizzle-orm'
import { db } from '~/drizzle/db'
import { songs, songReviews, schedules } from '~/drizzle/schema'
import { cpuWebOrigin } from '../utils/cpu-web-auth'
import { isSongReadyForScheduling, needsAutomaticSongReview, songReviewFingerprint } from '../utils/song-review-policy'

export type SongReviewConfig = { enabled: boolean; policyVersion: string; previousPolicyVersion?: string }
type ReviewDecision = { status: 'approved' | 'rejected' | 'uncertain' | 'error'; reason: string; model: string; sources: Array<{ title: string; url: string }>; policyVersion: string }
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function mainSite<T>(path: string, body?: unknown): Promise<T> {
  const secret = String(process.env.VOICEHUB_INTEGRATION_SECRET || '')
  if (secret.length < 32) throw createError({ statusCode: 503, message: '歌曲审核连接未配置，请联系管理员' })
  const response = await fetch(`${cpuWebOrigin()}/api/integrations/voicehub/song-review${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-voicehub-integration-secret': secret },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(body === undefined ? 8_000 : 90_000)
  })
  if (!response.ok) throw createError({ statusCode: 503, message: '歌曲审核服务暂不可用，请稍后重试' })
  const result = await response.json()
  if (result.code !== 0 || !result.data) throw createError({ statusCode: 503, message: '歌曲审核响应异常' })
  return result.data as T
}

export async function getSongReviewConfig(): Promise<SongReviewConfig> {
  const config = await mainSite<SongReviewConfig>('/config')
  if (typeof config.enabled !== 'boolean' || !/^[a-f0-9]{64}$/.test(config.policyVersion)) {
    throw createError({ statusCode: 503, message: '歌曲审核配置异常，暂不能排期' })
  }
  return config
}

// Caller holds these locks through schedule creation, so edits/reviews cannot race approval.
export async function requireSchedulableSongs(tx: Transaction, rawIds: unknown[], config: SongReviewConfig) {
  const ids = [...new Set(rawIds.map(Number))].sort((a, b) => a - b)
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw createError({ statusCode: 400, message: '歌曲ID无效' })
  if (!ids.length || !config.enabled) return
  const rows = await tx.select().from(songs).where(inArray(songs.id, ids)).orderBy(songs.id).for('update')
  const reviews = await tx.select().from(songReviews).where(inArray(songReviews.songId, ids))
  const byId = new Map(reviews.map(r => [r.songId, r]))
  const blocked = rows.filter(song => !isSongReadyForScheduling(song, byId.get(song.id), config.policyVersion))
  if (rows.length !== ids.length || blocked.length) throw createError({
    statusCode: 409,
    message: `投稿尚未完成AI检查或用户二次确认，暂不能排期：${blocked.slice(0, 5).map(s => s.title).join('、') || '歌曲不存在'}`
  })
}

export async function listSongReviews() {
  const [config, songRows, reviews] = await Promise.all([
    getSongReviewConfig(), db.select().from(songs), db.select().from(songReviews)
  ])
  const byId = new Map(reviews.map(r => [r.songId, r]))
  return { config, reviews: songRows.map(song => {
    const review = byId.get(song.id)
    const current = review && review.fingerprint === songReviewFingerprint(song) && review.policyVersion === config.policyVersion
    const eligibleForScheduling = !config.enabled || isSongReadyForScheduling(song, review, config.policyVersion)
    return current ? { ...review, eligibleForScheduling, sources: JSON.parse(review.sources) } : {
      songId: song.id, eligibleForScheduling, status: 'pending', reason: review ? '歌曲或规则已更新，需重新审核' : '等待审核', sources: [], fingerprint: songReviewFingerprint(song), policyVersion: config.policyVersion
    }
  }) }
}

export async function reviewSongWithAi(songId: number, config = undefined as SongReviewConfig | undefined, automatic = false) {
  config ||= await getSongReviewConfig()
  if (!config.enabled) throw createError({ statusCode: 409, message: '请先在主站AI配置中启用歌曲审核' })
  const attemptId = randomUUID()
  const policyVersion = config.policyVersion
  const song = await db.transaction(async tx => {
    const [song] = await tx.select().from(songs).where(eq(songs.id, songId)).for('update')
    if (!song) throw createError({ statusCode: 404, message: '歌曲不存在' })
    const scheduled = await tx.select({ id: schedules.id }).from(schedules)
      .where(and(eq(schedules.songId, songId), eq(schedules.isDraft, false), eq(schedules.played, false))).limit(1)
    if (scheduled.length) throw createError({ statusCode: 409, message: '歌曲已排期，请先移除排期再重新检查' })
    const [existing] = await tx.select().from(songReviews).where(eq(songReviews.songId, songId))
    if (automatic && !needsAutomaticSongReview(song, existing, policyVersion)) return null
    if (existing?.status === 'checking' && Date.now() - existing.updatedAt.getTime() < 180_000) {
      throw createError({ statusCode: 409, message: '该歌曲正在审核，请稍后刷新' })
    }
    const attempts = existing && existing.fingerprint === songReviewFingerprint(song) && existing.policyVersion === policyVersion ? existing.attempts + 1 : 1
    const keepConfirmation = automatic && existing?.fingerprint === songReviewFingerprint(song) && existing?.policyVersion === config?.previousPolicyVersion && existing?.confirmedAt
    const value = { songId, attempts, status: 'checking', fingerprint: songReviewFingerprint(song), policyVersion, reason: 'AI正在核对曲目和来源', model: '', sources: '[]', confirmedAt: keepConfirmation ? existing?.confirmedAt || null : null, notifiedAt: keepConfirmation ? existing?.notifiedAt || null : null, notificationKey: null, attemptId, updatedAt: new Date() }
    await tx.insert(songReviews).values(value).onConflictDoUpdate({ target: songReviews.songId, set: value })
    return song
  })
  if (!song) return null
  let decision: ReviewDecision
  try {
    decision = await mainSite<ReviewDecision>('', { songId, title: song.title, artist: song.artist,
      musicPlatform: ['netease', 'tencent', 'bilibili'].includes(song.musicPlatform || '') ? song.musicPlatform : null,
      musicId: song.musicId || null })
    if (!['approved', 'rejected', 'uncertain', 'error'].includes(decision.status) || typeof decision.reason !== 'string'
      || !Array.isArray(decision.sources) || decision.policyVersion !== policyVersion) throw new Error('Invalid review')
  } catch {
    decision = { status: 'error', reason: 'AI审核未完成，将自动重试，也可重新发起AI审核', model: '', sources: [], policyVersion }
  }
  await db.transaction(async tx => {
    const [current] = await tx.select().from(songs).where(eq(songs.id, songId)).for('update')
    if (!current) return
    const unchanged = songReviewFingerprint(current) === songReviewFingerprint(song)
    const notificationKey = unchanged && ['rejected', 'uncertain'].includes(decision.status) ? createHash('sha256').update(`song-advice:${songId}:${attemptId}`).digest('hex') : null
    await tx.update(songReviews).set({ status: unchanged ? decision.status : 'pending', reason: unchanged ? decision.reason : '歌曲已编辑，需重新审核', model: decision.model, sources: JSON.stringify(decision.sources), notificationKey, updatedAt: new Date() })
      .where(and(eq(songReviews.songId, songId), eq(songReviews.attemptId, attemptId)))
  })
  return decision
}

export async function reviewNextPendingSong() {
  const config = await getSongReviewConfig()
  if (!config.enabled) return
  const rows = await db.select({ song: songs, review: songReviews }).from(songs).leftJoin(songReviews, eq(songs.id, songReviews.songId))
    .where(and(eq(songs.played, false), notExists(db.select({ id: schedules.id }).from(schedules).where(and(eq(schedules.songId, songs.id), eq(schedules.isDraft, false)))))).orderBy(desc(songs.createdAt))
  for (const { review } of rows) {
    if (review?.status === 'checking' && review.attempts >= 3 && Date.now() - review.updatedAt.getTime() >= 180_000 && review.attemptId) {
      await db.update(songReviews).set({ status: 'error', reason: '审核多次中断，请重新发起AI审核', updatedAt: new Date() })
        .where(and(eq(songReviews.songId, review.songId), eq(songReviews.status, 'checking'), eq(songReviews.attemptId, review.attemptId)))
    }
  }
  const next = rows.find(({ song, review }) => needsAutomaticSongReview(song, review, config.policyVersion))
  if (next) await reviewSongWithAi(next.song.id, config, true)
}
