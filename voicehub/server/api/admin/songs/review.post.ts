import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { reviewSongWithAi } from '../../../services/songReviewService'

const schema = z.object({ action: z.literal('ai'), songId: z.number().int().positive() }).strict()

export default defineEventHandler(async event => {
  const user = event.context.user
  if (!user || !['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw createError({ statusCode: 403, message: '没有歌曲审核权限' })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: '请提供有效的歌曲ID' })
  const input = parsed.data
  return reviewSongWithAi(input.songId)
})
